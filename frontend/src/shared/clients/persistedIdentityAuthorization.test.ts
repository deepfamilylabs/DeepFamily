import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { Interface, type Contract } from "ethers";
import { poseidon2, poseidon3 } from "poseidon-lite";
import { buildShieldedIdentityAuthorizationState, getShieldedIdentityAuthorizationWitness } from "@deepfamily/protocol-core";
import { IDENTITY_AUTHORIZATION_ABI, loadShieldedIdentityAuthorizationWitnessForMode } from "./shieldedIdentityAuthorizationChain";
import { openPublicStateStore } from "./publicStateStore";
import { subscribePublicStateSyncProgress } from "../workers/publicStateSyncProgress";

// Real IndexedDB scheduling and Poseidon fixtures also run under the parallel full suite.
vi.setConfig({ testTimeout: 30_000 });

type Node = { hash: bigint; key: bigint; counter: bigint; left: bigint; right: bigint };
type Snapshot = { nodes: Map<bigint, Node>; rootId: bigint; checkpointId: bigint; entries: Map<bigint, bigint> };
type Filter = { address: string; topics: unknown[]; fromBlock: number; toBlock: number };
let fixtureId = 0;
function fixture() {
  const address = `0x${(++fixtureId).toString(16).padStart(40, "0")}`;
  const iface = new Interface(IDENTITY_AUTHORIZATION_ABI);
  const nodes = new Map<bigint, Node>();
  const entries = new Map<bigint, bigint>();
  let rootId = 0n;
  let checkpointId = 1n;
  let head = 20;
  const snapshots: Array<{ block: number; snapshot: Snapshot }> = [];
  const hashes = new Map<number, string>();
  const logs: Array<{ data: string; topics: string[]; blockNumber: number; index: number; removed: boolean }> = [];
  const hash = (id: bigint) => nodes.get(id)?.hash ?? 0n;
  const allocate = (node: Node) => { const id = BigInt(nodes.size + 1); nodes.set(id, node); return id; };
  const branch = (left: bigint, right: bigint) => allocate({ hash: poseidon2([hash(left), hash(right)]), key: 0n, counter: 0n, left, right });
  const append = (block: number, alias: bigint) => {
    const oldRoot = hash(rootId);
    const oldCounter = entries.get(alias) ?? 0n;
    const newCounter = oldCounter + 1n;
    const path: bigint[] = [];
    let id = rootId;
    while (id && nodes.get(id)!.counter === 0n) {
      path.push(id);
      const node = nodes.get(id)!;
      id = (alias >> BigInt(path.length - 1)) & 1n ? node.right : node.left;
    }
    const node = nodes.get(id);
    const leaf = () => allocate({ hash: poseidon3([alias, newCounter, 1n]), key: alias, counter: newCounter, left: 0n, right: 0n });
    let updated: bigint;
    if (!node) updated = leaf();
    else if (node.key === alias) { updated = id; nodes.set(id, { ...node, counter: newCounter, hash: poseidon3([alias, newCounter, 1n]) }); }
    else {
      let split = path.length;
      while (((node.key >> BigInt(split)) & 1n) === ((alias >> BigInt(split)) & 1n)) split++;
      if (split >= 64) throw new Error("fixture collision");
      const next = leaf();
      updated = (alias >> BigInt(split)) & 1n ? branch(id, next) : branch(next, id);
      while (split > path.length) { split--; updated = (alias >> BigInt(split)) & 1n ? branch(0n, updated) : branch(updated, 0n); }
    }
    for (let depth = path.length - 1; depth >= 0; depth--) {
      const parent = nodes.get(path[depth])!;
      const left = (alias >> BigInt(depth)) & 1n ? parent.left : updated;
      const right = (alias >> BigInt(depth)) & 1n ? updated : parent.right;
      nodes.set(path[depth], { ...parent, left, right, hash: poseidon2([hash(left), hash(right)]) });
      updated = path[depth];
    }
    rootId = updated;
    checkpointId++;
    entries.set(alias, newCounter);
    expect(hash(rootId)).toBe(buildShieldedIdentityAuthorizationState(entries).root);
    const encoded = iface.encodeEventLog(iface.getEvent("CounterIncremented")!, [checkpointId, alias, oldCounter, newCounter, oldRoot, hash(rootId), checkpointId + 100n]);
    logs.push({ ...encoded, blockNumber: block, index: logs.filter((log) => log.blockNumber === block).length, removed: false });
    snapshots.push({ block, snapshot: { nodes: new Map([...nodes].map(([key, value]) => [key, { ...value }])), rootId, checkpointId, entries: new Map(entries) } });
  };
  const at = (block: number) => {
    const matching = snapshots.filter((item) => item.block <= block);
    return matching[matching.length - 1]?.snapshot ?? { nodes: new Map<bigint, Node>(), rootId: 0n,
      checkpointId: 1n, entries: new Map<bigint, bigint>() };
  };
  const root = (snapshot: Snapshot) => snapshot.nodes.get(snapshot.rootId)?.hash ?? 0n;
  const block = (number: number) => ({ hash: hashes.get(number) ?? `0xblock-${number}`, timestamp: 1000 + number * 10 });
  const provider = {
    getNetwork: vi.fn(async () => ({ chainId: 31337n })),
    getBlockNumber: vi.fn(async () => head),
    getBlock: vi.fn(async (number: number): Promise<ReturnType<typeof block> | null> => block(number)),
    getLogs: vi.fn(async (filter: Filter) => logs.filter((log) => log.blockNumber >= filter.fromBlock && log.blockNumber <= filter.toBlock)),
  };
  const contract = {
    runner: { provider }, interface: iface,
    getAddress: vi.fn(async () => address), creationBlock: vi.fn(async () => 10n),
    currentRoot: vi.fn(async ({ blockTag }: { blockTag: number }) => root(at(blockTag))),
    currentCheckpointId: vi.fn(async ({ blockTag }: { blockTag: number }) => at(blockTag).checkpointId),
    getStateSnapshotHeader: vi.fn(async ({ blockTag }: { blockTag: number }) => {
      const state = at(blockTag);
      return { formatVersion: 1n, rootNodeId: state.rootId, nodeCount: BigInt(state.nodes.size), root: root(state), checkpointId: state.checkpointId };
    }),
    getNodePage: vi.fn(async (start: number, limit: number, { blockTag }: { blockTag: number }) => [...at(blockTag).nodes.values()].slice(start - 1, start - 1 + limit).map((node) => ({ ...node }))),
    getCheckpoint: vi.fn(async (id: bigint, { blockTag }: { blockTag: number }) => {
      const state = at(blockTag);
      return { root: root(state), createdAt: id === 1n ? 1100n : 1120n, retiredAt: 0n };
    }),
    getCounterProof: vi.fn(async () => { throw new Error("target RPC forbidden"); }),
    authorizationCounter: vi.fn(async () => { throw new Error("target RPC forbidden"); }),
  };
  const load = (alias = 17n) => loadShieldedIdentityAuthorizationWitnessForMode(contract as unknown as Contract, alias);
  const store = () => openPublicStateStore(`authorization:v1:31337:${address.toLowerCase()}:10:${block(10).hash}`);
  return { contract, provider, append, at, load, store, address, block, setHead: (value: number) => { head = value; }, setHash: (number: number, value: string) => { hashes.set(number, value); } };
}

describe("persistent private authorization rebuild", () => {
  it("bootstraps current nodes without replaying a synthetic one-hundred-million-update checkpoint", async () => {
    const state = fixture();
    state.append(12, 17n);
    state.at(20).checkpointId = 100_000_001n;
    const loaded = await state.load();
    expect(loaded.checkpointId).toBe(100_000_001n);
    expect(loaded.witness.authorizationCounter).toBe(1n);
    expect(state.contract.getNodePage).toHaveBeenCalledExactlyOnceWith(1, 256, { blockTag: 20 });
    expect(state.provider.getLogs).not.toHaveBeenCalled();
    expect(state.contract.getCounterProof).not.toHaveBeenCalled();
  });

  it("bootstraps an empty dictionary and appends its first leaf without history or target queries", async () => {
    const state = fixture();
    const empty = await state.load();
    expect(empty.witness.authorizationCounter).toBe(0n);
    expect(empty.witness.isOld0).toBe(1n);
    expect(state.contract.getNodePage).not.toHaveBeenCalled();
    state.append(22, 17n); state.setHead(25);
    expect((await state.load()).witness.authorizationCounter).toBe(1n);
    expect(state.contract.getCounterProof).not.toHaveBeenCalled();
  });

  it("bootstraps global pages with history unavailable, then reuses across providers without exporting a tree", async () => {
    const state = fixture();
    state.append(12, 17n); state.append(14, 18n); state.append(16, 17n);
    state.provider.getLogs.mockRejectedValue(new Error("history unavailable"));
    const result = await state.load();
    expect(result.witness).toEqual(getShieldedIdentityAuthorizationWitness(buildShieldedIdentityAuthorizationState(state.at(20).entries), 17n));
    expect(state.contract.getNodePage).toHaveBeenCalledWith(1, 256, { blockTag: 20 });
    expect(state.provider.getLogs).not.toHaveBeenCalled();
    expect(state.contract.getCounterProof).not.toHaveBeenCalled();
    expect(state.contract.authorizationCounter).not.toHaveBeenCalled();
    state.contract.runner.provider = { ...state.provider };
    await state.load(19n);
    expect(state.contract.getNodePage).toHaveBeenCalledTimes(1);
    expect(state.provider.getLogs).not.toHaveBeenCalled();
  });

  it("catches up new aliases, repeated counters and depth64 paths with only event-type filters", async () => {
    const state = fixture(); state.append(12, 17n);
    await state.load();
    state.append(22, 17n ^ (1n << 63n)); state.append(23, 17n); state.append(24, 18n); state.setHead(25);
    const result = await state.load();
    expect(result.witness.authorizationCounter).toBe(2n);
    expect(result.witness.depth).toBe(64n);
    expect(result.stateRoot).toBe(buildShieldedIdentityAuthorizationState(state.at(25).entries).root);
    expect(state.provider.getLogs).toHaveBeenCalledWith({ address: state.address, topics: [state.contract.interface.getEvent("CounterIncremented")!.topicHash], fromBlock: 21, toBlock: 25 });
    expect(state.contract.getNodePage).toHaveBeenCalledTimes(1);
    const store = await state.store(); const head = (await store.envelope()).head!;
    expect(head.data.nodeCount).toBe(String(state.at(25).nodes.size));
    expect(state.contract.getCounterProof).not.toHaveBeenCalled();
  });

  it("resumes saved global page cursors at the previous canonical anchor before catching up", async () => {
    const state = fixture();
    for (let index = 0; index < 140; index++) state.append(12, BigInt(index + 1));
    const original = state.contract.getNodePage.getMockImplementation()!;
    state.contract.getNodePage.mockImplementationOnce(original).mockRejectedValueOnce(new Error("interrupted"));
    await expect(state.load()).rejects.toThrow("interrupted");
    const store = await state.store();
    expect((await store.envelope()).pending?.cursors.downloaded).toBe(256);
    state.contract.getNodePage.mockClear(); state.contract.getNodePage.mockImplementation(original);
    state.setHead(21);
    const result = await state.load();
    expect(state.contract.getNodePage).toHaveBeenCalledWith(257, 256, { blockTag: 20 });
    expect(result.blockNumber).toBe(21);
    expect((await store.envelope()).pending).toBeUndefined();
  });

  it("rejects corrupt global snapshots and never switches to an alias query", async () => {
    const state = fixture(); state.append(12, 17n); state.append(13, 18n);
    const original = state.contract.getNodePage.getMockImplementation()!;
    state.contract.getNodePage.mockImplementation(async (...args) => {
      const page = await original(...args); page[0] = { ...page[0], hash: page[0].hash + 1n }; return page;
    });
    await expect(state.load()).rejects.toThrow("Invalid authorization leaf");
    expect((await (await state.store()).envelope()).head).toBeUndefined();
    expect(state.contract.getCounterProof).not.toHaveBeenCalled();
    state.contract.getNodePage.mockImplementation(original);
    await expect(state.load()).resolves.toMatchObject({ witness: { authorizationCounter: 1n } });
  });

  it("does not publish failed catchup and retries from the previous revision", async () => {
    const state = fixture(); state.append(12, 17n); await state.load();
    const store = await state.store(); const before = (await store.envelope()).head!;
    state.append(22, 17n); state.setHead(25);
    state.contract.currentRoot.mockResolvedValueOnce(42n);
    await expect(state.load()).rejects.toThrow("does not match checkpoint");
    expect((await store.envelope()).head).toEqual(before);
    await expect(state.load()).resolves.toMatchObject({ witness: { authorizationCounter: 2n } });
    expect(state.provider.getLogs).toHaveBeenCalledTimes(1);
  });

  it("preserves newer shared cache when a provider lags or cannot serve its anchor", async () => {
    const state = fixture(); state.append(12, 17n); await state.load();
    state.append(22, 17n); state.setHead(25); await state.load();
    const store = await state.store(); const before = (await store.envelope()).head!;
    state.setHead(23);
    await expect(state.load()).rejects.toThrow("behind its verified cache");
    expect((await store.envelope()).head).toEqual(before);
    state.setHead(26);
    state.provider.getBlock.mockImplementation(async (number) => number === 25 ? null : state.block(number));
    await expect(state.load()).rejects.toThrow("block is unavailable");
    expect((await store.envelope()).head).toEqual(before);
    state.provider.getBlock.mockImplementation(async (number) => state.block(number));
    expect((await state.load()).blockNumber).toBe(26);
  });

  it("rejects an in-flight reorganization before publishing a bootstrap candidate", async () => {
    const state = fixture(); state.append(12, 17n);
    const original = state.contract.getNodePage.getMockImplementation()!;
    state.contract.getNodePage.mockImplementation(async (...args) => {
      const page = await original(...args); state.setHash(20, "0xreorganized"); return page;
    });
    await expect(state.load()).rejects.toThrow("reorganized");
    const store = await state.store();
    expect((await store.envelope()).head).toBeUndefined();
    state.contract.getNodePage.mockImplementation(original);
    state.setHead(21);
    expect((await state.load()).blockHash).toBe(state.block(21).hash);
    expect(state.contract.getNodePage).toHaveBeenLastCalledWith(1, 256, { blockTag: 21 });
  });

  it("serializes concurrent local readers and keeps contract caches isolated", async () => {
    const state = fixture(); state.append(12, 17n); state.append(13, 18n);
    const [first, second] = await Promise.all([state.load(17n), state.load(18n)]);
    expect(first.witness.authorizationCounter).toBe(1n);
    expect(second.witness.authorizationCounter).toBe(1n);
    expect(state.contract.getNodePage).toHaveBeenCalledTimes(1);
    const other = fixture(); other.append(12, 17n); other.append(13, 17n);
    expect((await other.load()).witness.authorizationCounter).toBe(2n);
    expect((await state.load()).witness.authorizationCounter).toBe(1n);
    expect(other.contract.getNodePage).toHaveBeenCalledTimes(1);
  });

  it("rolls back reorganized revisions, then replays a canonical range", async () => {
    const state = fixture(); state.append(12, 17n); await state.load();
    state.append(22, 17n); state.setHead(25); await state.load();
    state.setHash(25, "0xreplacement"); state.setHead(26);
    const result = await state.load();
    expect(result.witness.authorizationCounter).toBe(2n);
    expect(state.provider.getLogs).toHaveBeenLastCalledWith(expect.objectContaining({ fromBlock: 21, toBlock: 26 }));
    expect(state.contract.getNodePage).toHaveBeenCalledTimes(1);
  });

  it("detects disk node tampering and keeps returned witnesses isolated", async () => {
    const state = fixture(); state.append(12, 17n); state.append(13, 18n);
    const first = await state.load(); first.witness.siblings.fill(99n);
    expect((await state.load()).witness.siblings).not.toEqual(first.witness.siblings);
    const store = await state.store(); const head = (await store.envelope()).head!;
    await store.commit(head, { blockNumber: head.blockNumber, blockHash: head.blockHash, data: head.data }, [{ kind: "authorization-node", key: "1", value: { ...state.at(20).nodes.get(1n)!, counter: 99n } }]);
    await expect(state.load()).rejects.toThrow("Invalid authorization leaf");
    expect(state.contract.getCounterProof).not.toHaveBeenCalled();
    expect((await store.envelope()).head).toBeUndefined();
    await expect(state.load()).resolves.toMatchObject({ witness: { authorizationCounter: 1n } });
    expect(state.contract.getNodePage).toHaveBeenCalledTimes(2);
  });

  it("caps incremental block ranges at 128 and rejects oversized log batches before writing", async () => {
    const state = fixture(); state.append(12, 17n); await state.load();
    const store = await state.store(); const before = (await store.envelope()).head!;
    state.append(22, 17n);
    state.setHead(300);
    const log = { data: "0x", topics: [], blockNumber: 21, index: 0, removed: false };
    state.provider.getLogs.mockResolvedValueOnce(Array.from({ length: 4097 }, () => log));
    await expect(state.load()).rejects.toThrow("synchronization limit");
    expect((await store.envelope()).head).toEqual(before);
    expect(state.provider.getLogs).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 21, toBlock: 148 }));
    state.provider.getLogs.mockClear();
    await state.load();
    expect(state.provider.getLogs.mock.calls.map(([filter]) => [filter.fromBlock, filter.toBlock])).toEqual([[21, 148], [149, 276], [277, 300]]);
  });

  it("reanchors a million inactive blocks without scanning logs and rejects unchanged-checkpoint root changes", async () => {
    const state = fixture(); state.append(12, 17n); await state.load();
    state.setHead(1_000_020);
    const result = await state.load();
    expect(result.blockNumber).toBe(1_000_020);
    expect(result.witness.authorizationCounter).toBe(1n);
    expect(state.provider.getLogs).not.toHaveBeenCalled();
    const store = await state.store(); const before = (await store.envelope()).head!;
    state.setHead(1_000_021);
    const originalHeader = state.contract.getStateSnapshotHeader.getMockImplementation()!;
    state.contract.getStateSnapshotHeader.mockImplementation(async (...args) => {
      const header = await originalHeader(...args);
      return args[0].blockTag === 1_000_021 ? { ...header, root: header.root + 1n } : header;
    });
    const originalRoot = state.contract.currentRoot.getMockImplementation()!;
    state.contract.currentRoot.mockImplementation(async (...args) => (await originalRoot(...args)) + (args[0].blockTag === 1_000_021 ? 1n : 0n));
    const originalCheckpoint = state.contract.getCheckpoint.getMockImplementation()!;
    state.contract.getCheckpoint.mockImplementation(async (...args) => {
      const checkpoint = await originalCheckpoint(...args);
      return args[1].blockTag === 1_000_021 ? { ...checkpoint, root: checkpoint.root + 1n } : checkpoint;
    });
    await expect(state.load()).rejects.toThrow("without a checkpoint update");
    expect((await store.envelope()).head).toEqual(before);
    expect(state.provider.getLogs).not.toHaveBeenCalled();
  });

  it("invalidates malformed saved checkpoint metadata before numeric parsing and repairs on retry", async () => {
    const state = fixture(); state.append(12, 17n); await state.load();
    const store = await state.store(); const head = (await store.envelope()).head!;
    await store.commit(head, { blockNumber: head.blockNumber, blockHash: head.blockHash,
      data: { ...head.data, checkpointId: "broken" } }, []);
    await expect(state.load()).rejects.toThrow("cached metadata");
    expect((await store.envelope()).head).toBeUndefined();
    await expect(state.load()).resolves.toMatchObject({ witness: { authorizationCounter: 1n } });
    expect(state.contract.getNodePage).toHaveBeenCalledTimes(2);
    expect(state.contract.getCounterProof).not.toHaveBeenCalled();
  });

  it("uses a new global snapshot for long-offline counter history without replaying logs", async () => {
    const state = fixture(); state.append(12, 17n); await state.load();
    state.setHead(25);
    // Keep a self-consistent current chain fixture without manufacturing 4097 past events.
    const original = state.contract.getStateSnapshotHeader.getMockImplementation()!;
    state.contract.getStateSnapshotHeader.mockImplementation(async (...args) => {
      const header = await original(...args);
      return args[0].blockTag === 25 ? { ...header, checkpointId: 5000n } : header;
    });
    const originalCheckpointId = state.contract.currentCheckpointId.getMockImplementation()!;
    state.contract.currentCheckpointId.mockImplementation(async (...args) => args[0].blockTag === 25 ? 5000n : originalCheckpointId(...args));
    const result = await state.load();
    expect(result.checkpointId).toBe(5000n);
    expect(state.contract.getNodePage).toHaveBeenLastCalledWith(1, 256, { blockTag: 25 });
    expect(state.provider.getLogs).not.toHaveBeenCalled();
  });

  it("rejects scope changes and emits aggregate progress without queried aliases", async () => {
    const state = fixture(); state.append(12, 17n);
    const progress: unknown[] = []; const unsubscribe = subscribePublicStateSyncProgress((event) => progress.push(event));
    try { await state.load(); } finally { unsubscribe(); }
    expect(progress).toEqual(expect.arrayContaining([expect.objectContaining({ domain: "authorization", phase: "download" }), expect.objectContaining({ phase: "verify" }), expect.objectContaining({ phase: "complete" })]));
    expect(progress.every((event) => !JSON.stringify(event).includes("alias"))).toBe(true);
    await expect(loadShieldedIdentityAuthorizationWitnessForMode(state.contract as unknown as Contract, 17n, undefined, { chainId: 1n, authorizationStateAddress: state.address })).rejects.toThrow("scope");
    state.provider.getNetwork.mockResolvedValueOnce({ chainId: 31337n }).mockResolvedValue({ chainId: 1n });
    await expect(state.load()).rejects.toThrow("scope changed");
  });
});

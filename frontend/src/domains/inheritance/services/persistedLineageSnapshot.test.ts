import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Interface } from "ethers";
import {
  SNARK_SCALAR_FIELD,
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  createLineageTree,
  wrapIdentityCommitmentAsPersonHash,
  type LineageTree,
} from "@deepfamily/protocol-core";
import type { IndexedVersion } from "./inheritanceChain";
import type { TargetedLineageRequest } from "./targetedInheritanceChain";
import type { LocalLineageRequest } from "./persistedLineageSnapshot";

vi.mock("../../../shared/config/env", () => ({
  getEventScanConfig: () => ({ fromBlock: 0, blockChunk: 10_000 }),
}));

const INDEX = "0x0000000000000000000000000000000000000011";
const FAMILY = "0x0000000000000000000000000000000000000022";
const ACCOUNT = "0x0000000000000000000000000000000000000033";
const ROOT_IC = 1000n, HEIR_IC = 2000n;
const hash = (identity: bigint) => wrapIdentityCommitmentAsPersonHash(identity).toLowerCase();
const ROOT = hash(ROOT_IC), HEIR = hash(HEIR_IC);
const blockHash = (block: number) => `0x${block.toString(16).padStart(64, "0")}`;
const iface = new Interface([
  "event LeafWritten(uint8 indexed treeId,uint256 indexed leafIndex,uint256 leaf,uint256 root)",
  "event VersionIndexed(bytes32 indexed personHash,uint256 indexed versionIndex,uint256 identityCommitment,uint256 fatherIdentityCommitment,uint256 motherIdentityCommitment)",
]);
const eligibility = [{ heirIdentityCommitment: HEIR_IC, rootIdentityCommitment: ROOT_IC, rootVersionIndex: 1 }];
const request: TargetedLineageRequest = { parentIdentityCommitments: [ROOT_IC], eligibility };

type Endorsement = { personHash: string; endorser: string; versionIndex: bigint; writtenAt: bigint; active: boolean };
type Trusted = { personHash: string; versionIndex: bigint; account: string; active: boolean };
type State = {
  trees: LineageTree[];
  versions: IndexedVersion[];
  endorsements: Endorsement[];
  trusted: Trusted[];
  checkpointId: bigint;
  createdAt: bigint;
};
type TestLog = {
  address: string; topics: readonly string[]; data: string; blockNumber: number;
  blockHash: string; index: number; removed: boolean;
};
type Filter = { address: string; fromBlock: number; toBlock: number; topics?: readonly (string | readonly string[] | null)[] };
type At = { blockTag: number };
function leaf(item: Endorsement, record: IndexedVersion) {
  return item.active ? computeLineageEndorsementLeaf({
    identityCommitment: record.identityCommitment,
    parentsDigest: computeLineageParentsDigest(record),
    versionIndex: item.versionIndex, endorser: item.endorser, writtenAt: item.writtenAt,
  }) : 0n;
}
function log(name: string, args: unknown[], block: number, index: number): TestLog {
  return { ...iface.encodeEventLog(iface.getEvent(name)!, args), address: INDEX,
    blockNumber: block, blockHash: blockHash(block), index, removed: false };
}
function fixture(size = 3) {
  const root: IndexedVersion = { personHash: ROOT, versionIndex: 1, identityCommitment: ROOT_IC,
    fatherIdentityCommitment: 0n, motherIdentityCommitment: 0n };
  const heir: IndexedVersion = { personHash: HEIR, versionIndex: 1, identityCommitment: HEIR_IC,
    fatherIdentityCommitment: ROOT_IC, motherIdentityCommitment: 0n };
  const endorsements: Endorsement[] = Array.from({ length: size }, (_, index) => ({
    personHash: index === 0 ? HEIR : hash(5000n + BigInt(index)), endorser: ACCOUNT,
    versionIndex: index === 0 ? 1n : 0n, writtenAt: index === 0 ? 100n : 0n, active: index === 0,
  }));
  const trusted: Trusted[] = [{ personHash: ROOT, versionIndex: 1n, account: ACCOUNT, active: true }];
  const trees = [createLineageTree(endorsements.map((item) => leaf(item, heir))),
    createLineageTree([computeLineageTrustedLeaf({ rootIdentityCommitment: ROOT_IC, rootVersionIndex: 1, account: ACCOUNT })])];
  const initial: State = { trees, versions: [root, heir], endorsements, trusted, checkpointId: 7n, createdAt: 900n };
  const states = new Map<number, State>([[10, initial]]);
  const logs: TestLog[] = [];
  let head = 10;
  const stateAt = (block: number) => {
    const available = [...states.keys()].filter((candidate) => candidate <= block).sort((a, b) => b - a);
    if (!available.length) throw new Error(`No fixture state at block ${block}`);
    return states.get(available[0])!;
  };
  const provider = {
    getNetwork: vi.fn(async () => ({ chainId: 31337n })),
    getCode: vi.fn(async (_address: string, _block: number) => "0x6000"),
    getBlockNumber: vi.fn(async () => head),
    getBlock: vi.fn(async (block?: number | string) => {
      const number = block === undefined || block === "latest" ? head : Number(block);
      return { number, hash: blockHash(number), timestamp: number * 100 };
    }),
    getLogs: vi.fn(async (filter: Filter) => {
      if (filter.address.toLowerCase() !== INDEX) throw new Error("Unexpected family log query");
      const topics = filter.topics?.[0];
      return logs.filter((item) => item.blockNumber >= filter.fromBlock && item.blockNumber <= filter.toBlock &&
        (!topics || (Array.isArray(topics) ? topics.includes(item.topics[0]) : topics === item.topics[0])));
    }),
  };
  const forbidden = (method: string) => vi.fn(async (..._args: unknown[]) => { throw new Error(`Target RPC forbidden: ${method}`); });
  const index = {
    runner: { provider }, interface: iface, getAddress: async () => INDEX,
    DEEP_FAMILY: vi.fn(async (_at: At) => FAMILY),
    root: vi.fn(async (tree: number, at: At) => stateAt(at.blockTag).trees[tree].root),
    size: vi.fn(async (tree: number, at: At) => stateAt(at.blockTag).trees[tree].sizeBigInt),
    versionMetadataCount: vi.fn(async (at: At) => BigInt(stateAt(at.blockTag).versions.length)),
    currentCheckpointId: vi.fn(async (at: At) => stateAt(at.blockTag).checkpointId),
    getCheckpoint: vi.fn(async (_id: bigint, at: At) => {
      const state = stateAt(at.blockTag);
      return { endorsementRoot: state.trees[0].root, trustedRoot: state.trees[1].root, createdAt: state.createdAt, retiredAt: 0n };
    }),
    getLeafPage: vi.fn(async (tree: number, start: number, count: number, at: At) =>
      stateAt(at.blockTag).trees[tree].leaves.slice(Number(start), Number(start) + Number(count))),
    getVersionPage: vi.fn(async (start: number, count: number, at: At) =>
      stateAt(at.blockTag).versions.slice(Number(start), Number(start) + Number(count)).map((item) => ({ ...item }))),
    getEndorsementPage: vi.fn(async (start: number, count: number, at: At) =>
      stateAt(at.blockTag).endorsements.slice(Number(start), Number(start) + Number(count)).map((item) => ({ ...item }))),
    getTrustedPage: vi.fn(async (start: number, count: number, at: At) =>
      stateAt(at.blockTag).trusted.slice(Number(start), Number(start) + Number(count)).map((item) => ({ ...item }))),
    getMerkleProof: forbidden("getMerkleProof"), identityCommitmentOf: forbidden("identityCommitmentOf"),
    versionParents: forbidden("versionParents"), parentsDigestOf: forbidden("parentsDigestOf"),
    getEndorsementMetadata: forbidden("getEndorsementMetadata"),
    endorsementLeafIndex: forbidden("endorsementLeafIndex"), trustedLeafIndex: forbidden("trustedLeafIndex"),
  };
  const family = {
    runner: { provider }, getAddress: async () => FAMILY,
    lineageIndex: vi.fn(async (_at: At) => INDEX),
    personVersionsCount: forbidden("personVersionsCount"), personVersionAt: forbidden("personVersionAt"),
    trustedEndorsersCount: forbidden("trustedEndorsersCount"), trustedEndorserAt: forbidden("trustedEndorserAt"),
    childrenCount: forbidden("childrenCount"), childrenOf: forbidden("childrenOf"), endorsedVersionIndex: forbidden("endorsedVersionIndex"),
  };
  const freshContracts = () => {
    const nextProvider = { ...provider, getNetwork: vi.fn(async () => ({ chainId: 31337n })) };
    return { index: { ...index, runner: { provider: nextProvider } }, family: { ...family, runner: { provider: nextProvider } }, provider: nextProvider };
  };
  const methods = [index.getLeafPage, index.getVersionPage, index.getEndorsementPage, index.getTrustedPage];
  const advance = (block = 11) => { head = block; };
  function endorseVersionTwo() {
    const nextRecord = { ...heir, versionIndex: 2 };
    const nextEndorsements = endorsements.map((item) => ({ ...item }));
    nextEndorsements[0] = { ...nextEndorsements[0], versionIndex: 2n, writtenAt: 1100n };
    const nextTrees = trees.map((tree) => tree.clone());
    const nextLeaf = leaf(nextEndorsements[0], nextRecord);
    nextTrees[0].update(0n, nextLeaf);
    states.set(11, { ...initial, trees: nextTrees, versions: [...initial.versions, nextRecord],
      endorsements: nextEndorsements, checkpointId: 8n, createdAt: 1100n });
    logs.push(log("VersionIndexed", [HEIR, 2, HEIR_IC, ROOT_IC, 0n], 11, 0),
      log("LeafWritten", [0, 0, nextLeaf, nextTrees[0].root], 11, 1));
    head = 11;
    return nextTrees;
  }
  return { index, family, provider, trees, states, logs, methods, freshContracts, advance, endorseVersionTwo };
}

async function loader() { return (await import("./persistedLineageSnapshot")).loadPersistedLineageSnapshot; }
async function load(f: ReturnType<typeof fixture>, options: LocalLineageRequest = request) {
  return (await loader())(f.index as any, f.family as any, options);
}
function assertNoTargetCalls(f: ReturnType<typeof fixture>) {
  for (const [name, method] of Object.entries({ ...f.family, ...f.index })) {
    if (/^(getMerkleProof|identityCommitmentOf|versionParents|parentsDigestOf|getEndorsementMetadata|endorsementLeafIndex|trustedLeafIndex|personVersionsCount|personVersionAt|trustedEndorsersCount|trustedEndorserAt|childrenCount|childrenOf|endorsedVersionIndex)$/.test(name))
      expect(method, name).not.toHaveBeenCalled();
  }
}
async function mutateCache(storeName: "records" | "heads", mutate: (row: any) => any | undefined) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open("deepfamily-public-state-v1", 1);
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      const cursor = transaction.objectStore(storeName).openCursor();
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) return;
        const changed = mutate(current.value);
        if (changed !== undefined) current.update(changed);
        current.continue();
      };
    });
  } finally { db.close(); }
}

describe("persistent global current lineage synchronization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", new IDBFactory());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("downloads bounded global current pages at one block and builds real authenticated funding paths", async () => {
    const f = fixture(257);
    const snapshot = await load(f);
    expect(snapshot.blockNumber).toBe(10);
    expect(snapshot.blockHash).toBe(blockHash(10));
    expect(snapshot.endorsementTree.root).toBe(f.trees[0].root);
    expect(snapshot.trustedTree.root).toBe(f.trees[1].root);
    const expectedPath = f.trees[0].generateProof(0n);
    expect(snapshot.endorsementTree.generateProof(0n)).toEqual({ ...expectedPath, index: BigInt(expectedPath.index) });
    expect(snapshot.versions.get(HEIR)?.[0].fatherIdentityCommitment).toBe(ROOT_IC);
    expect(snapshot.endorsements.get(HEIR)?.get(ACCOUNT)).toEqual({ versionIndex: 1, timestamp: 100n });
    expect(snapshot.trustedEndorsers.get(`${ROOT}:1`)).toEqual(new Set([ACCOUNT]));
    expect(f.provider.getLogs).not.toHaveBeenCalled();
    expect(f.index.getLeafPage.mock.calls).toEqual([[0, 0, 256, { blockTag: 10 }], [0, 256, 1, { blockTag: 10 }], [1, 0, 1, { blockTag: 10 }]]);
    for (const method of f.methods) for (const args of method.mock.calls) {
      expect(args[args.length - 1]).toEqual({ blockTag: 10 });
      expect(Number(args[args.length - 2])).toBeLessThanOrEqual(256);
      expect(Number(args[args.length - 2])).toBeGreaterThan(0);
    }
    assertNoTargetCalls(f);
  });

  it("resolves a public funding recipient from browser-local person metadata without an identity query", async () => {
    const f = fixture();
    const snapshot = await load(f, { publicEligibility: [{ heirPersonHash: HEIR,
      rootIdentityCommitment: ROOT_IC, rootVersionIndex: 1 }] });
    expect(snapshot.versions.get(HEIR)?.[0].identityCommitment).toBe(HEIR_IC);
    expect(snapshot.endorsements.get(HEIR)?.get(ACCOUNT)?.versionIndex).toBe(1);
    expect(snapshot.trustedEndorsers.get(`${ROOT}:1`)).toEqual(new Set([ACCOUNT]));
    expect(f.provider.getLogs).not.toHaveBeenCalled();
    assertNoTargetCalls(f);
  });

  it("reopens with a new provider and module realm using persisted state without replay or page redownload", async () => {
    const f = fixture();
    const first = await load(f);
    for (const method of f.methods) method.mockClear();
    vi.resetModules();
    const next = f.freshContracts();
    const restored = await (await loader())(next.index as any, next.family as any, request);
    expect(restored.endorsementTree.generateProof(0n)).toEqual(first.endorsementTree.generateProof(0n));
    for (const method of f.methods) expect(method).not.toHaveBeenCalled();
    expect(next.provider.getNetwork).toHaveBeenCalled();
    expect(next.provider.getLogs).not.toHaveBeenCalled();
    assertNoTargetCalls(f);
  });

  it("advances across a million unchanged blocks using global headers without scanning empty logs", async () => {
    const f = fixture();
    const first = await load(f);
    for (const method of f.methods) method.mockClear();
    f.provider.getLogs.mockClear();
    f.advance(1_000_000);
    const snapshot = await load(f);
    expect(snapshot.blockNumber).toBe(1_000_000);
    expect(snapshot.blockHash).toBe(blockHash(1_000_000));
    expect(snapshot.endorsementTree.root).toBe(first.endorsementTree.root);
    expect(snapshot.trustedTree.root).toBe(first.trustedTree.root);
    expect(f.index.currentCheckpointId).toHaveBeenCalledWith({ blockTag: 1_000_000 });
    expect(f.index.versionMetadataCount).toHaveBeenCalledWith({ blockTag: 1_000_000 });
    expect(f.provider.getLogs).not.toHaveBeenCalled();
    for (const method of f.methods) expect(method).not.toHaveBeenCalled();
    assertNoTargetCalls(f);
  });

  it("rejects an independent family provider that switches chains during final anchor validation", async () => {
    const f = fixture();
    const familyProvider = { ...f.provider, getNetwork: vi.fn(async () => ({ chainId: 1n })) };
    familyProvider.getNetwork.mockResolvedValueOnce({ chainId: 31337n });
    const family = { ...f.family, runner: { provider: familyProvider } };
    await expect((await loader())(f.index as any, family as any, request)).rejects.toThrow("Lineage synchronization anchor or scope changed");
    expect(familyProvider.getNetwork.mock.calls.length).toBeGreaterThanOrEqual(2);
    assertNoTargetCalls(f);
  });

  it("rejects two global version rows that would map distinct ordinals to the same key", async () => {
    const f = fixture();
    const original = f.index.getVersionPage.getMockImplementation()!;
    f.index.getVersionPage.mockImplementation(async (...args) => {
      const page = await original(...args);
      return page.map(() => ({ ...page[0] }));
    });
    await expect(load(f)).rejects.toMatchObject({ code: "snapshotMismatch" });
    assertNoTargetCalls(f);
  });

  it("rolls back a reorganized committed range before selecting local qualifications", async () => {
    const f = fixture();
    const initial = await load(f);
    f.endorseVersionTwo();
    expect((await load(f)).endorsements.get(HEIR)?.get(ACCOUNT)?.versionIndex).toBe(2);
    f.states.set(11, f.states.get(10)!);
    f.logs.length = 0;
    const original = f.provider.getBlock.getMockImplementation()!;
    f.provider.getBlock.mockImplementation(async (block) => {
      const value = await original(block);
      return value.number === 11 ? { ...value, hash: `0x${"bb".repeat(32)}` } : value;
    });
    for (const method of f.methods) method.mockClear();
    const restored = await load(f);
    expect(restored.blockHash).toBe(`0x${"bb".repeat(32)}`);
    expect(restored.checkpointId).toBe(7n);
    expect(restored.endorsementTree.root).toBe(initial.endorsementTree.root);
    expect(restored.endorsements.get(HEIR)?.get(ACCOUNT)?.versionIndex).toBe(1);
    expect(restored.versions.get(HEIR)?.map((item) => item.versionIndex)).toEqual([1]);
    for (const method of f.methods) expect(method).not.toHaveBeenCalled();
    assertNoTargetCalls(f);
  });

  it("redownloads global current state when a reorganized base has no retained journal", async () => {
    const f = fixture();
    const first = await load(f);
    const original = f.provider.getBlock.getMockImplementation()!;
    f.provider.getBlock.mockImplementation(async (block) => {
      const value = await original(block);
      return value.number === 10 ? { ...value, hash: `0x${"cc".repeat(32)}` } : value;
    });
    for (const method of f.methods) method.mockClear();
    const rebuilt = await load(f);
    expect(rebuilt.blockHash).toBe(`0x${"cc".repeat(32)}`);
    expect(rebuilt.endorsementTree.root).toBe(first.endorsementTree.root);
    expect(f.index.getLeafPage).toHaveBeenCalled();
    expect(f.provider.getLogs).not.toHaveBeenCalled();
    assertNoTargetCalls(f);
  });

  it("does not publish a bootstrap whose block changes while pages are downloaded", async () => {
    const f = fixture();
    const originalPage = f.index.getLeafPage.getMockImplementation()!;
    const originalBlock = f.provider.getBlock.getMockImplementation()!;
    f.index.getLeafPage.mockImplementation(async (...args) => {
      const page = await originalPage(...args);
      f.provider.getBlock.mockImplementation(async (block) => {
        const value = await originalBlock(block);
        return value.number === 10 ? { ...value, hash: `0x${"dd".repeat(32)}` } : value;
      });
      return page;
    });
    await expect(load(f)).rejects.toMatchObject({ code: "snapshotMismatch" });
    f.index.getLeafPage.mockImplementation(originalPage).mockClear();
    const rebuilt = await load(f);
    expect(rebuilt.blockHash).toBe(`0x${"dd".repeat(32)}`);
    expect(f.index.getLeafPage).toHaveBeenCalledWith(0, 0, 3, { blockTag: 10 });
    assertNoTargetCalls(f);
  });

  it("continues after the last complete page at the original pinned anchor before catching up", async () => {
    const f = fixture(257);
    const original = f.index.getLeafPage.getMockImplementation()!;
    f.index.getLeafPage.mockImplementation(async (tree, start, count, at) => {
      if (tree === 0 && start === 256) throw new Error("Page download interrupted");
      return original(tree, start, count, at);
    });
    await expect(load(f)).rejects.toThrow("Page download interrupted");
    f.index.getLeafPage.mockImplementation(original).mockClear();
    const updatedTrees = f.endorseVersionTwo();
    vi.resetModules();
    const next = f.freshContracts();
    const snapshot = await (await loader())(next.index as any, next.family as any, request);
    expect(snapshot.blockNumber).toBe(11);
    expect(snapshot.endorsementTree.root).toBe(updatedTrees[0].root);
    expect(f.index.getLeafPage.mock.calls).toEqual([[0, 256, 1, { blockTag: 10 }], [1, 0, 1, { blockTag: 10 }]]);
    expect(f.provider.getLogs).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 11, toBlock: 11 }));
    for (const [filter] of f.provider.getLogs.mock.calls) expect(filter.fromBlock).toBeGreaterThan(10);
    assertNoTargetCalls(f);
  });

  it.each(["metadata", "leaf", "root"] as const)("rejects a downloaded %s mismatch instead of publishing a snapshot", async (what) => {
    const f = fixture();
    if (what === "metadata") {
      const original = f.index.getEndorsementPage.getMockImplementation()!;
      f.index.getEndorsementPage.mockImplementation(async (...args) => {
        const page = await original(...args);
        return page.map((item, index) => index === 0 ? { ...item, writtenAt: 101n } : item);
      });
    } else if (what === "leaf") {
      const original = f.index.getLeafPage.getMockImplementation()!;
      f.index.getLeafPage.mockImplementation(async (...args) => {
        const page = await original(...args);
        return args[0] === 0 ? page.map((item, index) => index === 0 ? item + 1n : item) : page;
      });
    } else {
      const original = f.index.root.getMockImplementation()!;
      f.index.root.mockImplementation(async (...args) => (await original(...args)) + 1n);
    }
    await expect(load(f)).rejects.toMatchObject({ code: "snapshotMismatch" });
    assertNoTargetCalls(f);
  });

  it.each(["endorsement", "version", "leaf", "headRoot"] as const)("rejects modified persisted %s data before returning target eligibility", async (what) => {
    const f = fixture();
    await load(f);
    await mutateCache(what === "headRoot" ? "heads" : "records", (row) => {
      if (what === "endorsement" && row.kind === "endorsement" && row.key === "0") return { ...row, value: { ...row.value, writtenAt: 101n } };
      if (what === "version" && row.kind === "version" && row.value.personHash === HEIR) return { ...row, value: { ...row.value, fatherIdentityCommitment: 3000n } };
      if (what === "leaf" && row.kind === "lineage:0" && row.key === "0:0") return { ...row, value: SNARK_SCALAR_FIELD - 1n };
      if (what === "headRoot" && row.head) return { ...row, head: { ...row.head, data: { ...row.head.data, roots: ["1", row.head.data.roots[1]] } } };
    });
    vi.resetModules();
    const next = f.freshContracts();
    await expect((await loader())(next.index as any, next.family as any, request)).rejects.toMatchObject({
      code: what === "leaf" ? "LINEAGE_PROOF_ROOT_MISMATCH" : "snapshotMismatch",
    });
    for (const method of f.methods) method.mockClear();
    vi.resetModules();
    const retry = f.freshContracts();
    const recovered = await (await loader())(retry.index as any, retry.family as any, request);
    expect(recovered.endorsementTree.root).toBe(f.trees[0].root);
    expect(recovered.versions.get(HEIR)?.[0].fatherIdentityCommitment).toBe(ROOT_IC);
    expect(recovered.endorsements.get(HEIR)?.get(ACCOUNT)?.timestamp).toBe(100n);
    expect(f.index.getLeafPage).toHaveBeenCalledWith(0, 0, 3, { blockTag: 10 });
    expect(f.index.getVersionPage).toHaveBeenCalledWith(0, 2, { blockTag: 10 });
    expect(f.provider.getLogs).not.toHaveBeenCalled();
    assertNoTargetCalls(f);
  });

  it("applies only new global LeafWritten and VersionIndexed logs and rechecks current metadata pages", async () => {
    const f = fixture();
    await load(f);
    for (const method of f.methods) method.mockClear();
    const nextTrees = f.endorseVersionTwo();
    vi.resetModules();
    const next = f.freshContracts();
    const snapshot = await (await loader())(next.index as any, next.family as any, request);
    expect(snapshot.blockNumber).toBe(11);
    expect(snapshot.checkpointId).toBe(8n);
    expect(snapshot.endorsementTree.root).toBe(nextTrees[0].root);
    const expectedPath = nextTrees[0].generateProof(0n);
    expect(snapshot.endorsementTree.generateProof(0n)).toEqual({ ...expectedPath, index: BigInt(expectedPath.index) });
    expect(snapshot.endorsements.get(HEIR)?.get(ACCOUNT)).toEqual({ versionIndex: 2, timestamp: 1100n });
    expect(snapshot.versions.get(HEIR)?.map((record) => record.versionIndex)).toContain(2);
    expect(f.index.getLeafPage).not.toHaveBeenCalled();
    expect(f.index.getEndorsementPage).toHaveBeenCalledWith(0, 3, { blockTag: 11 });
    expect(f.index.getVersionPage).toHaveBeenCalledExactlyOnceWith(2, 1, { blockTag: 11 });
    expect(f.index.getTrustedPage).not.toHaveBeenCalled();
    for (const [filter] of f.provider.getLogs.mock.calls) {
      expect(filter.fromBlock).toBe(11);
      expect(filter.toBlock).toBe(11);
      expect(filter.topics).toHaveLength(1);
    }
    assertNoTargetCalls(f);
  });
});

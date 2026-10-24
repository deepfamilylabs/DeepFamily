import { describe, expect, it, vi } from "vitest";
import { ethers } from "ethers";
import {
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  createLineageTree,
  wrapIdentityCommitmentAsPersonHash,
} from "@deepfamily/protocol-core";
import DeepFamily from "../../../abi/DeepFamily.json";
import DeepFamilyLineageIndex from "../../../abi/DeepFamilyLineageIndex.json";
import { findHeirLegitimacy, loadLineageSnapshot } from "./inheritanceChain";

const INDEX = "0x00000000000000000000000000000000000000d1";
const FAMILY = "0x00000000000000000000000000000000000000d2";
const indexIface = new ethers.Interface(DeepFamilyLineageIndex.abi);
const familyIface = new ethers.Interface(DeepFamily.abi);

type TestLog = {
  address: string;
  topics: readonly string[];
  data: string;
  blockNumber: number;
  index: number;
};

function log(
  iface: ethers.Interface,
  address: string,
  name: string,
  args: unknown[],
  blockNumber: number,
  index = 0,
): TestLog {
  const { data, topics } = iface.encodeEventLog(iface.getEvent(name)!, args);
  return { address, topics, data, blockNumber, index };
}

function chainStub(logs: TestLog[], head = 10) {
  const provider = {
    getNetwork: vi.fn(async () => ({ chainId: 31337n })),
    getBlockNumber: vi.fn(async () => head),
    getBlock: vi.fn(async (_block?: number) => ({ hash: `0x${"aa".repeat(32)}`, timestamp: 1000 })),
    getLogs: vi.fn(
      async (filter: { address: string; topics: string[][]; fromBlock: number; toBlock: number }) =>
        logs.filter(
          (entry) =>
            entry.address === filter.address &&
            filter.topics[0].includes(entry.topics[0]) &&
            entry.blockNumber >= filter.fromBlock &&
            entry.blockNumber <= filter.toBlock,
        ),
    ),
  };
  const contract = <Extra extends object>(
    address: string,
    iface: ethers.Interface,
    extra: Extra = {} as Extra,
  ) => ({
    runner: { provider },
    interface: iface,
    getAddress: async () => address,
    currentCheckpointId: vi.fn(async () => 7n),
    getCheckpoint: vi.fn(async (_checkpointId?: bigint, _options?: { blockTag: number }) => ({
      endorsementRoot: await (extra as any).root(0),
      trustedRoot: await (extra as any).root(1),
      createdAt: 900n,
      retiredAt: 0n,
    })),
    ...extra,
  });
  return { provider, contract };
}

const ROOT_IC = 1_000n;
const HEIR_IC = 2_000n;
const OTHER_IC = 3_000n;
const ROOT = wrapIdentityCommitmentAsPersonHash(ROOT_IC);
const HEIR = wrapIdentityCommitmentAsPersonHash(HEIR_IC);
const [A, B, C, D] = ["a1", "b2", "c3", "d4"].map((suffix) => `0x${"0".repeat(38)}${suffix}`);

function endorsementLeaf(
  versionIndex: number,
  father: bigint,
  mother: bigint,
  endorser: string,
  at: bigint,
) {
  return computeLineageEndorsementLeaf({
    identityCommitment: HEIR_IC,
    parentsDigest: computeLineageParentsDigest({
      fatherIdentityCommitment: father,
      motherIdentityCommitment: mother,
    }),
    versionIndex,
    endorser,
    writtenAt: at,
  });
}

const trustedLeaf = (account: string) =>
  computeLineageTrustedLeaf({ rootIdentityCommitment: ROOT_IC, rootVersionIndex: 1, account });

describe("loadLineageSnapshot", () => {
  const leafWritten = (treeId: number, leafIndex: number, leaf: bigint, block: number) =>
    log(indexIface, INDEX, "LeafWritten", [treeId, leafIndex, leaf, 0n], block);
  // Out of order and across chunk edges; the write at block 5 replaces leaf 0.
  const logs = [
    leafWritten(0, 0, 7n, 5),
    leafWritten(0, 0, 5n, 2),
    leafWritten(1, 0, 9n, 4),
    leafWritten(0, 1, 6n, 3),
    log(indexIface, INDEX, "VersionIndexed", [HEIR, 1, HEIR_IC, ROOT_IC, 0n], 1),
    log(familyIface, FAMILY, "TrustedEndorserAdded", [ROOT, 1, A], 1),
    log(familyIface, FAMILY, "TrustedEndorserAdded", [ROOT, 1, B], 2),
    log(familyIface, FAMILY, "TrustedEndorserRemoved", [ROOT, 1, A], 6),
    log(familyIface, FAMILY, "PersonVersionEndorsed", [HEIR, A, 1, A, 0n, A, 0n, 0n, 100n], 3),
    log(familyIface, FAMILY, "PersonVersionEndorsed", [HEIR, A, 2, A, 0n, A, 0n, 0n, 300n], 7),
  ];
  const expectedRoots = (treeId: number) =>
    treeId === 0 ? createLineageTree([7n, 6n]).root : createLineageTree([9n]).root;

  it("replays every write in chain order and checks both roots at the scanned block", async () => {
    const chain = chainStub(logs);
    const index = chain.contract(INDEX, indexIface, {
      root: vi.fn(async (treeId: number) => expectedRoots(treeId)),
    });
    const snapshot = await loadLineageSnapshot(
      index as any,
      chain.contract(FAMILY, familyIface) as any,
      {
        fromBlock: 0,
        blockChunk: 3,
      },
    );

    expect(snapshot.endorsementTree.root).toBe(expectedRoots(0));
    expect(snapshot.trustedTree.root).toBe(expectedRoots(1));
    expect(snapshot).toMatchObject({
      checkpointId: 7n,
      timestamp: 1000n,
      blockHash: `0x${"aa".repeat(32)}`,
    });
    expect(index.currentCheckpointId).toHaveBeenCalledWith({ blockTag: 10 });
    expect(index.getCheckpoint).toHaveBeenCalledWith(7n, { blockTag: 10 });
    expect(index.root).toHaveBeenCalledWith(0, { blockTag: 10 });
    expect(snapshot.versions.get(HEIR.toLowerCase())?.[0]).toMatchObject({
      versionIndex: 1,
      fatherIdentityCommitment: ROOT_IC,
    });
    // A's later endorsement replaces the earlier one; A's removal leaves only B trusted.
    expect(snapshot.endorsements.get(HEIR.toLowerCase())?.get(A)).toEqual({
      versionIndex: 2,
      timestamp: 300n,
    });
    expect(snapshot.trustedEndorsers.get(`${ROOT.toLowerCase()}:1`)).toEqual(new Set([B]));
  });

  it("rejects checkpoint roots from a different snapshot", async () => {
    const chain = chainStub(logs);
    const index = chain.contract(INDEX, indexIface, {
      root: async (treeId: number) => expectedRoots(treeId),
      getCheckpoint: async () => ({
        endorsementRoot: expectedRoots(0),
        trustedRoot: 1n,
        createdAt: 900n,
        retiredAt: 0n,
      }),
    });
    await expect(
      loadLineageSnapshot(index as any, chain.contract(FAMILY, familyIface) as any),
    ).rejects.toMatchObject({ code: "snapshotMismatch" });
  });

  it.each(["currentCheckpointId", "getCheckpoint"])(
    "recognizes an older deployment that does not implement %s",
    async (method) => {
      const chain = chainStub(logs);
      const index = chain.contract(INDEX, indexIface, {
        root: async (treeId: number) => expectedRoots(treeId),
        [method]: async () => {
          throw ethers.makeError("execution reverted", "CALL_EXCEPTION", {
            action: "call",
            data: "0x",
            reason: null,
            transaction: { to: INDEX, data: "0x5488cc80" },
            invocation: null,
            revert: null,
          });
        },
      });
      await expect(
        loadLineageSnapshot(index as any, chain.contract(FAMILY, familyIface) as any),
      ).rejects.toMatchObject({ code: "lineageIncompatible" });
      expect(chain.provider.getLogs).not.toHaveBeenCalled();
    },
  );

  it("recognizes an empty checkpoint response without treating it as an empty family", async () => {
    const chain = chainStub(logs);
    const index = chain.contract(INDEX, indexIface, {
      currentCheckpointId: async () => {
        throw ethers.makeError("could not decode result data", "BAD_DATA", { value: "0x" });
      },
    });
    await expect(
      loadLineageSnapshot(index as any, chain.contract(FAMILY, familyIface) as any),
    ).rejects.toMatchObject({ code: "lineageIncompatible" });
  });

  it("preserves a temporary checkpoint request failure for retry", async () => {
    const chain = chainStub(logs);
    const failure = ethers.makeError("request timed out", "TIMEOUT", {
      operation: "call",
      reason: "timeout",
    });
    const index = chain.contract(INDEX, indexIface, {
      currentCheckpointId: async () => {
        throw failure;
      },
    });
    await expect(
      loadLineageSnapshot(index as any, chain.contract(FAMILY, familyIface) as any),
    ).rejects.toBe(failure);
  });

  it("rejects a snapshot whose block changed during replay", async () => {
    const chain = chainStub(logs);
    chain.provider.getBlock
      .mockResolvedValueOnce({ hash: `0x${"aa".repeat(32)}`, timestamp: 1000 })
      .mockResolvedValueOnce({ hash: `0x${"bb".repeat(32)}`, timestamp: 1000 });
    const index = chain.contract(INDEX, indexIface, {
      root: async (treeId: number) => expectedRoots(treeId),
    });
    await expect(
      loadLineageSnapshot(index as any, chain.contract(FAMILY, familyIface) as any),
    ).rejects.toThrow("reorganized");
  });

  it("never names a person in a log filter", async () => {
    const chain = chainStub(logs);
    const index = chain.contract(INDEX, indexIface, {
      root: async (id: number) => expectedRoots(id),
    });
    await loadLineageSnapshot(index as any, chain.contract(FAMILY, familyIface) as any);

    for (const [filter] of chain.provider.getLogs.mock.calls) {
      // One topic position: the event types. Nothing narrows by person, endorser, or version.
      expect(filter.topics).toHaveLength(1);
    }
  });

  it("refuses a rebuild whose root the contract never had", async () => {
    const chain = chainStub(logs);
    const index = chain.contract(INDEX, indexIface, {
      root: async (treeId: number) => (treeId === 0 ? 1n : expectedRoots(1)),
    });
    await expect(
      loadLineageSnapshot(index as any, chain.contract(FAMILY, familyIface) as any),
    ).rejects.toMatchObject({ code: "snapshotMismatch" });
  });
});

describe("verified lineage snapshot memory cache", () => {
  const firstEndorsement = endorsementLeaf(1, ROOT_IC, 0n, A, 100n);
  const firstTrusted = trustedLeaf(A);
  const leafWritten = (treeId: number, leafIndex: number, leaf: bigint, block: number, index = 0) =>
    log(indexIface, INDEX, "LeafWritten", [treeId, leafIndex, leaf, 0n], block, index);

  function fixture() {
    const logs = [
      log(indexIface, INDEX, "VersionIndexed", [HEIR, 1, HEIR_IC, ROOT_IC, 0n], 1),
      leafWritten(0, 0, firstEndorsement, 2),
      log(familyIface, FAMILY, "PersonVersionEndorsed", [HEIR, A, 1, A, 0n, A, 0n, 0n, 100n], 2, 1),
      leafWritten(1, 0, firstTrusted, 3),
      log(familyIface, FAMILY, "TrustedEndorserAdded", [ROOT, 1, A], 3, 1),
    ];
    const chain = chainStub(logs);
    let roots = [firstEndorsement, firstTrusted];
    const index = chain.contract(INDEX, indexIface, {
      root: vi.fn(async (treeId: number, _options?: { blockTag: number }) => roots[treeId]),
    });
    const family = chain.contract(FAMILY, familyIface);
    const load = (options: { fromBlock?: number; blockChunk?: number } = {}) =>
      loadLineageSnapshot(index as any, family as any, options);
    return {
      ...chain,
      logs,
      index,
      family,
      load,
      setRoots: (next: bigint[]) => {
        roots = next;
      },
    };
  }

  it("replays only new blocks by default and incrementally replaces versions, trust and endorsements", async () => {
    const f = fixture();
    const first = await f.load();
    expect(
      findHeirLegitimacy({
        snapshot: first,
        heir: { personHash: HEIR, identityCommitment: HEIR_IC },
        root: { identityCommitment: ROOT_IC },
        rootVersionIndex: 1,
      }),
    ).toHaveLength(1);
    f.provider.getLogs.mockClear();
    f.provider.getBlockNumber.mockResolvedValue(12);
    f.logs.push(
      log(indexIface, INDEX, "VersionIndexed", [HEIR, 2, HEIR_IC, OTHER_IC, ROOT_IC], 11),
      leafWritten(0, 0, endorsementLeaf(2, OTHER_IC, ROOT_IC, A, 200n), 11, 1),
      log(
        familyIface,
        FAMILY,
        "PersonVersionEndorsed",
        [HEIR, A, 2, A, 0n, A, 0n, 0n, 200n],
        11,
        2,
      ),
      leafWritten(1, 0, 0n, 12),
      log(familyIface, FAMILY, "TrustedEndorserRemoved", [ROOT, 1, A], 12, 1),
      leafWritten(1, 1, trustedLeaf(B), 12, 2),
      log(familyIface, FAMILY, "TrustedEndorserAdded", [ROOT, 1, B], 12, 3),
    );
    f.setRoots([
      endorsementLeaf(2, OTHER_IC, ROOT_IC, A, 200n),
      createLineageTree([0n, trustedLeaf(B)]).root,
    ]);
    const next = await f.load();
    expect(
      f.provider.getLogs.mock.calls.map(([filter]) => [filter.fromBlock, filter.toBlock]),
    ).toEqual([
      [11, 12],
      [11, 12],
    ]);
    for (const [filter] of f.provider.getLogs.mock.calls) expect(filter.topics).toHaveLength(1);
    expect(next.versions.get(HEIR.toLowerCase())?.map((version) => version.versionIndex)).toEqual([
      1, 2,
    ]);
    expect(next.endorsements.get(HEIR.toLowerCase())?.get(A)).toEqual({
      versionIndex: 2,
      timestamp: 200n,
    });
    expect(next.trustedEndorsers.get(`${ROOT.toLowerCase()}:1`)).toEqual(new Set([B]));
    expect(
      findHeirLegitimacy({
        snapshot: next,
        heir: { personHash: HEIR, identityCommitment: HEIR_IC },
        root: { identityCommitment: ROOT_IC },
        rootVersionIndex: 1,
      }),
    ).toEqual([]);
    expect(f.index.root).toHaveBeenCalledWith(0, { blockTag: 12 });
    expect(f.index.getCheckpoint).toHaveBeenLastCalledWith(7n, { blockTag: 12 });
  });

  it("makes no log request at the same head and advances a quiet checkpoint without rescanning old blocks", async () => {
    const f = fixture();
    await f.load();
    f.provider.getLogs.mockClear();
    const same = await f.load();
    expect(same.blockNumber).toBe(10);
    expect(f.provider.getLogs).not.toHaveBeenCalled();
    f.provider.getBlockNumber.mockResolvedValue(12);
    f.provider.getBlock.mockResolvedValue({ hash: `0x${"aa".repeat(32)}`, timestamp: 1200 });
    const quiet = await f.load();
    expect(quiet).toMatchObject({ blockNumber: 12, timestamp: 1200n });
    expect(
      f.provider.getLogs.mock.calls.map(([filter]) => [filter.fromBlock, filter.toBlock]),
    ).toEqual([
      [11, 12],
      [11, 12],
    ]);
    f.provider.getLogs.mockClear();
    f.provider.getBlockNumber.mockResolvedValue(13);
    await f.load();
    expect(
      f.provider.getLogs.mock.calls.map(([filter]) => [filter.fromBlock, filter.toBlock]),
    ).toEqual([
      [13, 13],
      [13, 13],
    ]);
  });

  it("keeps the configured scan floor when the starting block is ahead of the current head", async () => {
    const chain = chainStub([]);
    const index = chain.contract(INDEX, indexIface, { root: async () => 0n });
    const family = chain.contract(FAMILY, familyIface);
    await loadLineageSnapshot(index as any, family as any, { fromBlock: 100 });
    chain.provider.getBlockNumber.mockResolvedValue(20);
    await loadLineageSnapshot(index as any, family as any, { fromBlock: 100 });
    expect(chain.provider.getLogs).not.toHaveBeenCalled();
  });

  it.each(["changed anchor", "missing anchor", "head rollback"])(
    "discards the cache and fully replays after %s",
    async (scenario) => {
      const f = fixture();
      await f.load();
      f.provider.getLogs.mockClear();
      const newHead = scenario === "head rollback" ? 9 : 12;
      f.provider.getBlockNumber.mockResolvedValue(newHead);
      if (scenario !== "head rollback")
        f.provider.getBlock.mockImplementation(async (block) =>
          block === 10
            ? scenario === "missing anchor"
              ? (null as any)
              : { hash: `0x${"bb".repeat(32)}`, timestamp: 1000 }
            : { hash: `0x${"aa".repeat(32)}`, timestamp: 1000 },
        );
      const rebuilt = await f.load();
      expect(rebuilt.blockNumber).toBe(newHead);
      expect(
        f.provider.getLogs.mock.calls.map(([filter]) => [filter.fromBlock, filter.toBlock]),
      ).toEqual([
        [0, newHead],
        [0, newHead],
      ]);
    },
  );

  it("does not use a cached result when anchor RPC validation fails", async () => {
    const f = fixture();
    await f.load();
    f.provider.getLogs.mockClear();
    f.provider.getBlockNumber.mockResolvedValue(12);
    const failure = new Error("old anchor RPC unavailable");
    f.provider.getBlock
      .mockResolvedValueOnce({ hash: `0x${"aa".repeat(32)}`, timestamp: 1000 })
      .mockRejectedValueOnce(failure);
    await expect(f.load()).rejects.toBe(failure);
    expect(f.provider.getLogs).not.toHaveBeenCalled();
    await f.load();
    expect(
      f.provider.getLogs.mock.calls.map(([filter]) => [filter.fromBlock, filter.toBlock]),
    ).toEqual([
      [11, 12],
      [11, 12],
    ]);
  });

  it("does not use an old chain key after network identification fails", async () => {
    const f = fixture();
    await f.load();
    f.provider.getLogs.mockClear();
    const failure = new Error("network unavailable");
    f.provider.getNetwork.mockRejectedValueOnce(failure);
    await expect(f.load()).rejects.toBe(failure);
    expect(f.provider.getLogs).not.toHaveBeenCalled();
    await f.load();
    expect(f.provider.getLogs).not.toHaveBeenCalled();
  });

  it.each(["removed", "outside range"])(
    "rejects %s logs without publishing a delta",
    async (scenario) => {
      const f = fixture();
      await f.load();
      f.provider.getBlockNumber.mockResolvedValue(12);
      const invalid = {
        ...f.logs[0],
        ...(scenario === "removed" ? { removed: true, blockNumber: 11 } : {}),
      };
      f.provider.getLogs.mockResolvedValueOnce([invalid]);
      await expect(f.load()).rejects.toMatchObject({ code: "snapshotMismatch" });
      f.provider.getLogs.mockClear();
      await f.load();
      expect(f.provider.getLogs.mock.calls.every(([filter]) => filter.fromBlock === 11)).toBe(true);
    },
  );

  it("retries every delta after partial RPC failure and does not cache roots or checkpoint mismatches", async () => {
    const f = fixture();
    await f.load();
    f.provider.getBlockNumber.mockResolvedValue(12);
    f.logs.push(leafWritten(0, 0, 0n, 11));
    f.setRoots([0n, firstTrusted]);
    f.provider.getLogs.mockRejectedValueOnce(new Error("log RPC failed"));
    await expect(f.load()).rejects.toThrow("log RPC failed");
    f.provider.getLogs.mockClear();
    f.index.root
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(firstTrusted)
      .mockResolvedValueOnce(99n);
    await expect(f.load()).rejects.toMatchObject({ code: "snapshotMismatch" });
    f.index.getCheckpoint.mockResolvedValueOnce({
      endorsementRoot: 99n,
      trustedRoot: firstTrusted,
      createdAt: 900n,
      retiredAt: 0n,
    });
    await expect(f.load()).rejects.toMatchObject({ code: "snapshotMismatch" });
    const retry = await f.load();
    expect(retry.endorsementTree.root).toBe(0n);
    expect(
      f.provider.getLogs.mock.calls.every(
        ([filter]) => filter.fromBlock === 11 && filter.toBlock === 12,
      ),
    ).toBe(true);
    // Cancellation has no scanned family event, so the zeroed tree is authoritative.
    expect(retry.endorsements.get(HEIR.toLowerCase())?.has(A)).toBe(true);
    expect(
      findHeirLegitimacy({
        snapshot: retry,
        heir: { personHash: HEIR, identityCommitment: HEIR_IC },
        root: { identityCommitment: ROOT_IC },
        rootVersionIndex: 1,
      }),
    ).toEqual([]);
  });

  it("does not publish a delta whose final anchor changed, and retries from the old verified height", async () => {
    const f = fixture();
    await f.load();
    f.provider.getBlockNumber.mockResolvedValue(12);
    f.provider.getLogs.mockClear();
    f.provider.getBlock
      .mockResolvedValueOnce({ hash: `0x${"aa".repeat(32)}`, timestamp: 1000 })
      .mockResolvedValueOnce({ hash: `0x${"aa".repeat(32)}`, timestamp: 1000 })
      .mockResolvedValueOnce({ hash: `0x${"bb".repeat(32)}`, timestamp: 1000 });
    await expect(f.load()).rejects.toThrow("reorganized");
    await f.load();
    expect(f.provider.getLogs.mock.calls.every(([filter]) => filter.fromBlock === 11)).toBe(true);
  });

  it("isolates nested maps, arrays, version records, endorsement records and both trees from callers", async () => {
    const f = fixture();
    const exposed = await f.load();
    exposed.versions.get(HEIR.toLowerCase())![0].fatherIdentityCommitment = OTHER_IC;
    exposed.versions
      .get(HEIR.toLowerCase())!
      .push({ ...exposed.versions.get(HEIR.toLowerCase())![0], versionIndex: 99 });
    exposed.trustedEndorsers.get(`${ROOT.toLowerCase()}:1`)!.clear();
    exposed.endorsements.get(HEIR.toLowerCase())!.get(A)!.timestamp = 999n;
    exposed.endorsementTree.update(0n, 0n);
    exposed.trustedTree.insert(88n);
    const clean = await f.load();
    expect(clean.versions.get(HEIR.toLowerCase())).toHaveLength(1);
    expect(clean.versions.get(HEIR.toLowerCase())![0].fatherIdentityCommitment).toBe(ROOT_IC);
    expect(clean.trustedEndorsers.get(`${ROOT.toLowerCase()}:1`)).toEqual(new Set([A]));
    expect(clean.endorsements.get(HEIR.toLowerCase())?.get(A)?.timestamp).toBe(100n);
    expect(clean.endorsementTree.root).toBe(firstEndorsement);
    expect(clean.trustedTree.root).toBe(firstTrusted);
    expect(clean.endorsementTree).not.toBe(exposed.endorsementTree);
  });

  it("isolates index, family, provider, chain and configured start block", async () => {
    const f = fixture();
    await f.load();
    f.provider.getLogs.mockClear();
    const assertFullReplay = async (run: () => Promise<unknown>) => {
      f.provider.getLogs.mockClear();
      await run();
      expect(f.provider.getLogs.mock.calls.some(([filter]) => filter.fromBlock === 0)).toBe(true);
    };
    // Contract wrappers may be recreated without preventing reuse under the same provider.
    await f.load();
    expect(f.provider.getLogs).not.toHaveBeenCalled();
    const otherIndex = { ...f.index, getAddress: async () => `${INDEX.slice(0, -2)}e1` };
    f.provider.getLogs.mockImplementation(async (filter) =>
      f.logs.filter(
        (entry) =>
          filter.topics[0].includes(entry.topics[0]) &&
          entry.blockNumber >= filter.fromBlock &&
          entry.blockNumber <= filter.toBlock,
      ),
    );
    await assertFullReplay(() => loadLineageSnapshot(otherIndex as any, f.family as any));
    const otherFamily = { ...f.family, getAddress: async () => `${FAMILY.slice(0, -2)}e2` };
    await assertFullReplay(() => loadLineageSnapshot(f.index as any, otherFamily as any));
    f.provider.getNetwork.mockResolvedValue({ chainId: 1n });
    await assertFullReplay(() => f.load());
    f.provider.getNetwork.mockResolvedValue({ chainId: 31337n });
    // All real entries start at block 1, so changing fromBlock keeps the same roots.
    f.provider.getLogs.mockClear();
    await f.load({ fromBlock: 1 });
    expect(f.provider.getLogs.mock.calls.every(([filter]) => filter.fromBlock === 1)).toBe(true);
    const other = fixture();
    await other.load();
    expect(other.provider.getLogs.mock.calls.every(([filter]) => filter.fromBlock === 0)).toBe(
      true,
    );
    const separateFamily = { ...f.family, runner: { provider: other.provider } };
    f.provider.getLogs.mockClear();
    other.provider.getLogs.mockClear();
    await loadLineageSnapshot(f.index as any, separateFamily as any);
    expect(f.provider.getLogs.mock.calls[0][0].fromBlock).toBe(0);
    expect(other.provider.getLogs.mock.calls[0][0].fromBlock).toBe(0);
    other.provider.getNetwork.mockResolvedValue({ chainId: 1n });
    f.provider.getLogs.mockClear();
    other.provider.getLogs.mockClear();
    await expect(loadLineageSnapshot(f.index as any, separateFamily as any)).rejects.toThrow(
      "another chain",
    );
    expect(f.provider.getLogs).not.toHaveBeenCalled();
    expect(other.provider.getLogs).not.toHaveBeenCalled();
  });

  it("does not replace a newer verified cache when a lower-block concurrent request finishes later", async () => {
    const f = fixture();
    await f.load();
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = f.index.getCheckpoint.getMockImplementation()!;
    f.index.getCheckpoint.mockImplementation(async (...args) => {
      if ((args[1] as { blockTag: number }).blockTag === 11) {
        started();
        await waiting;
      }
      return original(...args);
    });
    f.provider.getBlockNumber.mockResolvedValue(11);
    const slow = f.load();
    await entered;
    f.provider.getBlockNumber.mockResolvedValue(12);
    const newer = await f.load();
    release();
    expect((await slow).blockNumber).toBe(11);
    expect(newer.blockNumber).toBe(12);
    f.provider.getLogs.mockClear();
    f.provider.getBlockNumber.mockResolvedValue(13);
    await f.load();
    expect(
      f.provider.getLogs.mock.calls.map(([filter]) => [filter.fromBlock, filter.toBlock]),
    ).toEqual([
      [13, 13],
      [13, 13],
    ]);
  });
});

describe("findHeirLegitimacy", () => {
  // Version 1 names the root as father, version 2 as mother. A endorsed version 1, then
  // switched to version 2; B endorsed version 1; C's endorsement was cancelled (its leaf zeroed);
  // D endorsed version 1 but is not a recommended source of the root version.
  const leaves = [
    endorsementLeaf(2, OTHER_IC, ROOT_IC, A, 300n),
    endorsementLeaf(1, ROOT_IC, 0n, B, 200n),
    0n,
    endorsementLeaf(1, ROOT_IC, 0n, D, 10n),
  ];
  const snapshot = {
    blockNumber: 9,
    checkpointId: 7n,
    checkpointCreatedAt: 0n,
    blockHash: `0x${"aa".repeat(32)}`,
    timestamp: 1000n,
    endorsementTree: createLineageTree(leaves),
    trustedTree: createLineageTree([trustedLeaf(A), trustedLeaf(B), trustedLeaf(C)]),
    versions: new Map([
      [
        HEIR.toLowerCase(),
        [
          {
            personHash: HEIR.toLowerCase(),
            versionIndex: 1,
            identityCommitment: HEIR_IC,
            fatherIdentityCommitment: ROOT_IC,
            motherIdentityCommitment: 0n,
          },
          {
            personHash: HEIR.toLowerCase(),
            versionIndex: 2,
            identityCommitment: HEIR_IC,
            fatherIdentityCommitment: OTHER_IC,
            motherIdentityCommitment: ROOT_IC,
          },
        ],
      ],
    ]),
    endorsements: new Map([
      [
        HEIR.toLowerCase(),
        new Map([
          [A, { versionIndex: 2, timestamp: 300n }],
          [B, { versionIndex: 1, timestamp: 200n }],
          [C, { versionIndex: 1, timestamp: 50n }],
          [D, { versionIndex: 1, timestamp: 10n }],
        ]),
      ],
    ]),
    trustedEndorsers: new Map(),
  };

  it("finds live endorsements by recommended sources, oldest first", () => {
    const found = findHeirLegitimacy({
      snapshot,
      heir: { personHash: HEIR, identityCommitment: HEIR_IC },
      root: { identityCommitment: ROOT_IC },
      rootVersionIndex: 1,
    });

    expect(found.map((entry) => entry.endorser)).toEqual([B, A]);
    expect(found[0]).toMatchObject({
      versionIndex: 1,
      rootIsMother: false,
      endorsementLeafIndex: 1n,
      trustedLeafIndex: 1n,
      writtenAt: 200n,
    });
    expect(found[1]).toMatchObject({
      versionIndex: 2,
      rootIsMother: true,
      endorsementLeafIndex: 0n,
      trustedLeafIndex: 0n,
      writtenAt: 300n,
    });
  });

  it("finds nothing under another root version", () => {
    const found = findHeirLegitimacy({
      snapshot,
      heir: { personHash: HEIR, identityCommitment: HEIR_IC },
      root: { identityCommitment: ROOT_IC },
      rootVersionIndex: 2,
    });
    expect(found).toEqual([]);
  });
});

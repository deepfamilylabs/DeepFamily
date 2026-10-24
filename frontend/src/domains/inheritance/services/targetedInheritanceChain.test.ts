import { describe, expect, it, vi } from "vitest";
import { Interface } from "ethers";
import {
  SNARK_SCALAR_FIELD,
  hashLineageNodes,
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  createLineageTree,
  buildLineageMerkleProof,
  wrapIdentityCommitmentAsPersonHash,
} from "@deepfamily/protocol-core";
import DeepFamily from "../../../abi/DeepFamily.json";
import { findHeirLegitimacy } from "./inheritanceChain";
import { loadTargetedLineageSnapshot } from "./targetedInheritanceChain";
import {
  listShieldedFundingChildren,
  listShieldedFundingParentVersions,
} from "./shieldedFundingFamily";
const INDEX = "0x0000000000000000000000000000000000000011",
  FAMILY = "0x0000000000000000000000000000000000000022",
  ACCOUNT = "0x0000000000000000000000000000000000000033";
const ROOT_IC = 1000n,
  HEIR_IC = 2000n;
const ROOT = wrapIdentityCommitmentAsPersonHash(ROOT_IC).toLowerCase(),
  HEIR = wrapIdentityCommitmentAsPersonHash(HEIR_IC).toLowerCase();
const ZERO = `0x${"00".repeat(32)}`,
  HASH = `0x${"aa".repeat(32)}`;
const iface = new Interface(DeepFamily.abi);
const digest = computeLineageParentsDigest({
  fatherIdentityCommitment: ROOT_IC,
  motherIdentityCommitment: 0n,
});
const endorsement = computeLineageEndorsementLeaf({
  identityCommitment: HEIR_IC,
  parentsDigest: digest,
  versionIndex: 1,
  endorser: ACCOUNT,
  writtenAt: 100n,
});
const trusted = computeLineageTrustedLeaf({
  rootIdentityCommitment: ROOT_IC,
  rootVersionIndex: 1,
  account: ACCOUNT,
});
function event(version = 1, at = 100, block = 4) {
  return {
    ...iface.encodeEventLog(iface.getEvent("PersonVersionEndorsed")!, [
      HEIR,
      ACCOUNT,
      version,
      ACCOUNT,
      0,
      ACCOUNT,
      0,
      0,
      at,
    ]),
    address: FAMILY,
    blockNumber: block,
    index: 1,
    removed: false,
  };
}
function fixture() {
  const trees = [
    createLineageTree([99n, endorsement, 98n]),
    createLineageTree([trusted, 97n, 96n]),
  ];
  const logs = [event()];
  const provider = {
    getNetwork: vi.fn(async () => ({ chainId: 31337n })),
    getBlockNumber: vi.fn(async () => 10),
    getBlock: vi.fn(async (_block?: number) => ({ hash: HASH, timestamp: 1000 })),
    getLogs: vi.fn(
      async (filter: {
        fromBlock: number;
        toBlock: number;
        topics: readonly (string | readonly string[] | null)[];
      }) =>
        logs.filter(
          (log) => log.blockNumber >= filter.fromBlock && log.blockNumber <= filter.toBlock,
        ),
    ),
  };
  const family = {
    runner: { provider },
    interface: iface,
    getAddress: async () => FAMILY,
    lineageIndex: vi.fn(async (_options?: unknown) => INDEX),
    personVersionsCount: vi.fn(async (_person?: string, _options?: unknown) => 1n),
    personVersionAt: vi.fn(async (person: string, index: number, _options?: unknown) => ({
      personHash: person,
      versionIndex: BigInt(index + 1),
      fatherHash: person === HEIR ? ROOT : ZERO,
      motherHash: ZERO,
    })),
    trustedEndorsersCount: vi.fn(
      async (_person?: string, _version?: number, _options?: unknown) => 1n,
    ),
    trustedEndorserAt: vi.fn(
      async (_person?: string, _version?: number, _index?: number, _options?: unknown) => ACCOUNT,
    ),
    childrenCount: vi.fn(async (_person?: string, _version?: number, _options?: unknown) => 1n),
    childrenOf: vi.fn(
      async (_person?: string, _version?: number, _index?: number, _options?: unknown) => ({
        childHash: HEIR,
        childVersionIndex: 1n,
      }),
    ),
    endorsedVersionIndex: vi.fn(
      async (_person?: string, _account?: string, _options?: unknown) => 1n,
    ),
  };
  const index = {
    runner: { provider },
    getAddress: async () => INDEX,
    DEEP_FAMILY: vi.fn(async (_options?: unknown) => FAMILY),
    root: vi.fn(async (id: number, _options?: unknown) => trees[id].root),
    size: vi.fn(async (id: number, _options?: unknown) => trees[id].sizeBigInt),
    getEndorsementMetadata: vi.fn(
      async (_person?: string, _account?: string, _options?: unknown) => ({
        versionIndex: 1n,
        writtenAt: 100n,
      }),
    ),
    currentCheckpointId: vi.fn(async (_options?: unknown) => 7n),
    getCheckpoint: vi.fn(async (_id?: bigint, _options?: unknown) => ({
      endorsementRoot: trees[0].root,
      trustedRoot: trees[1].root,
      createdAt: 900n,
      retiredAt: 0n,
    })),
    identityCommitmentOf: vi.fn(
      async (person: string, _options?: unknown): Promise<bigint> =>
        person === ROOT ? ROOT_IC : person === HEIR ? HEIR_IC : 0n,
    ),
    versionParents: vi.fn(async (person: string, _version?: number, _options?: unknown) => ({
      fatherIdentityCommitment: person === HEIR ? ROOT_IC : 0n,
      motherIdentityCommitment: 0n,
    })),
    parentsDigestOf: vi.fn(async (person: string, _version?: number, _options?: unknown) =>
      computeLineageParentsDigest({
        fatherIdentityCommitment: person === HEIR ? ROOT_IC : 0n,
        motherIdentityCommitment: 0n,
      }),
    ),
    trustedLeafIndex: vi.fn(
      async (_person?: string, _version?: number, _account?: string, _options?: unknown) => ({
        exists: true,
        leafIndex: 0n,
      }),
    ),
    endorsementLeafIndex: vi.fn(
      async (_person?: string, _account?: string, _options?: unknown) => ({
        exists: true,
        leafIndex: 1n,
      }),
    ),
    getMerkleProof: vi.fn(async (id: number, slot: bigint, _options?: unknown) => {
      const proof = trees[id].generateProof(slot);
      return {
        leaf: proof.leaf,
        proofRoot: proof.root,
        proofIndex: proof.index,
        proofDepth: proof.siblings.length,
        siblings: proof.siblings,
      };
    }),
  };
  const eligibility = [
    { heirIdentityCommitment: HEIR_IC, rootIdentityCommitment: ROOT_IC, rootVersionIndex: 1 },
  ];
  const load = (request: Parameters<typeof loadTargetedLineageSnapshot>[2] = { eligibility }) =>
    loadTargetedLineageSnapshot(index as any, family as any, request);
  return { provider, index, family, trees, logs, eligibility, load };
}
describe("targeted on-chain lineage paths", () => {
  it("loads funding choices and authenticated paths without global tree replay", async () => {
    const f = fixture(),
      snapshot = await f.load({ parentIdentityCommitments: [ROOT_IC] });
    expect(
      listShieldedFundingParentVersions({ snapshot, parentIdentityCommitment: ROOT_IC }),
    ).toEqual([1]);
    expect(
      listShieldedFundingChildren({
        snapshot,
        parentIdentityCommitment: ROOT_IC,
        rootVersionIndex: 1,
        asOf: 1000n,
      }),
    ).toEqual([{ personHash: HEIR, eligible: true }]);
    const found = findHeirLegitimacy({
      snapshot,
      heir: { personHash: HEIR, identityCommitment: HEIR_IC },
      root: { identityCommitment: ROOT_IC },
      rootVersionIndex: 1,
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      endorsementLeafIndex: 1n,
      trustedLeafIndex: 0n,
      writtenAt: 100n,
    });
    expect(buildLineageMerkleProof(snapshot.endorsementTree, 1n)).toMatchObject({
      root: f.trees[0].root,
      leaf: endorsement,
    });
    expect(snapshot.endorsementTree.sizeBigInt).toBe(3n);
    expect(snapshot.endorsementTree.leaves).toEqual([endorsement]);
    expect(() => snapshot.endorsementTree.generateProof(0n)).toThrow("not requested");
    expect(f.provider.getLogs).not.toHaveBeenCalled();
  });
  it("loads a selected Claim or Fund qualification without children or unrelated versions", async () => {
    const f = fixture(),
      snapshot = await f.load();
    expect(snapshot.versions.get(HEIR)).toHaveLength(1);
    expect(f.family.childrenCount).not.toHaveBeenCalled();
    expect(f.family.childrenOf).not.toHaveBeenCalled();
    expect(f.family.personVersionAt).toHaveBeenCalledTimes(2);
    expect(snapshot).toMatchObject({
      blockNumber: 10,
      checkpointId: 7n,
      timestamp: 1000n,
      blockHash: HASH,
    });
  });
  it("supports parent selection with child enumeration disabled", async () => {
    const f = fixture();
    await f.load({
      parentIdentityCommitments: [ROOT_IC],
      includeChildren: false,
      eligibility: f.eligibility,
    });
    expect(f.family.childrenCount).not.toHaveBeenCalled();
  });
  it("fixes every metadata and proof read to one block and rechecks its anchor", async () => {
    const f = fixture();
    await f.load({ eligibility: f.eligibility, blockNumber: 9 });
    for (const method of [
      f.family.lineageIndex,
      f.family.personVersionsCount,
      f.family.personVersionAt,
      f.family.trustedEndorsersCount,
      f.family.trustedEndorserAt,
      f.family.endorsedVersionIndex,
      f.index.DEEP_FAMILY,
      f.index.root,
      f.index.size,
      f.index.currentCheckpointId,
      f.index.getCheckpoint,
      f.index.getEndorsementMetadata,
      f.index.identityCommitmentOf,
      f.index.parentsDigestOf,
      f.index.versionParents,
      f.index.trustedLeafIndex,
      f.index.endorsementLeafIndex,
      f.index.getMerkleProof,
    ])
      for (const args of method.mock.calls) expect(args[args.length - 1]).toEqual({ blockTag: 9 });
    expect(f.provider.getBlock.mock.calls.map((args) => args[0])).toEqual([9, 9]);
    expect(f.provider.getLogs).not.toHaveBeenCalled();
  });
  it("treats cancelled endorsements as ineligible without scanning former events", async () => {
    const f = fixture();
    f.family.endorsedVersionIndex.mockResolvedValue(0n);
    f.index.getEndorsementMetadata.mockResolvedValue({ versionIndex: 0n, writtenAt: 0n });
    f.trees[0].update(1n, 0n);
    const snapshot = await f.load();
    expect(
      findHeirLegitimacy({
        snapshot,
        heir: { personHash: HEIR, identityCommitment: HEIR_IC },
        root: { identityCommitment: ROOT_IC },
        rootVersionIndex: 1,
      }),
    ).toEqual([]);
    expect(f.provider.getLogs).not.toHaveBeenCalled();
  });
  it("binds replacement endorsements to the current version and timestamp", async () => {
    const f = fixture();
    f.trees[0].update(
      1n,
      computeLineageEndorsementLeaf({
        identityCommitment: HEIR_IC,
        parentsDigest: digest,
        versionIndex: 2,
        endorser: ACCOUNT,
        writtenAt: 200n,
      }),
    );
    f.family.personVersionsCount.mockResolvedValue(2n);
    f.family.endorsedVersionIndex.mockResolvedValue(2n);
    f.index.getEndorsementMetadata.mockResolvedValue({ versionIndex: 2n, writtenAt: 200n });
    f.logs.push(event(2, 200, 8));
    const snapshot = await f.load();
    expect(snapshot.endorsements.get(HEIR)?.get(ACCOUNT)).toEqual({
      versionIndex: 2,
      timestamp: 200n,
    });
    expect(snapshot.versions.get(HEIR)?.map((v) => v.versionIndex)).toEqual([2]);
  });
  it.each(["root", "leaf", "sibling", "index", "depth", "field", "overlong"])(
    "rejects a forged %s in a proof response",
    async (attack) => {
      const f = fixture(),
        original = f.index.getMerkleProof.getMockImplementation()!;
      f.index.getMerkleProof.mockImplementation(async (...args) => {
        const proof = await original(...args);
        if (attack === "root") proof.proofRoot += 1n;
        if (attack === "leaf") proof.leaf! += 1n;
        if (attack === "sibling") proof.siblings[0] += 1n;
        if (attack === "index") proof.proofIndex = Number(proof.proofIndex) ^ 1;
        if (attack === "depth") proof.proofDepth++;
        if (attack === "field") proof.siblings[0] = SNARK_SCALAR_FIELD;
        if (attack === "overlong") proof.siblings = Array(65).fill(1n);
        return proof;
      });
      await expect(f.load()).rejects.toThrow();
    },
  );
  it.each([
    "checkpoint",
    "retired checkpoint",
    "future checkpoint",
    "binding",
    "person hash",
    "parents",
  ])("rejects inconsistent %s metadata", async (attack) => {
    const f = fixture();
    if (attack === "checkpoint")
      f.index.getCheckpoint.mockResolvedValue({
        endorsementRoot: 3n,
        trustedRoot: f.trees[1].root,
        createdAt: 900n,
        retiredAt: 0n,
      });
    if (attack === "retired checkpoint")
      f.index.getCheckpoint.mockResolvedValue({
        endorsementRoot: f.trees[0].root,
        trustedRoot: f.trees[1].root,
        createdAt: 900n,
        retiredAt: 950n,
      });
    if (attack === "future checkpoint")
      f.index.getCheckpoint.mockResolvedValue({
        endorsementRoot: f.trees[0].root,
        trustedRoot: f.trees[1].root,
        createdAt: 1001n,
        retiredAt: 0n,
      });
    if (attack === "binding") f.index.DEEP_FAMILY.mockResolvedValue(INDEX);
    if (attack === "person hash") f.index.identityCommitmentOf.mockResolvedValue(777n);
    if (attack === "parents") f.index.parentsDigestOf.mockResolvedValue(8n);
    await expect(f.load()).rejects.toMatchObject({ code: "snapshotMismatch" });
  });
  it("rejects reorganized candidates and allows a fresh retry", async () => {
    const f = fixture();
    f.provider.getBlock
      .mockResolvedValueOnce({ hash: HASH, timestamp: 1000 })
      .mockResolvedValueOnce({ hash: ZERO, timestamp: 1000 });
    await expect(f.load()).rejects.toThrow("reorganized");
    await expect(f.load()).resolves.toMatchObject({ blockHash: HASH });
  });
  it.each(["versions", "children", "trusted"])(
    "fails explicitly at its %s limit without hiding eligibility",
    async (limit) => {
      const f = fixture();
      let request: Parameters<typeof loadTargetedLineageSnapshot>[2] = {
        parentIdentityCommitments: [ROOT_IC],
        limits: { records: 20 },
      };
      if (limit === "versions") f.family.personVersionsCount.mockResolvedValue(1000n);
      if (limit === "children") f.family.childrenCount.mockResolvedValue(1000n);
      if (limit === "trusted") f.family.trustedEndorsersCount.mockResolvedValue(1000n);
      await expect(f.load(request)).rejects.toMatchObject({ code: "lineageSnapshotLimit" });
    },
  );
  it("fails incompatible for an old index without metadata instead of replaying history", async () => {
    const f = fixture();
    await expect(
      loadTargetedLineageSnapshot(
        { ...f.index, getEndorsementMetadata: undefined } as any,
        f.family as any,
        { eligibility: f.eligibility },
      ),
    ).rejects.toMatchObject({ code: "lineageIncompatible" });
    expect(f.provider.getLogs).not.toHaveBeenCalled();
  });
  it.each(["wrong version", "wrong timestamp", "future timestamp", "uncleared timestamp"])(
    "rejects %s endorsement metadata",
    async (attack) => {
      const f = fixture();
      if (attack === "wrong version")
        f.index.getEndorsementMetadata.mockResolvedValue({ versionIndex: 2n, writtenAt: 100n });
      if (attack === "wrong timestamp")
        f.index.getEndorsementMetadata.mockResolvedValue({ versionIndex: 1n, writtenAt: 101n });
      if (attack === "future timestamp")
        f.index.getEndorsementMetadata.mockResolvedValue({ versionIndex: 1n, writtenAt: 1001n });
      if (attack === "uncleared timestamp") {
        f.family.endorsedVersionIndex.mockResolvedValue(0n);
        f.index.getEndorsementMetadata.mockResolvedValue({ versionIndex: 0n, writtenAt: 100n });
      }
      await expect(f.load()).rejects.toMatchObject({ code: "snapshotMismatch" });
    },
  );
  it("retains an unregistered co-parent opening without requiring that parent's own record", async () => {
    const f = fixture(),
      otherIdentity = 3000n,
      otherHash = wrapIdentityCommitmentAsPersonHash(otherIdentity).toLowerCase();
    const originalRecord = f.family.personVersionAt.getMockImplementation()!;
    const originalParents = f.index.versionParents.getMockImplementation()!;
    f.family.personVersionAt.mockImplementation(async (...args) => ({
      ...(await originalRecord(...args)),
      motherHash: args[0] === HEIR ? otherHash : ZERO,
    }));
    f.index.versionParents.mockImplementation(async (...args) => ({
      ...(await originalParents(...args)),
      motherIdentityCommitment: args[0] === HEIR ? otherIdentity : 0n,
    }));
    const otherDigest = computeLineageParentsDigest({
      fatherIdentityCommitment: ROOT_IC,
      motherIdentityCommitment: otherIdentity,
    });
    f.index.parentsDigestOf.mockImplementation(async (person) =>
      person === HEIR
        ? otherDigest
        : computeLineageParentsDigest({
            fatherIdentityCommitment: 0n,
            motherIdentityCommitment: 0n,
          }),
    );
    f.trees[0].update(
      1n,
      computeLineageEndorsementLeaf({
        identityCommitment: HEIR_IC,
        parentsDigest: otherDigest,
        versionIndex: 1,
        endorser: ACCOUNT,
        writtenAt: 100n,
      }),
    );
    const snapshot = await f.load();
    expect(snapshot.versions.get(HEIR)?.[0].motherIdentityCommitment).toBe(otherIdentity);
    expect(f.index.identityCommitmentOf.mock.calls.every((args) => args[0] !== otherHash)).toBe(
      true,
    );
    expect(
      findHeirLegitimacy({
        snapshot,
        heir: { personHash: HEIR, identityCommitment: HEIR_IC },
        root: { identityCommitment: ROOT_IC },
        rootVersionIndex: 1,
      }),
    ).toHaveLength(1);
  });
  it("includes the unspecified parent-version child bucket in funding choices", async () => {
    const f = fixture();
    f.family.childrenCount.mockImplementation(async (_person, version) =>
      version === 0 ? 1n : 0n,
    );
    const snapshot = await f.load({ parentIdentityCommitments: [ROOT_IC] });
    expect(f.family.childrenOf.mock.calls.map((args) => args[1])).toEqual([0]);
    expect(
      listShieldedFundingChildren({
        snapshot,
        parentIdentityCommitment: ROOT_IC,
        rootVersionIndex: 1,
        asOf: 1000n,
      }),
    ).toEqual([{ personHash: HEIR, eligible: true }]);
  });
  it("does not restrict child qualification to the bucket's parent version", async () => {
    const f = fixture();
    f.family.personVersionsCount.mockImplementation(async (person) => (person === ROOT ? 2n : 1n));
    f.family.childrenCount.mockImplementation(async (_person, version) =>
      version === 1 ? 1n : 0n,
    );
    f.family.trustedEndorsersCount.mockImplementation(async (_person, version) =>
      version === 2 ? 1n : 0n,
    );
    const trustedV2 = computeLineageTrustedLeaf({
      rootIdentityCommitment: ROOT_IC,
      rootVersionIndex: 2,
      account: ACCOUNT,
    });
    f.trees[1].update(0n, trustedV2);
    const snapshot = await f.load({ parentIdentityCommitments: [ROOT_IC] });
    expect(
      listShieldedFundingChildren({
        snapshot,
        parentIdentityCommitment: ROOT_IC,
        rootVersionIndex: 2,
        asOf: 1000n,
      }),
    ).toEqual([{ personHash: HEIR, eligible: true }]);
  });
  it("uses bounded paths when the global trees have over a trillion leaf slots", async () => {
    const f = fixture(),
      size = 1n << 40n,
      siblings = Array<bigint>(40).fill(7n);
    const fold = (leaf: bigint, index: bigint) =>
      siblings.reduce(
        (node, sibling, level) =>
          (index >> BigInt(level)) & 1n
            ? hashLineageNodes(sibling, node)
            : hashLineageNodes(node, sibling),
        leaf,
      );
    const roots = [fold(endorsement, 1n), fold(trusted, 0n)];
    f.index.size.mockResolvedValue(size);
    f.index.root.mockImplementation(async (id) => roots[id]);
    f.index.getCheckpoint.mockResolvedValue({
      endorsementRoot: roots[0],
      trustedRoot: roots[1],
      createdAt: 900n,
      retiredAt: 0n,
    });
    f.index.getMerkleProof.mockImplementation(async (id, index) => ({
      leaf: id === 0 ? endorsement : trusted,
      proofRoot: roots[id],
      proofIndex: index,
      proofDepth: 40,
      siblings: [...siblings],
    }));
    const snapshot = await f.load();
    expect(snapshot.endorsementTree.sizeBigInt).toBe(size);
    expect(snapshot.endorsementTree.leaves).toHaveLength(1);
    expect(f.index.getMerkleProof).toHaveBeenCalledTimes(2);
    expect(f.provider.getLogs).not.toHaveBeenCalled();
    expect(buildLineageMerkleProof(snapshot.endorsementTree, 1n).depth).toBe(40);
  });
  it("rejects missing current parent-opening support without falling back to logs", async () => {
    const f = fixture();
    await expect(
      loadTargetedLineageSnapshot(
        { ...f.index, versionParents: undefined } as any,
        f.family as any,
        { eligibility: f.eligibility },
      ),
    ).rejects.toMatchObject({ code: "lineageIncompatible" });
    expect(f.provider.getLogs).not.toHaveBeenCalled();
  });
  it("isolates proof arrays and clone copies, and refuses mutation APIs", async () => {
    const f = fixture(),
      first = await f.load(),
      proof = first.endorsementTree.generateProof(1n);
    proof.siblings[0] = 0n;
    expect(first.endorsementTree.generateProof(1n).siblings[0]).not.toBe(0n);
    const clone = first.endorsementTree.clone();
    expect(clone).not.toBe(first.endorsementTree);
    expect(clone.generateProof(1n)).toEqual(first.endorsementTree.generateProof(1n));
    expect(() => clone.update(1n, 1n)).toThrow("read-only");
    expect(() => clone.insert(1n)).toThrow("read-only");
    first.versions.clear();
    first.endorsements.clear();
    const second = await f.load();
    expect(second.versions.size).toBe(2);
    expect(second.endorsements.get(HEIR)?.has(ACCOUNT)).toBe(true);
  });
});

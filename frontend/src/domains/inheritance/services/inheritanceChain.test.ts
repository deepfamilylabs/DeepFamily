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
import FamilyInheritance from "../../../abi/FamilyInheritance.json";
import {
  findHeirLegitimacy,
  listInheritancesForCredential,
  loadLineageSnapshot,
  loadRootRegistry,
  countTrustedEndorsers,
} from "./inheritanceChain";

const INDEX = "0x00000000000000000000000000000000000000d1";
const FAMILY = "0x00000000000000000000000000000000000000d2";
const INHERITANCE = "0x00000000000000000000000000000000000000d3";
const indexIface = new ethers.Interface(DeepFamilyLineageIndex.abi);
const familyIface = new ethers.Interface(DeepFamily.abi);
const inheritanceIface = new ethers.Interface(FamilyInheritance.abi);

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
    getBlockNumber: vi.fn(async () => head),
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
    expect(countTrustedEndorsers(snapshot, ROOT, 1)).toBe(1);
  });

  it("never names a person in a log filter", async () => {
    const chain = chainStub(logs);
    const index = chain.contract(INDEX, indexIface, {
      root: async (id: number) => expectedRoots(id),
    });
    await loadLineageSnapshot(index as any, chain.contract(FAMILY, familyIface) as any);
    await loadRootRegistry(index as any, chain.contract(FAMILY, familyIface) as any);

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

describe("listInheritancesForCredential", () => {
  it("scans every creation and matches the credential locally", async () => {
    const creator = "0x00000000000000000000000000000000000000e1";
    const chain = chainStub([
      log(inheritanceIface, INHERITANCE, "InheritanceCreated", [1n, 11n, creator, 5n, 1n, 1n], 2),
      log(inheritanceIface, INHERITANCE, "InheritanceCreated", [2n, 22n, creator, 6n, 2n, 2n], 3),
      log(inheritanceIface, INHERITANCE, "InheritanceCreated", [3n, 11n, creator, 7n, 3n, 3n], 4),
    ]);
    const inheritance = chain.contract(INHERITANCE, inheritanceIface, {
      inheritanceOf: vi.fn(async (id: bigint) => ({
        startTime: id * 10n,
        amountPerPeriod: id,
        balance: id * 100n,
      })),
      claimed: vi.fn(async () => 4n),
    });

    const rows = await listInheritancesForCredential(inheritance as any, 11n, 99n);

    expect(rows.map((row) => row.id)).toEqual([1n, 3n]);
    expect(rows[1]).toEqual({
      id: 3n,
      startTime: 30n,
      amountPerPeriod: 3n,
      balance: 300n,
      claimed: 4n,
    });
    expect(inheritance.claimed).toHaveBeenCalledWith(3n, 99n);
    expect(chain.provider.getLogs.mock.calls[0][0].topics).toEqual([
      [inheritanceIface.getEvent("InheritanceCreated")!.topicHash],
    ]);
  });
});

import { describe, expect, it } from "vitest";
import {
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  createLineageTree,
  wrapIdentityCommitmentAsPersonHash,
} from "@deepfamily/protocol-core";
import type { IndexedVersion, LineageSnapshot } from "./inheritanceChain";
import {
  getShieldedFundingFamilyOptions,
  listShieldedFundingChildren,
  listShieldedFundingParentVersions,
} from "./shieldedFundingFamily";

const FATHER = 100n;
const MOTHER = 200n;
const CHILD = 300n;
const OTHER_FATHER = 400n;
const GRANDFATHER = 500n;
const A = `0x${"0".repeat(38)}a1`;
const B = `0x${"0".repeat(38)}b2`;
const AS_OF = 1_000n;
const hash = (identity: bigint) => wrapIdentityCommitmentAsPersonHash(identity).toLowerCase();

function version(
  identityCommitment: bigint,
  versionIndex: number,
  fatherIdentityCommitment = 0n,
  motherIdentityCommitment = 0n,
): IndexedVersion {
  return {
    personHash: hash(identityCommitment),
    identityCommitment,
    versionIndex,
    fatherIdentityCommitment,
    motherIdentityCommitment,
  };
}

type Endorsement = { version: IndexedVersion; account: string; timestamp: bigint; live?: boolean };
type Trusted = { identity: bigint; versionIndex: number; account: string; live?: boolean };

function snapshot({
  records = [
    version(FATHER, 1, GRANDFATHER),
    version(FATHER, 2, GRANDFATHER),
    version(MOTHER, 1),
    version(MOTHER, 2),
    version(CHILD, 1, FATHER, MOTHER),
    version(GRANDFATHER, 1),
    version(OTHER_FATHER, 1),
  ],
  endorsements = [{ version: version(CHILD, 1, FATHER, MOTHER), account: A, timestamp: 100n }],
  trusted = [
    { identity: FATHER, versionIndex: 1, account: A },
    { identity: FATHER, versionIndex: 2, account: A },
    { identity: MOTHER, versionIndex: 1, account: A },
    { identity: MOTHER, versionIndex: 2, account: A },
  ],
}: {
  records?: IndexedVersion[];
  endorsements?: Endorsement[];
  trusted?: Trusted[];
} = {}): LineageSnapshot {
  const versions: LineageSnapshot["versions"] = new Map();
  for (const record of records) {
    versions.set(record.personHash, [...(versions.get(record.personHash) ?? []), record]);
  }
  const current: LineageSnapshot["endorsements"] = new Map();
  for (const endorsement of endorsements) {
    const personHash = endorsement.version.personHash;
    const endorserMap = current.get(personHash) ?? new Map();
    endorserMap.set(endorsement.account, {
      versionIndex: endorsement.version.versionIndex,
      timestamp: endorsement.timestamp,
    });
    current.set(personHash, endorserMap);
  }
  return {
    blockNumber: 10,
    versions,
    endorsements: current,
    trustedEndorsers: new Map(),
    endorsementTree: createLineageTree(
      endorsements.map((entry) =>
        entry.live === false
          ? 0n
          : computeLineageEndorsementLeaf({
              identityCommitment: entry.version.identityCommitment,
              parentsDigest: computeLineageParentsDigest(entry.version),
              versionIndex: entry.version.versionIndex,
              endorser: entry.account,
              writtenAt: entry.timestamp,
            }),
      ),
    ),
    trustedTree: createLineageTree(
      trusted.map((entry) =>
        entry.live === false
          ? 0n
          : computeLineageTrustedLeaf({
              rootIdentityCommitment: entry.identity,
              rootVersionIndex: entry.versionIndex,
              account: entry.account,
            }),
      ),
    ),
  };
}

function family(lineage = snapshot()) {
  return getShieldedFundingFamilyOptions({
    snapshot: lineage,
    heirPersonHash: hash(CHILD),
    asOf: AS_OF,
  });
}

describe("shielded funding family selection", () => {
  it("lists only the unlocked parent's versions without requiring a selected or endorsed child", () => {
    const lineage = snapshot({
      records: [
        version(FATHER, 1, GRANDFATHER),
        version(MOTHER, 5),
        version(FATHER, 3, GRANDFATHER),
        version(GRANDFATHER, 4),
        version(FATHER, 2, GRANDFATHER),
        version(OTHER_FATHER, 6),
      ],
      endorsements: [],
      trusted: [],
    });
    expect(
      listShieldedFundingParentVersions({
        snapshot: lineage,
        parentIdentityCommitment: FATHER.toString(),
      }),
    ).toEqual([3, 2, 1]);
    expect(
      listShieldedFundingParentVersions({
        snapshot: lineage,
        parentIdentityCommitment: MOTHER,
      }),
    ).toEqual([5]);
    expect(
      listShieldedFundingParentVersions({
        snapshot: lineage,
        parentIdentityCommitment: 999n,
      }),
    ).toEqual([]);
  });

  it("uses each selected parent's exact trusted version to qualify different children", () => {
    const sibling = 800n;
    const childRecord = version(CHILD, 1, FATHER, MOTHER);
    const siblingRecord = version(sibling, 1, FATHER, MOTHER);
    const lineage = snapshot({
      records: [
        version(FATHER, 1),
        version(FATHER, 2),
        version(MOTHER, 1),
        version(MOTHER, 2),
        childRecord,
        siblingRecord,
      ],
      endorsements: [
        { version: childRecord, account: A, timestamp: 100n },
        { version: siblingRecord, account: B, timestamp: 100n },
      ],
      trusted: [
        { identity: FATHER, versionIndex: 1, account: A },
        { identity: FATHER, versionIndex: 2, account: B },
        { identity: MOTHER, versionIndex: 1, account: B },
        { identity: MOTHER, versionIndex: 2, account: A },
      ],
    });
    const eligibleChildren = (parentIdentityCommitment: bigint, rootVersionIndex: number) =>
      listShieldedFundingChildren({
        snapshot: lineage,
        asOf: AS_OF,
        parentIdentityCommitment,
        rootVersionIndex,
      })
        .filter((child) => child.eligible)
        .map((child) => child.personHash);

    expect(eligibleChildren(FATHER, 1)).toEqual([hash(CHILD)]);
    expect(eligibleChildren(FATHER, 2)).toEqual([hash(sibling)]);
    expect(eligibleChildren(MOTHER, 1)).toEqual([hash(sibling)]);
    expect(eligibleChildren(MOTHER, 2)).toEqual([hash(CHILD)]);
    expect(eligibleChildren(FATHER, 3)).toEqual([]);
  });

  it("uses the child's live endorsed parents and validates their actual trusted leaves", () => {
    const { parents } = family();
    expect(parents).toEqual([
      {
        personHash: hash(FATHER),
        identityCommitment: FATHER,
        relation: "father",
        latestVersionIndex: 2,
        versions: [
          { versionIndex: 2, eligible: true },
          { versionIndex: 1, eligible: true },
        ],
      },
      {
        personHash: hash(MOTHER),
        identityCommitment: MOTHER,
        relation: "mother",
        latestVersionIndex: 2,
        versions: [
          { versionIndex: 2, eligible: true },
          { versionIndex: 1, eligible: true },
        ],
      },
    ]);
  });

  it("offers a historical-only qualification but does not silently choose its older record", () => {
    const lineage = snapshot({ trusted: [{ identity: FATHER, versionIndex: 1, account: A }] });
    const { parents } = family(lineage);
    expect(parents.find((parent) => parent.identityCommitment === FATHER)?.versions).toEqual([
      { versionIndex: 2, eligible: false },
      { versionIndex: 1, eligible: true },
    ]);
    expect(
      listShieldedFundingChildren({
        snapshot: lineage,
        asOf: AS_OF,
        parentIdentityCommitment: FATHER,
        rootVersionIndex: 2,
      }),
    ).toEqual([{ personHash: hash(CHILD), eligible: false }]);
    expect(
      listShieldedFundingChildren({
        snapshot: lineage,
        asOf: AS_OF,
        parentIdentityCommitment: FATHER,
        rootVersionIndex: 1,
      }),
    ).toEqual([{ personHash: hash(CHILD), eligible: true }]);
  });

  it("limits a parent's children to their own directly confirmed relationships", () => {
    const otherChild = 600n;
    const grandchild = 700n;
    const fatherRecord = version(FATHER, 1, GRANDFATHER);
    const childRecord = version(CHILD, 1, FATHER, MOTHER);
    const otherChildRecord = version(otherChild, 1, OTHER_FATHER);
    const grandchildRecord = version(grandchild, 1, CHILD);
    const lineage = snapshot({
      records: [
        fatherRecord,
        version(GRANDFATHER, 1),
        version(MOTHER, 1),
        childRecord,
        version(OTHER_FATHER, 1),
        otherChildRecord,
        grandchildRecord,
      ],
      endorsements: [
        { version: fatherRecord, account: A, timestamp: 100n },
        { version: childRecord, account: A, timestamp: 100n },
        { version: otherChildRecord, account: A, timestamp: 100n },
        { version: grandchildRecord, account: A, timestamp: 100n },
      ],
      trusted: [
        { identity: GRANDFATHER, versionIndex: 1, account: A },
        { identity: FATHER, versionIndex: 1, account: A },
        { identity: OTHER_FATHER, versionIndex: 1, account: A },
        { identity: CHILD, versionIndex: 1, account: A },
      ],
    });
    expect(
      listShieldedFundingChildren({
        snapshot: lineage,
        asOf: AS_OF,
        parentIdentityCommitment: FATHER.toString(),
        rootVersionIndex: 1,
      }),
    ).toEqual([{ personHash: hash(CHILD), eligible: true }]);
  });

  it("does not borrow the other parent's qualification for the selected parent's children", () => {
    const lineage = snapshot({
      trusted: [{ identity: MOTHER, versionIndex: 2, account: A }],
    });
    expect(
      listShieldedFundingChildren({
        snapshot: lineage,
        asOf: AS_OF,
        parentIdentityCommitment: FATHER,
        rootVersionIndex: 2,
      }),
    ).toEqual([{ personHash: hash(CHILD), eligible: false }]);
    expect(
      listShieldedFundingChildren({
        snapshot: lineage,
        asOf: AS_OF,
        parentIdentityCommitment: MOTHER,
        rootVersionIndex: 2,
      }),
    ).toEqual([{ personHash: hash(CHILD), eligible: true }]);
  });

  it("does not reuse a parent's relationship from a replaced child endorsement", () => {
    const oldChild = version(CHILD, 1, FATHER, MOTHER);
    const currentChild = version(CHILD, 2, OTHER_FATHER);
    const lineage = snapshot({
      records: [
        version(FATHER, 1),
        version(MOTHER, 1),
        version(OTHER_FATHER, 1),
        oldChild,
        currentChild,
      ],
      endorsements: [
        { version: oldChild, account: A, timestamp: 100n, live: false },
        { version: currentChild, account: A, timestamp: 200n },
      ],
      trusted: [
        { identity: FATHER, versionIndex: 1, account: A },
        { identity: OTHER_FATHER, versionIndex: 1, account: A },
      ],
    });
    expect(family(lineage).parents.map((parent) => parent.identityCommitment)).toEqual([
      OTHER_FATHER,
    ]);
    expect(
      listShieldedFundingChildren({
        snapshot: lineage,
        asOf: AS_OF,
        parentIdentityCommitment: FATHER,
        rootVersionIndex: 1,
      }),
    ).toEqual([]);
    expect(
      listShieldedFundingChildren({
        snapshot: lineage,
        asOf: AS_OF,
        parentIdentityCommitment: OTHER_FATHER,
        rootVersionIndex: 1,
      }),
    ).toEqual([{ personHash: hash(CHILD), eligible: true }]);
  });

  it("ignores cancelled or future endorsements even when their metadata remains", () => {
    expect(
      family(
        snapshot({
          endorsements: [
            {
              version: version(CHILD, 1, FATHER, MOTHER),
              account: A,
              timestamp: 100n,
              live: false,
            },
          ],
        }),
      ).parents,
    ).toEqual([]);
    expect(
      family(
        snapshot({
          endorsements: [
            { version: version(CHILD, 1, FATHER, MOTHER), account: A, timestamp: AS_OF + 1n },
          ],
        }),
      ).parents,
    ).toEqual([]);
  });

  it("does not allow a cancelled trusted source or a different source to establish eligibility", () => {
    const lineage = snapshot({
      trusted: [
        { identity: FATHER, versionIndex: 2, account: A, live: false },
        { identity: MOTHER, versionIndex: 2, account: B },
      ],
    });
    expect(
      family(lineage).parents.every((parent) =>
        parent.versions.every((record) => !record.eligible),
      ),
    ).toBe(true);
    expect(
      listShieldedFundingChildren({
        snapshot: lineage,
        asOf: AS_OF,
        parentIdentityCommitment: FATHER,
        rootVersionIndex: 2,
      }),
    ).toEqual([{ personHash: hash(CHILD), eligible: false }]);
  });

  it("does not invent a family root when parent records are absent", () => {
    expect(family(snapshot({ records: [version(CHILD, 1, FATHER, MOTHER)] })).parents).toEqual([]);
  });

  it("finds the greatest parent version independently of the record ordering", () => {
    const { parents } = family(
      snapshot({
        records: [version(FATHER, 2), version(FATHER, 1), version(CHILD, 1, FATHER)],
        endorsements: [{ version: version(CHILD, 1, FATHER), account: A, timestamp: 100n }],
      }),
    );
    expect(parents[0].latestVersionIndex).toBe(2);
    expect(parents[0].versions.map((record) => record.versionIndex)).toEqual([2, 1]);
  });
});

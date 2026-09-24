import fs from "node:fs";
import {
  DOMAIN_INHERITANCE_CLAIM_TAG,
  DOMAIN_INHERITANCE_CREDENTIAL,
  DOMAIN_LINEAGE_ENDORSEMENT_LEAF,
  DOMAIN_LINEAGE_PARENTS,
  DOMAIN_LINEAGE_TRUSTED_LEAF,
  INHERITANCE_PERIOD_SECONDS,
  LINEAGE_TREE_MAX_DEPTH,
  computeIdentityFromDerivedSecret,
  computeInheritanceClaimTag,
  computeInheritanceCredential,
  computeInheritanceEligibleFrom,
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  packLineageEndorserAndTime,
  replayLineageTree,
} from "../index.js";

export const INHERITANCE_VECTOR_URL = new URL(
  "../../../protocol-vectors/family-inheritance-v1.json",
  import.meta.url,
);

const person = (fullName, birthYear, gender, derivedSecretField) => {
  const material = computeIdentityFromDerivedSecret({
    identity: { fullName, gender, birthYear, birthMonth: 5, birthDay: 17, isBirthBC: false },
    identitySuiteId: 1,
    derivedSecretField,
  });
  return {
    fullName,
    derivedSecretField: material.derivedSecretField.toString(),
    identityCommitment: material.identityCommitment.toString(),
    personHash: material.personHash,
  };
};

export function buildInheritanceVector() {
  const root = person("Root Ancestor", 1930, 1, 111_111n);
  const spouse = person("Root Spouse", 1932, 2, 222_222n);
  const heir = person("First Heir", 1960, 2, 333_333n);
  const rootVersionIndex = 1n;
  const heirVersionIndex = 2n;
  const endorser = "0x1111111111111111111111111111111111111111";
  const writtenAt = 1_760_000_000n;
  const startTime = 1_750_000_000n;

  const parentsDigest = computeLineageParentsDigest({
    fatherIdentityCommitment: root.identityCommitment,
    motherIdentityCommitment: spouse.identityCommitment,
  });
  const endorsementLeaf = computeLineageEndorsementLeaf({
    identityCommitment: heir.identityCommitment,
    parentsDigest,
    versionIndex: heirVersionIndex,
    endorser,
    writtenAt,
  });
  const trustedLeaf = computeLineageTrustedLeaf({
    rootIdentityCommitment: root.identityCommitment,
    rootVersionIndex,
    account: endorser,
  });
  const credential = computeInheritanceCredential({
    rootIdentityCommitment: root.identityCommitment,
    rootVersionIndex,
    rootDerivedSecretField: root.derivedSecretField,
  });
  const claimTag = computeInheritanceClaimTag({
    derivedSecretField: heir.derivedSecretField,
    inheritanceCredential: credential,
  });

  // Appends, an in-place update, a clear to zero, and a later append exercise every write path.
  const writes = [
    { leafIndex: 0n, leaf: 101n },
    { leafIndex: 1n, leaf: endorsementLeaf },
    { leafIndex: 2n, leaf: 303n },
    { leafIndex: 0n, leaf: 0n },
    { leafIndex: 3n, leaf: 404n },
    { leafIndex: 4n, leaf: 505n },
    { leafIndex: 2n, leaf: 606n },
  ];
  const tree = replayLineageTree(writes);

  return {
    schemaVersion: 1,
    domains: {
      credential: DOMAIN_INHERITANCE_CREDENTIAL.toString(),
      claimTag: DOMAIN_INHERITANCE_CLAIM_TAG.toString(),
      endorsementLeaf: DOMAIN_LINEAGE_ENDORSEMENT_LEAF.toString(),
      trustedLeaf: DOMAIN_LINEAGE_TRUSTED_LEAF.toString(),
      parents: DOMAIN_LINEAGE_PARENTS.toString(),
    },
    periodSeconds: INHERITANCE_PERIOD_SECONDS.toString(),
    treeMaxDepth: LINEAGE_TREE_MAX_DEPTH,
    root: { ...root, versionIndex: rootVersionIndex.toString() },
    spouse,
    heir: { ...heir, versionIndex: heirVersionIndex.toString() },
    endorsement: {
      endorser,
      writtenAt: writtenAt.toString(),
      endorserAndTime: packLineageEndorserAndTime({ endorser, writtenAt }).toString(),
      parentsDigest: parentsDigest.toString(),
      leaf: endorsementLeaf.toString(),
    },
    trusted: { account: endorser, leaf: trustedLeaf.toString() },
    credential: credential.toString(),
    claimTag: claimTag.toString(),
    eligibility: {
      startTime: startTime.toString(),
      writtenAt: writtenAt.toString(),
      eligibleFrom: computeInheritanceEligibleFrom({ startTime, writtenAt }).toString(),
    },
    tree: {
      writes: writes.map(({ leafIndex, leaf }) => ({
        leafIndex: leafIndex.toString(),
        leaf: leaf.toString(),
      })),
      size: tree.size,
      depth: tree.depth,
      root: tree.root.toString(),
    },
  };
}

export const serializeInheritanceVector = (vector) => `${JSON.stringify(vector, null, 2)}\n`;

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  fs.writeFileSync(INHERITANCE_VECTOR_URL, serializeInheritanceVector(buildInheritanceVector()));
}

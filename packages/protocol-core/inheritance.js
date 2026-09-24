import { LeanIMT } from "@zk-kit/lean-imt";
import { keccak256, toBeHex, zeroPadValue } from "ethers";
import { poseidon2, poseidon3, poseidon4, poseidon5 } from "poseidon-lite";
import { bigintFrom } from "./bytes.js";
import {
  DOMAIN_INHERITANCE_CLAIM_TAG,
  DOMAIN_INHERITANCE_CREDENTIAL,
  DOMAIN_LINEAGE_ENDORSEMENT_LEAF,
  DOMAIN_LINEAGE_PARENTS,
  DOMAIN_LINEAGE_TRUSTED_LEAF,
  INHERITANCE_PERIOD_SECONDS,
  LINEAGE_TREE_MAX_DEPTH,
  MAX_UINT64,
  MAX_UINT256,
  SNARK_SCALAR_FIELD,
} from "./constants.js";
import { protocolAssert } from "./errors.js";
import { assertAddress, computeIdentityFromDerivedSecret } from "./identity.js";

const FIELD_MAX = SNARK_SCALAR_FIELD - 1n;

const field = (value, label) => bigintFrom(value, label, FIELD_MAX);

export function wrapIdentityCommitmentAsPersonHash(identityCommitment) {
  const commitment = field(identityCommitment, "identityCommitment");
  protocolAssert(commitment !== 0n, "ZERO_IDENTITY_COMMITMENT", "identityCommitment is zero");
  return keccak256(zeroPadValue(toBeHex(commitment), 32));
}

export function computeLineageParentsDigest(input) {
  return poseidon3([
    DOMAIN_LINEAGE_PARENTS,
    field(input.fatherIdentityCommitment, "fatherIdentityCommitment"),
    field(input.motherIdentityCommitment, "motherIdentityCommitment"),
  ]);
}

/** Packs the endorser into bits 0..159 and the write time into bits 160..223. */
export function packLineageEndorserAndTime(input) {
  const endorser = BigInt(assertAddress(input.endorser, "endorser"));
  const writtenAt = bigintFrom(input.writtenAt, "writtenAt", MAX_UINT64);
  return (writtenAt << 160n) | endorser;
}

export function computeLineageEndorsementLeaf(input) {
  return poseidon5([
    DOMAIN_LINEAGE_ENDORSEMENT_LEAF,
    field(input.identityCommitment, "identityCommitment"),
    field(input.parentsDigest, "parentsDigest"),
    field(input.versionIndex, "versionIndex"),
    packLineageEndorserAndTime(input),
  ]);
}

export function computeLineageTrustedLeaf(input) {
  return poseidon4([
    DOMAIN_LINEAGE_TRUSTED_LEAF,
    field(input.rootIdentityCommitment, "rootIdentityCommitment"),
    field(input.rootVersionIndex, "rootVersionIndex"),
    BigInt(assertAddress(input.account, "account")),
  ]);
}

/**
 * The deposit-time credential. It commits to the root node and one of the root's secrets, so it
 * cannot be linked to a public person hash without that person's passphrase.
 */
export function computeInheritanceCredential(input) {
  const rootIdentityCommitment = field(input.rootIdentityCommitment, "rootIdentityCommitment");
  protocolAssert(
    rootIdentityCommitment !== 0n,
    "ZERO_IDENTITY_COMMITMENT",
    "rootIdentityCommitment is zero",
  );
  return poseidon4([
    DOMAIN_INHERITANCE_CREDENTIAL,
    rootIdentityCommitment,
    field(input.rootVersionIndex, "rootVersionIndex"),
    field(input.rootDerivedSecretField, "rootDerivedSecretField"),
  ]);
}

/** A per-heir pseudonym under one credential; claims accumulate against it. */
export function computeInheritanceClaimTag(input) {
  return poseidon3([
    DOMAIN_INHERITANCE_CLAIM_TAG,
    field(input.derivedSecretField, "derivedSecretField"),
    field(input.inheritanceCredential, "inheritanceCredential"),
  ]);
}

export const hashLineageNodes = (left, right) => poseidon2([left, right]);

export function createLineageTree(leaves = []) {
  return new LeanIMT(
    hashLineageNodes,
    leaves.map((leaf, index) => field(leaf, `leaf ${index}`)),
  );
}

/**
 * Rebuilds a lineage tree from `LeafWritten` events ordered by chain position. A write at the
 * current size appends; any lower index updates in place, exactly as the index contract does.
 */
export function replayLineageTree(writes) {
  const tree = createLineageTree();
  for (const [position, write] of writes.entries()) {
    const leafIndex = Number(
      bigintFrom(write.leafIndex, `write ${position} leafIndex`, MAX_UINT256),
    );
    const leaf = field(write.leaf, `write ${position} leaf`);
    if (leafIndex === tree.size) {
      tree.insert(leaf);
    } else {
      protocolAssert(
        leafIndex < tree.size,
        "LINEAGE_WRITE_OUT_OF_ORDER",
        `Lineage write ${position} skips to index ${leafIndex}; tree size is ${tree.size}`,
      );
      tree.update(leafIndex, leaf);
    }
  }
  return tree;
}

/** Circuit-ready LeanIMT proof: `depth` is the sibling count, siblings are zero-padded. */
export function buildLineageMerkleProof(tree, leafIndex) {
  const proof = tree.generateProof(leafIndex);
  protocolAssert(
    proof.siblings.length <= LINEAGE_TREE_MAX_DEPTH,
    "LINEAGE_TREE_TOO_DEEP",
    `Lineage proof depth ${proof.siblings.length} exceeds ${LINEAGE_TREE_MAX_DEPTH}`,
  );
  const siblings = proof.siblings.map((sibling) => BigInt(sibling));
  while (siblings.length < LINEAGE_TREE_MAX_DEPTH) siblings.push(0n);
  return {
    root: BigInt(proof.root),
    leaf: BigInt(proof.leaf),
    depth: proof.siblings.length,
    index: BigInt(proof.index),
    siblings,
  };
}

const uint = (value, label) => bigintFrom(value, label, MAX_UINT64);

/** Earliest period start on the inheritance grid that is at least one period after `writtenAt`. */
export function computeInheritanceEligibleFrom(input) {
  const startTime = uint(input.startTime, "startTime");
  const writtenAt = uint(input.writtenAt, "writtenAt");
  const earliest = writtenAt + INHERITANCE_PERIOD_SECONDS;
  if (earliest <= startTime) return startTime;
  const periods =
    (earliest - startTime + INHERITANCE_PERIOD_SECONDS - 1n) / INHERITANCE_PERIOD_SECONDS;
  return startTime + periods * INHERITANCE_PERIOD_SECONDS;
}

/** Total amount accrued from `eligibleFrom` through the period containing `now`. */
export function computeInheritanceEntitlement(input) {
  const amountPerPeriod = bigintFrom(input.amountPerPeriod, "amountPerPeriod", MAX_UINT256);
  const eligibleFrom = uint(input.eligibleFrom, "eligibleFrom");
  const now = uint(input.now, "now");
  if (now < eligibleFrom) return 0n;
  return amountPerPeriod * ((now - eligibleFrom) / INHERITANCE_PERIOD_SECONDS + 1n);
}

const sameField = (left, right) => BigInt(left) === BigInt(right);

/**
 * Assembles the FamilyInheritanceClaim v1 witness. Every value is re-derived and cross-checked
 * against the replayed trees, so a mismatch surfaces here instead of as an opaque proving failure.
 */
export function buildInheritanceClaimWitness(input) {
  const heir = computeIdentityFromDerivedSecret({
    identity: input.heir.identity,
    identitySuiteId: input.heir.identitySuiteId,
    derivedSecretField: input.heir.derivedSecretField,
  });
  const fatherIdentityCommitment = field(
    input.fatherIdentityCommitment,
    "fatherIdentityCommitment",
  );
  const motherIdentityCommitment = field(
    input.motherIdentityCommitment,
    "motherIdentityCommitment",
  );
  protocolAssert(
    typeof input.rootIsMother === "boolean",
    "INVALID_BOOLEAN",
    "rootIsMother must be boolean",
  );
  const rootIdentityCommitment = input.rootIsMother
    ? motherIdentityCommitment
    : fatherIdentityCommitment;
  protocolAssert(
    sameField(rootIdentityCommitment, input.root.identityCommitment),
    "INHERITANCE_ROOT_NOT_PARENT",
    "The selected parent is not the inheritance root",
  );

  const versionIndex = field(input.versionIndex, "versionIndex");
  const rootVersionIndex = field(input.root.versionIndex, "root.versionIndex");
  const writtenAt = bigintFrom(input.writtenAt, "writtenAt", MAX_UINT64);
  const eligibleFrom = bigintFrom(input.eligibleFrom, "eligibleFrom", MAX_UINT64);
  protocolAssert(
    writtenAt + INHERITANCE_PERIOD_SECONDS <= eligibleFrom,
    "INHERITANCE_NOT_YET_ELIGIBLE",
    "The endorsement must be at least one period older than eligibleFrom",
  );
  const endorser = assertAddress(input.endorser, "endorser");
  const recipient = assertAddress(input.recipient, "recipient");

  const parentsDigest = computeLineageParentsDigest({
    fatherIdentityCommitment,
    motherIdentityCommitment,
  });
  const endorsementLeaf = computeLineageEndorsementLeaf({
    identityCommitment: heir.identityCommitment,
    parentsDigest,
    versionIndex,
    endorser,
    writtenAt,
  });
  const trustedLeaf = computeLineageTrustedLeaf({
    rootIdentityCommitment,
    rootVersionIndex,
    account: endorser,
  });
  const endorsementProof = buildLineageMerkleProof(
    input.endorsementTree,
    input.endorsementLeafIndex,
  );
  const trustedProof = buildLineageMerkleProof(input.trustedTree, input.trustedLeafIndex);
  protocolAssert(
    endorsementProof.leaf === endorsementLeaf,
    "LINEAGE_LEAF_MISMATCH",
    "The endorsement leaf does not match the heir's version and endorser",
  );
  protocolAssert(
    trustedProof.leaf === trustedLeaf,
    "LINEAGE_LEAF_MISMATCH",
    "The trusted-endorser leaf does not match the root version and endorser",
  );

  const inheritanceCredential = computeInheritanceCredential({
    rootIdentityCommitment,
    rootVersionIndex,
    rootDerivedSecretField: input.root.derivedSecretField,
  });
  const claimTag = computeInheritanceClaimTag({
    derivedSecretField: heir.derivedSecretField,
    inheritanceCredential,
  });

  const publicSignals = {
    endorsementRoot: endorsementProof.root,
    trustedRoot: trustedProof.root,
    inheritanceCredential,
    claimTag,
    eligibleFrom,
    recipient: BigInt(recipient),
  };
  const decimal = (value) => BigInt(value).toString();
  const witness = {
    ...Object.fromEntries(
      Object.entries(publicSignals).map(([key, value]) => [key, decimal(value)]),
    ),
    nameField: decimal(heir.nameField),
    derivedSecretField: decimal(heir.derivedSecretField),
    isBirthBC: heir.identity.isBirthBC ? "1" : "0",
    birthYear: decimal(heir.identity.birthYear),
    birthMonth: decimal(heir.identity.birthMonth),
    birthDay: decimal(heir.identity.birthDay),
    gender: decimal(heir.identity.gender),
    suiteId: decimal(heir.identitySuiteId),
    versionIndex: decimal(versionIndex),
    fatherIdentityCommitment: decimal(fatherIdentityCommitment),
    motherIdentityCommitment: decimal(motherIdentityCommitment),
    rootIsMother: input.rootIsMother ? "1" : "0",
    endorser: decimal(BigInt(endorser)),
    writtenAt: decimal(writtenAt),
    endorsementDepth: decimal(endorsementProof.depth),
    endorsementIndex: decimal(endorsementProof.index),
    endorsementSiblings: endorsementProof.siblings.map(decimal),
    rootVersionIndex: decimal(rootVersionIndex),
    rootDerivedSecretField: decimal(
      field(input.root.derivedSecretField, "root.derivedSecretField"),
    ),
    trustedDepth: decimal(trustedProof.depth),
    trustedIndex: decimal(trustedProof.index),
    trustedSiblings: trustedProof.siblings.map(decimal),
  };
  return { witness, publicSignals };
}

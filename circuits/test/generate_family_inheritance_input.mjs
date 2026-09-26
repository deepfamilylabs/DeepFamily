// Builds the FamilyInheritanceClaim v1 fixture from the protocol inheritance vector.
// Run directly to rewrite circuits/test/proof/family_inheritance_claim_input.json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildInheritanceClaimWitness,
  computeInheritanceEligibleFrom,
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  createLineageTree,
} from "@deepfamily/protocol-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FAMILY_INHERITANCE_INPUT_PATH = path.join(
  __dirname,
  "proof",
  "family_inheritance_claim_input.json",
);
const vector = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../../protocol-vectors/family-inheritance-v1.json"),
    "utf8",
  ),
);

export const FIXTURE_RECIPIENT = "0x2222222222222222222222222222222222222222";
const OTHER_ENDORSER = "0x3333333333333333333333333333333333333333";

export function buildFamilyInheritanceFixture() {
  const heirIdentity = {
    fullName: vector.heir.fullName,
    gender: 2,
    birthYear: 1960,
    birthMonth: 5,
    birthDay: 17,
    isBirthBC: false,
  };
  const endorsement = vector.endorsement;
  const parentsDigest = computeLineageParentsDigest({
    fatherIdentityCommitment: vector.root.identityCommitment,
    motherIdentityCommitment: vector.spouse.identityCommitment,
  });
  const heirLeaf = computeLineageEndorsementLeaf({
    identityCommitment: vector.heir.identityCommitment,
    parentsDigest,
    versionIndex: vector.heir.versionIndex,
    endorser: endorsement.endorser,
    writtenAt: endorsement.writtenAt,
  });
  // Unrelated leaves on both sides of the heir give the proof real siblings at several levels.
  const endorsementTree = createLineageTree([101n, heirLeaf, 303n, 0n, 505n]);
  const trustedTree = createLineageTree([
    computeLineageTrustedLeaf({
      rootIdentityCommitment: vector.spouse.identityCommitment,
      rootVersionIndex: 1,
      account: OTHER_ENDORSER,
    }),
    computeLineageTrustedLeaf({
      rootIdentityCommitment: vector.root.identityCommitment,
      rootVersionIndex: vector.root.versionIndex,
      account: endorsement.endorser,
    }),
    707n,
  ]);
  const claimInput = {
    heir: {
      identity: heirIdentity,
      identitySuiteId: 1,
      derivedSecretField: vector.heir.derivedSecretField,
    },
    versionIndex: vector.heir.versionIndex,
    fatherIdentityCommitment: vector.root.identityCommitment,
    motherIdentityCommitment: vector.spouse.identityCommitment,
    rootIsMother: false,
    endorser: endorsement.endorser,
    writtenAt: endorsement.writtenAt,
    root: {
      identityCommitment: vector.root.identityCommitment,
      versionIndex: vector.root.versionIndex,
      derivedSecretField: vector.root.derivedSecretField,
    },
    eligibleFrom: computeInheritanceEligibleFrom({
      startTime: vector.eligibility.startTime,
      writtenAt: endorsement.writtenAt,
    }),
    recipient: FIXTURE_RECIPIENT,
  };
  const fromTrees = buildInheritanceClaimWitness({
    ...claimInput,
    endorsementTree,
    endorsementLeafIndex: 1,
    trustedTree,
    trustedLeafIndex: 1,
  });
  const fromCompactPaths = buildInheritanceClaimWitness({
    ...claimInput,
    endorsementProof: endorsementTree.generateProof(1),
    trustedProof: trustedTree.generateProof(1),
  });
  if (JSON.stringify(fromTrees.witness) !== JSON.stringify(fromCompactPaths.witness)) {
    throw new Error("Tree and compact lineage proofs produced different claim witnesses");
  }
  return fromTrees;
}

export const serializeFamilyInheritanceInput = (witness) => `${JSON.stringify(witness, null, 2)}\n`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(
    FAMILY_INHERITANCE_INPUT_PATH,
    serializeFamilyInheritanceInput(buildFamilyInheritanceFixture().witness),
  );
}

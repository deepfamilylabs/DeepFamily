// Shared lineage fixture for shielded circuit tests. It uses live lineage
// commitments and LeanIMT paths without depending on the retired claim circuit.
import {
  buildLineageMerkleProof,
  computeIdentityFromDerivedSecret,
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  createLineageTree,
} from "@deepfamily/protocol-core";

const decimal = (value) => BigInt(value).toString();
const ROOT_IDENTITY_COMMITMENT =
  999906731348348690931474673125571534736129953375838743684789035308171738139n;
const SPOUSE_IDENTITY_COMMITMENT =
  10530360062434969898767262691406169581721187934956950118992600072222112014653n;
const ROOT_VERSION_INDEX = 1n;
const HEIR_VERSION_INDEX = 2n;
const ENDORSER = "0x1111111111111111111111111111111111111111";
const WRITTEN_AT = 1760000000n;

export function buildLineageFixture() {
  const heirIdentity = {
    fullName: "First Heir",
    gender: 2,
    birthYear: 1960,
    birthMonth: 5,
    birthDay: 17,
    isBirthBC: false,
  };
  const heir = computeIdentityFromDerivedSecret({
    identity: heirIdentity,
    identitySuiteId: 1,
    derivedSecretField: 333333n,
  });
  const parentsDigest = computeLineageParentsDigest({
    fatherIdentityCommitment: ROOT_IDENTITY_COMMITMENT,
    motherIdentityCommitment: SPOUSE_IDENTITY_COMMITMENT,
  });
  const endorsementLeaf = computeLineageEndorsementLeaf({
    identityCommitment: heir.identityCommitment,
    parentsDigest,
    versionIndex: HEIR_VERSION_INDEX,
    endorser: ENDORSER,
    writtenAt: WRITTEN_AT,
  });
  const endorsementTree = createLineageTree([101n, endorsementLeaf, 303n, 0n, 505n]);
  const trustedTree = createLineageTree([
    computeLineageTrustedLeaf({
      rootIdentityCommitment: SPOUSE_IDENTITY_COMMITMENT,
      rootVersionIndex: 1,
      account: "0x3333333333333333333333333333333333333333",
    }),
    computeLineageTrustedLeaf({
      rootIdentityCommitment: ROOT_IDENTITY_COMMITMENT,
      rootVersionIndex: ROOT_VERSION_INDEX,
      account: ENDORSER,
    }),
    707n,
  ]);
  const endorsementProof = buildLineageMerkleProof(endorsementTree, 1);
  const trustedProof = buildLineageMerkleProof(trustedTree, 1);
  return {
    witness: {
      endorsementRoot: decimal(endorsementProof.root),
      trustedRoot: decimal(trustedProof.root),
      nameField: decimal(heir.nameField),
      derivedSecretField: decimal(heir.derivedSecretField),
      isBirthBC: "0",
      birthYear: decimal(heirIdentity.birthYear),
      birthMonth: decimal(heirIdentity.birthMonth),
      birthDay: decimal(heirIdentity.birthDay),
      gender: decimal(heirIdentity.gender),
      suiteId: "1",
      versionIndex: decimal(HEIR_VERSION_INDEX),
      fatherIdentityCommitment: decimal(ROOT_IDENTITY_COMMITMENT),
      motherIdentityCommitment: decimal(SPOUSE_IDENTITY_COMMITMENT),
      rootIsMother: "0",
      endorser: decimal(BigInt(ENDORSER)),
      writtenAt: decimal(WRITTEN_AT),
      endorsementDepth: decimal(endorsementProof.depth),
      endorsementIndex: decimal(endorsementProof.index),
      endorsementSiblings: endorsementProof.siblings.map(decimal),
      rootVersionIndex: decimal(ROOT_VERSION_INDEX),
      trustedDepth: decimal(trustedProof.depth),
      trustedIndex: decimal(trustedProof.index),
      trustedSiblings: trustedProof.siblings.map(decimal),
      eligibleFrom: "1762960000",
    },
  };
}

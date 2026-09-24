pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "@zk-kit/binary-merkle-root.circom/src/binary-merkle-root.circom";
include "lib/identity.circom";

// FamilyInheritanceClaim v1 public signals (order is protocol ABI):
// 1. endorsementRoot        lineage index endorsement-tree root
// 2. trustedRoot            lineage index trusted-endorser-tree root
// 3. inheritanceCredential  Poseidon(1005, icRoot, rootVersionIndex, rootDerivedSecret)
// 4. claimTag               Poseidon(1006, childDerivedSecret, inheritanceCredential)
// 5. eligibleFrom           first period start the heir claims from
// 6. recipient              payout address, bound so a copied proof cannot redirect funds
//
// The claim shows, without naming the heir: the heir knows their own identity secret; an endorsement
// leaf for one of the heir's versions lists the root as father or mother; the same endorser is a
// trusted endorser of the root version the credential commits to; and that endorsement was written
// at least one period before eligibleFrom.

template FamilyInheritanceClaim(MAX_DEPTH) {
    signal input endorsementRoot;
    signal input trustedRoot;
    signal input inheritanceCredential;
    signal input claimTag;
    signal input eligibleFrom;
    signal input recipient;

    // Heir identity witness.
    signal input nameField;
    signal input derivedSecretField;
    signal input isBirthBC;
    signal input birthYear;
    signal input birthMonth;
    signal input birthDay;
    signal input gender;
    signal input suiteId;

    // Endorsement leaf of the heir's version.
    signal input versionIndex;
    signal input fatherIdentityCommitment;
    signal input motherIdentityCommitment;
    signal input rootIsMother;
    signal input endorser;
    signal input writtenAt;
    signal input endorsementDepth;
    signal input endorsementIndex;
    signal input endorsementSiblings[MAX_DEPTH];

    // Root version and the secret the credential was opened with.
    signal input rootVersionIndex;
    signal input rootDerivedSecretField;
    signal input trustedDepth;
    signal input trustedIndex;
    signal input trustedSiblings[MAX_DEPTH];

    var PERIOD_SECONDS = 2592000;

    component suite = AtomicSuiteCommitment();
    suite.suiteId <== suiteId;

    component heir = IdentityCommitmentCore();
    heir.nameField <== nameField;
    heir.derivedSecretField <== derivedSecretField;
    heir.isBirthBC <== isBirthBC;
    heir.birthYear <== birthYear;
    heir.birthMonth <== birthMonth;
    heir.birthDay <== birthDay;
    heir.gender <== gender;
    heir.suiteCommitment <== suite.suiteCommitment;

    // The root is whichever parent the selector names; it must exist.
    rootIsMother * (1 - rootIsMother) === 0;
    signal rootIdentityCommitment <==
        fatherIdentityCommitment + rootIsMother * (motherIdentityCommitment - fatherIdentityCommitment);
    component rootIsZero = IsZero();
    rootIsZero.in <== rootIdentityCommitment;
    rootIsZero.out === 0;

    component parents = Poseidon(3);
    parents.inputs[0] <== 1009;
    parents.inputs[1] <== fatherIdentityCommitment;
    parents.inputs[2] <== motherIdentityCommitment;

    // Endorser in bits 0..159 and write time in bits 160..223, as the index packs them.
    component endorserBits = Num2Bits(160);
    endorserBits.in <== endorser;
    component writtenAtBits = Num2Bits(64);
    writtenAtBits.in <== writtenAt;
    signal endorserAndTime <== writtenAt * (1 << 160) + endorser;

    component endorsementLeaf = Poseidon(5);
    endorsementLeaf.inputs[0] <== 1007;
    endorsementLeaf.inputs[1] <== heir.identityCommitment;
    endorsementLeaf.inputs[2] <== parents.out;
    endorsementLeaf.inputs[3] <== versionIndex;
    endorsementLeaf.inputs[4] <== endorserAndTime;

    component trustedLeaf = Poseidon(4);
    trustedLeaf.inputs[0] <== 1008;
    trustedLeaf.inputs[1] <== rootIdentityCommitment;
    trustedLeaf.inputs[2] <== rootVersionIndex;
    trustedLeaf.inputs[3] <== endorser;

    // BinaryMerkleRoot yields 0 for a depth above MAX_DEPTH, so bound both depths explicitly.
    component endorsementDepthBits = Num2Bits(6);
    endorsementDepthBits.in <== endorsementDepth;
    component trustedDepthBits = Num2Bits(6);
    trustedDepthBits.in <== trustedDepth;
    component endorsementDepthOk = LessEqThan(6);
    endorsementDepthOk.in[0] <== endorsementDepth;
    endorsementDepthOk.in[1] <== MAX_DEPTH;
    endorsementDepthOk.out === 1;
    component trustedDepthOk = LessEqThan(6);
    trustedDepthOk.in[0] <== trustedDepth;
    trustedDepthOk.in[1] <== MAX_DEPTH;
    trustedDepthOk.out === 1;

    component endorsementMerkle = BinaryMerkleRoot(MAX_DEPTH);
    endorsementMerkle.leaf <== endorsementLeaf.out;
    endorsementMerkle.depth <== endorsementDepth;
    endorsementMerkle.index <== endorsementIndex;
    endorsementMerkle.siblings <== endorsementSiblings;
    endorsementMerkle.out === endorsementRoot;

    component trustedMerkle = BinaryMerkleRoot(MAX_DEPTH);
    trustedMerkle.leaf <== trustedLeaf.out;
    trustedMerkle.depth <== trustedDepth;
    trustedMerkle.index <== trustedIndex;
    trustedMerkle.siblings <== trustedSiblings;
    trustedMerkle.out === trustedRoot;

    component credential = Poseidon(4);
    credential.inputs[0] <== 1005;
    credential.inputs[1] <== rootIdentityCommitment;
    credential.inputs[2] <== rootVersionIndex;
    credential.inputs[3] <== rootDerivedSecretField;
    credential.out === inheritanceCredential;

    component tag = Poseidon(3);
    tag.inputs[0] <== 1006;
    tag.inputs[1] <== derivedSecretField;
    tag.inputs[2] <== inheritanceCredential;
    tag.out === claimTag;

    // writtenAt + one period <= eligibleFrom; both sides are range-checked to 65 bits.
    component eligibleFromBits = Num2Bits(64);
    eligibleFromBits.in <== eligibleFrom;
    component waited = LessEqThan(65);
    waited.in[0] <== writtenAt + PERIOD_SECONDS;
    waited.in[1] <== eligibleFrom;
    waited.out === 1;

    // Unconstrained public inputs drop out of Groth16 verification; this binds the recipient.
    signal recipientSquare <== recipient * recipient;
}

component main {
    public [endorsementRoot, trustedRoot, inheritanceCredential, claimTag, eligibleFrom, recipient]
} = FamilyInheritanceClaim(32);

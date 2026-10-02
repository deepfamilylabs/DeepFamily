pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "@zk-kit/binary-merkle-root.circom/src/binary-merkle-root.circom";

// Proves that the heir's currently endorsed version names the
// private policy root as a direct parent, and the endorser is recommended by
// that root version. Both roots are checked against current chain state by
// ShieldedDeepPool before this proof is accepted.
template ShieldedDirectChildCurrent() {
    signal input enabled;
    signal input heirIdentityCommitment;
    signal input rootIdentityCommitment;
    signal input rootVersionIndex;
    signal input heirVersionIndex;
    signal input fatherIdentityCommitment;
    signal input motherIdentityCommitment;
    signal input rootIsMother;
    signal input endorser;
    signal input writtenAt;
    signal input endorsementDepth;
    signal input endorsementIndex;
    signal input endorsementSiblings[64];
    signal input trustedDepth;
    signal input trustedIndex;
    signal input trustedSiblings[64];
    signal input endorsementRoot;
    signal input trustedRoot;
    signal input asOf;

    enabled * (1 - enabled) === 0;
    rootIsMother * (1 - rootIsMother) === 0;
    signal selectedParent <== fatherIdentityCommitment + rootIsMother *
        (motherIdentityCommitment - fatherIdentityCommitment);
    enabled * (rootIdentityCommitment - selectedParent) === 0;
    component heirNotZero = IsZero();
    heirNotZero.in <== heirIdentityCommitment;
    heirNotZero.out === 0;
    component endorserBits = Num2Bits(160);
    endorserBits.in <== endorser;
    component writtenAtBits = Num2Bits(64);
    writtenAtBits.in <== writtenAt;
    component asOfBits = Num2Bits(64);
    asOfBits.in <== asOf;
    component alreadyEndorsed = LessEqThan(64);
    alreadyEndorsed.in[0] <== writtenAt;
    alreadyEndorsed.in[1] <== asOf;
    enabled * (1 - alreadyEndorsed.out) === 0;

    component parents = Poseidon(3);
    parents.inputs[0] <== 1009;
    parents.inputs[1] <== fatherIdentityCommitment;
    parents.inputs[2] <== motherIdentityCommitment;
    signal endorserAndTime <== writtenAt * (1 << 160) + endorser;
    component endorsementLeaf = Poseidon(5);
    endorsementLeaf.inputs[0] <== 1007;
    endorsementLeaf.inputs[1] <== heirIdentityCommitment;
    endorsementLeaf.inputs[2] <== parents.out;
    endorsementLeaf.inputs[3] <== heirVersionIndex;
    endorsementLeaf.inputs[4] <== endorserAndTime;
    component trustedLeaf = Poseidon(4);
    trustedLeaf.inputs[0] <== 1008;
    trustedLeaf.inputs[1] <== rootIdentityCommitment;
    trustedLeaf.inputs[2] <== rootVersionIndex;
    trustedLeaf.inputs[3] <== endorser;

    component endorsementDepthBits = Num2Bits(7);
    endorsementDepthBits.in <== endorsementDepth;
    component endorsementDepthOk = LessEqThan(7);
    endorsementDepthOk.in[0] <== endorsementDepth;
    endorsementDepthOk.in[1] <== 64;
    endorsementDepthOk.out === 1;
    component trustedDepthBits = Num2Bits(7);
    trustedDepthBits.in <== trustedDepth;
    component trustedDepthOk = LessEqThan(7);
    trustedDepthOk.in[0] <== trustedDepth;
    trustedDepthOk.in[1] <== 64;
    trustedDepthOk.out === 1;
    component endorsementMerkle = BinaryMerkleRoot(64);
    endorsementMerkle.leaf <== endorsementLeaf.out;
    endorsementMerkle.depth <== endorsementDepth;
    endorsementMerkle.index <== endorsementIndex;
    endorsementMerkle.siblings <== endorsementSiblings;
    enabled * (endorsementMerkle.out - endorsementRoot) === 0;
    component trustedMerkle = BinaryMerkleRoot(64);
    trustedMerkle.leaf <== trustedLeaf.out;
    trustedMerkle.depth <== trustedDepth;
    trustedMerkle.index <== trustedIndex;
    trustedMerkle.siblings <== trustedSiblings;
    enabled * (trustedMerkle.out - trustedRoot) === 0;
}

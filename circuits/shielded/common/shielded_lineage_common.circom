pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "shielded_merkle_common.circom";

// Proves that the heir's currently endorsed version names the
// private policy root as a direct parent, and the endorser is recommended by
// that root version. The pool requires both roots in one checkpoint created by
// asOf, so every endorsement in that checkpoint was already written by asOf.
template ShieldedDirectChildCurrent() {
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

    rootIsMother * (1 - rootIsMother) === 0;
    signal selectedParent <== fatherIdentityCommitment + rootIsMother *
        (motherIdentityCommitment - fatherIdentityCommitment);
    rootIdentityCommitment === selectedParent;
    component heirNotZero = IsZero();
    heirNotZero.in <== heirIdentityCommitment;
    heirNotZero.out === 0;
    component endorserBits = Num2Bits(160);
    endorserBits.in <== endorser;
    component writtenAtBits = Num2Bits(64);
    writtenAtBits.in <== writtenAt;

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

    component endorsementMerkle = ShieldedMerkleRoot(64);
    endorsementMerkle.leaf <== endorsementLeaf.out;
    endorsementMerkle.depth <== endorsementDepth;
    endorsementMerkle.index <== endorsementIndex;
    endorsementMerkle.siblings <== endorsementSiblings;
    endorsementMerkle.out === endorsementRoot;
    component trustedMerkle = ShieldedMerkleRoot(64);
    trustedMerkle.leaf <== trustedLeaf.out;
    trustedMerkle.depth <== trustedDepth;
    trustedMerkle.index <== trustedIndex;
    trustedMerkle.siblings <== trustedSiblings;
    trustedMerkle.out === trustedRoot;
}

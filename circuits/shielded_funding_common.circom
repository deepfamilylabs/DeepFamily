pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "@zk-kit/binary-merkle-root.circom/src/binary-merkle-root.circom";

// Compact LeanIMT membership, matching ShieldedDeepPool's note shards. A
// missing right sibling is absent from this path, not hash(leaf,0).
template ShieldedMembership32() {
    signal input leaf;
    signal input root;
    signal input depth;
    signal input index;
    signal input siblings[32];

    component depthBits = Num2Bits(6);
    depthBits.in <== depth;
    component depthOk = LessEqThan(6);
    depthOk.in[0] <== depth;
    depthOk.in[1] <== 32;
    depthOk.out === 1;
    component merkle = BinaryMerkleRoot(32);
    merkle.leaf <== leaf;
    merkle.depth <== depth;
    merkle.index <== index;
    merkle.siblings <== siblings;
    merkle.out === root;
}

// A spendable donor VALUE note. Both source and change commitments bind the
// exact ciphertext hash supplied by the pool as a public signal.
template ShieldedDonorValueInput() {
    signal input ownerSecret;
    signal input amount;
    signal input nonce;
    signal input ciphertextHash;
    signal input shardRoot;
    signal input depth;
    signal input index;
    signal input siblings[32];
    signal output ownerCommitment;
    signal output noteCommitment;
    signal output spendNullifier;

    component ownerNotZero = IsZero();
    ownerNotZero.in <== ownerSecret;
    ownerNotZero.out === 0;
    component amountBits = Num2Bits(128);
    amountBits.in <== amount;
    component nonceNotZero = IsZero();
    nonceNotZero.in <== nonce;
    nonceNotZero.out === 0;
    component owner = Poseidon(2);
    owner.inputs[0] <== 1013;
    owner.inputs[1] <== ownerSecret;
    ownerCommitment <== owner.out;
    component note = Poseidon(5);
    note.inputs[0] <== 1014;
    note.inputs[1] <== ownerCommitment;
    note.inputs[2] <== amount;
    note.inputs[3] <== nonce;
    note.inputs[4] <== ciphertextHash;
    noteCommitment <== note.out;
    component membership = ShieldedMembership32();
    membership.leaf <== noteCommitment;
    membership.root <== shardRoot;
    membership.depth <== depth;
    membership.index <== index;
    membership.siblings <== siblings;
    component spend = Poseidon(3);
    spend.inputs[0] <== 1016;
    spend.inputs[1] <== ownerSecret;
    spend.inputs[2] <== noteCommitment;
    spendNullifier <== spend.out;
}

template ShieldedPrivatePolicy() {
    signal input rootIdentityCommitment;
    signal input rootVersionIndex;
    signal input rate;
    signal input policySalt;
    signal input allocationKeyCommitment;
    signal output commitment;

    component rootNotZero = IsZero();
    rootNotZero.in <== rootIdentityCommitment;
    rootNotZero.out === 0;
    component rateBits = Num2Bits(128);
    rateBits.in <== rate;
    component rateNotZero = IsZero();
    rateNotZero.in <== rate;
    rateNotZero.out === 0;
    component saltNotZero = IsZero();
    saltNotZero.in <== policySalt;
    saltNotZero.out === 0;
    component keyCommitmentNotZero = IsZero();
    keyCommitmentNotZero.in <== allocationKeyCommitment;
    keyCommitmentNotZero.out === 0;
    component policy = Poseidon(6);
    policy.inputs[0] <== 1010;
    policy.inputs[1] <== rootIdentityCommitment;
    policy.inputs[2] <== rootVersionIndex;
    policy.inputs[3] <== rate;
    policy.inputs[4] <== policySalt;
    policy.inputs[5] <== allocationKeyCommitment;
    commitment <== policy.out;
}

template ShieldedPrivateEnrollment() {
    signal input policyCommitment;
    signal input heirIdentityCommitment;
    signal input eligibleFrom;
    signal input enrollmentSalt;
    signal output commitment;

    component eligibleFromBits = Num2Bits(64);
    eligibleFromBits.in <== eligibleFrom;
    component saltNotZero = IsZero();
    saltNotZero.in <== enrollmentSalt;
    saltNotZero.out === 0;
    component enrollment = Poseidon(5);
    enrollment.inputs[0] <== 1011;
    enrollment.inputs[1] <== policyCommitment;
    enrollment.inputs[2] <== heirIdentityCommitment;
    enrollment.inputs[3] <== eligibleFrom;
    enrollment.inputs[4] <== enrollmentSalt;
    commitment <== enrollment.out;
}

template ShieldedBudgetOutput() {
    signal input policyCommitment;
    signal input enrollmentCommitment;
    signal input heirOwnerCommitment;
    signal input rate;
    signal input periods;
    signal input nonce;
    signal input ciphertextHash;
    signal output amount;
    signal output noteCommitment;

    component periodsBits = Num2Bits(64);
    periodsBits.in <== periods;
    component periodsNotZero = IsZero();
    periodsNotZero.in <== periods;
    periodsNotZero.out === 0;
    amount <== rate * periods;
    component amountBits = Num2Bits(128);
    amountBits.in <== amount;
    component nonceNotZero = IsZero();
    nonceNotZero.in <== nonce;
    nonceNotZero.out === 0;
    component note = Poseidon(8);
    note.inputs[0] <== 1015;
    note.inputs[1] <== policyCommitment;
    note.inputs[2] <== enrollmentCommitment;
    note.inputs[3] <== heirOwnerCommitment;
    note.inputs[4] <== rate;
    note.inputs[5] <== amount;
    note.inputs[6] <== nonce;
    note.inputs[7] <== ciphertextHash;
    noteCommitment <== note.out;
}

template ShieldedDonorChange() {
    signal input ownerCommitment;
    signal input amount;
    signal input nonce;
    signal input ciphertextHash;
    signal output noteCommitment;

    component amountBits = Num2Bits(128);
    amountBits.in <== amount;
    component nonceNotZero = IsZero();
    nonceNotZero.in <== nonce;
    nonceNotZero.out === 0;
    component note = Poseidon(5);
    note.inputs[0] <== 1014;
    note.inputs[1] <== ownerCommitment;
    note.inputs[2] <== amount;
    note.inputs[3] <== nonce;
    note.inputs[4] <== ciphertextHash;
    noteCommitment <== note.out;
}

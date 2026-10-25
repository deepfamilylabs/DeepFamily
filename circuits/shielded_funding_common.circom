pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "shielded_scope_common.circom";
include "shielded_merkle_common.circom";

// A spendable donor VALUE note. Both source and change commitments bind the
// exact ciphertext hash supplied by the pool as a public signal.
// Internal poolDomain must come from the enclosing action's constrained
// ShieldedPoolDomain over its real public chainId and pool.
template ShieldedDonorValueInput() {
    signal input poolDomain;
    signal input ownerSecret;
    signal input amount;
    signal input nonce;
    signal input ciphertextHash;
    signal input shardRoot;
    signal input depth;
    signal input index;
    signal input siblings[32];
    signal output valueNoteTag;
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
    component noteTag = ShieldedScopedTag();
    noteTag.poolDomain <== poolDomain;
    noteTag.purpose <== 1014;
    valueNoteTag <== noteTag.tag;
    component note = Poseidon(5);
    note.inputs[0] <== noteTag.tag;
    note.inputs[1] <== ownerCommitment;
    note.inputs[2] <== amount;
    note.inputs[3] <== nonce;
    note.inputs[4] <== ciphertextHash;
    noteCommitment <== note.out;
    component membership = ShieldedMerkleRoot(32);
    membership.leaf <== noteCommitment;
    membership.depth <== depth;
    membership.index <== index;
    membership.siblings <== siblings;
    membership.out === shardRoot;
    component spendTag = ShieldedScopedTag();
    spendTag.poolDomain <== poolDomain;
    spendTag.purpose <== 1016;
    component spend = Poseidon(3);
    spend.inputs[0] <== spendTag.tag;
    spend.inputs[1] <== ownerSecret;
    spend.inputs[2] <== noteCommitment;
    spendNullifier <== spend.out;
}

// Internal poolDomain must come from the enclosing action's constrained
// ShieldedPoolDomain over its real public chainId and pool.
template ShieldedPrivatePolicy() {
    signal input poolDomain;
    signal input rootIdentityCommitment;
    signal input rootVersionIndex;
    signal input rate;
    signal input policySalt;
    signal input allocationKeyCommitment;
    signal input periodDays;
    signal output commitment;

    component rootNotZero = IsZero();
    rootNotZero.in <== rootIdentityCommitment;
    rootNotZero.out === 0;
    component versionBits = Num2Bits(64);
    versionBits.in <== rootVersionIndex;
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
    component periodDaysBits = Num2Bits(32);
    periodDaysBits.in <== periodDays;
    component periodDaysNotZero = IsZero();
    periodDaysNotZero.in <== periodDays;
    periodDaysNotZero.out === 0;
    component policyTag = ShieldedScopedTag();
    policyTag.poolDomain <== poolDomain;
    policyTag.purpose <== 1010;
    component policy = Poseidon(7);
    policy.inputs[0] <== policyTag.tag;
    policy.inputs[1] <== rootIdentityCommitment;
    policy.inputs[2] <== rootVersionIndex;
    policy.inputs[3] <== rate;
    policy.inputs[4] <== policySalt;
    policy.inputs[5] <== allocationKeyCommitment;
    policy.inputs[6] <== periodDays;
    commitment <== policy.out;
}

// Internal valueNoteTag must come from the constrained donor input in the
// enclosing action, which fixes its purpose to 1014 and binds the real pool.
template ShieldedDonorChange() {
    signal input valueNoteTag;
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
    note.inputs[0] <== valueNoteTag;
    note.inputs[1] <== ownerCommitment;
    note.inputs[2] <== amount;
    note.inputs[3] <== nonce;
    note.inputs[4] <== ciphertextHash;
    noteCommitment <== note.out;
}

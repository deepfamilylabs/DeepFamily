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

// Internal poolDomain must come from the enclosing action's constrained
// ShieldedPoolDomain over its real public chainId and pool.
template ShieldedPrivateEnrollment() {
    signal input poolDomain;
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
    component enrollmentTag = ShieldedScopedTag();
    enrollmentTag.poolDomain <== poolDomain;
    enrollmentTag.purpose <== 1011;
    component enrollment = Poseidon(5);
    enrollment.inputs[0] <== enrollmentTag.tag;
    enrollment.inputs[1] <== policyCommitment;
    enrollment.inputs[2] <== heirIdentityCommitment;
    enrollment.inputs[3] <== eligibleFrom;
    enrollment.inputs[4] <== enrollmentSalt;
    commitment <== enrollment.out;
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

// Both budget formats use fixed purposes from the same constrained pool domain.
// Compute this pair once per action; it is internal wiring, not witness input.
template ShieldedBudgetNoteTags() {
    signal input poolDomain;
    signal output privateNoteTag;
    signal output identityNoteTag;

    component privateTag = ShieldedScopedTag();
    privateTag.poolDomain <== poolDomain;
    privateTag.purpose <== 1015;
    privateNoteTag <== privateTag.tag;

    component identityTag = ShieldedScopedTag();
    identityTag.poolDomain <== poolDomain;
    identityTag.purpose <== 1030;
    identityNoteTag <== identityTag.tag;
}

// The binding selector is committed in the note tag and owner/terms slot.
// Private kind 0 binds the owner's spending commitment and private policy.
// Identity kind 1 binds all public terms without exposing private openings.
// Internal note tags must come from ShieldedBudgetNoteTags, whose poolDomain
// comes from the enclosing action's ShieldedPoolDomain over its public inputs.
// They are circuit wiring, never caller-supplied witness values.
template ShieldedBoundBudgetCommitment() {
    signal input privateNoteTag;
    signal input identityNoteTag;
    signal input budgetKind;
    signal input policyCommitment;
    signal input enrollmentCommitment;
    signal input termsCommitment;
    signal input ownerCommitment;
    signal input rate;
    signal input remaining;
    signal input nonce;
    signal input ciphertextHash;
    signal output commitment;

    budgetKind * (1 - budgetKind) === 0;
    signal noteTag <== privateNoteTag + budgetKind * (identityNoteTag - privateNoteTag);
    component note = Poseidon(8);
    note.inputs[0] <== noteTag;
    note.inputs[1] <== policyCommitment;
    note.inputs[2] <== enrollmentCommitment;
    note.inputs[3] <== ownerCommitment + budgetKind * (termsCommitment - ownerCommitment);
    note.inputs[4] <== rate;
    note.inputs[5] <== remaining;
    note.inputs[6] <== nonce;
    note.inputs[7] <== ciphertextHash;
    commitment <== note.out;
}

// Internal poolDomain must come from the enclosing action's constrained
// ShieldedPoolDomain over its real public chainId and pool.
template ShieldedIdentityBudgetTerms() {
    signal input poolDomain;
    signal input rootIdentityCommitment;
    signal input rootVersionIndex;
    signal input heirIdentityCommitment;
    signal input eligibleFrom;
    signal input rate;
    signal input periodDays;
    signal output commitment;
    component termsTag = ShieldedScopedTag();
    termsTag.poolDomain <== poolDomain;
    termsTag.purpose <== 1029;
    component terms = Poseidon(7);
    terms.inputs[0] <== termsTag.tag;
    terms.inputs[1] <== rootIdentityCommitment;
    terms.inputs[2] <== rootVersionIndex;
    terms.inputs[3] <== heirIdentityCommitment;
    terms.inputs[4] <== eligibleFrom;
    terms.inputs[5] <== rate;
    terms.inputs[6] <== periodDays;
    commitment <== terms.out;
}

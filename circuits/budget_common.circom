pragma circom 2.2.3;

include "receive_common.circom";
include "shielded_funding_common.circom";

// One record per code/policy in this pool. Different codes may create distinct
// records; the claim's subject/policy/period nullifier remains canonical.
template BudgetKey() {
    signal input poolDomain;
    signal input codeAlias;
    signal input policyCommitment;
    signal output key;
    component tag = ShieldedScopedTag();
    tag.poolDomain <== poolDomain;
    tag.purpose <== 75001;
    component hash = Poseidon(3);
    hash.inputs[0] <== tag.tag;
    hash.inputs[1] <== codeAlias;
    hash.inputs[2] <== policyCommitment;
    key <== hash.out;
    component aliasNZ = NonZero();
    aliasNZ.in <== codeAlias;
}

// Every independent contribution and its claim remainder uses the same
// format. The immutable eligibleFrom belongs to the budget record; adding
// money cannot reset it. Ciphertext bytes are hashed by the pool, which passes
// that exact field hash into this commitment.
template BudgetNote() {
    signal input poolDomain;
    signal input policyCommitment;
    signal input budgetKey;
    signal input ownerCommitment;
    signal input viewKeyLo;
    signal input viewKeyHi;
    signal input eligibleFrom;
    signal input rate;
    signal input remaining;
    signal input nonce;
    signal input ciphertextHash;
    signal output commitment;
    component noteTag = ShieldedScopedTag();
    noteTag.poolDomain <== poolDomain;
    noteTag.purpose <== 75002;
    component keys = Poseidon(4);
    keys.inputs[0] <== 75003;
    keys.inputs[1] <== ownerCommitment;
    keys.inputs[2] <== viewKeyLo;
    keys.inputs[3] <== viewKeyHi;
    component meta = Poseidon(3);
    meta.inputs[0] <== 75004;
    meta.inputs[1] <== nonce;
    meta.inputs[2] <== ciphertextHash;
    component note = Poseidon(8);
    note.inputs[0] <== noteTag.tag;
    note.inputs[1] <== policyCommitment;
    note.inputs[2] <== budgetKey;
    note.inputs[3] <== keys.out;
    note.inputs[4] <== eligibleFrom;
    note.inputs[5] <== rate;
    note.inputs[6] <== remaining;
    note.inputs[7] <== meta.out;
    commitment <== note.out;
    component loBits = Num2Bits(128);
    loBits.in <== viewKeyLo;
    component hiBits = Num2Bits(128);
    hiBits.in <== viewKeyHi;
    component startBits = Num2Bits(64);
    startBits.in <== eligibleFrom;
    component rateBits = Num2Bits(128);
    rateBits.in <== rate;
    component remainingBits = Num2Bits(128);
    remainingBits.in <== remaining;
    component nz[3];
    nz[0] = NonZero(); nz[0].in <== ownerCommitment;
    nz[1] = NonZero(); nz[1].in <== rate;
    nz[2] = NonZero(); nz[2].in <== nonce;
}

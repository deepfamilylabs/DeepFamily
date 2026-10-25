pragma circom 2.2.3;
include "shielded_funding_common.circom";

// The registry verifies the reusable generic code; this proof binds the payer's
// actual VALUE input and both ciphertexts to that same receiving statement.
template Transfer() {
    signal input chainId;
    signal input pool;
    signal input commonBinding;
    signal input ownerCommitment;
    signal input viewKeyLo;
    signal input viewKeyHi;
    signal input inputRoot;
    signal input inputNullifier;
    signal input outputCommitments[2];
    signal input ciphertextHashes[2];
    signal input donorOwnerSecret;
    signal input donorAmount;
    signal input donorNonce;
    signal input donorCiphertextHash;
    signal input donorDepth;
    signal input donorIndex;
    signal input donorSiblings[32];
    signal input amount;
    signal input recipientNonce;
    signal input changeNonce;

    component scope = ShieldedPoolDomain();
    scope.chainId <== chainId;
    scope.pool <== pool;
    component donor = ShieldedDonorValueInput();
    donor.poolDomain <== scope.domain;
    donor.ownerSecret <== donorOwnerSecret;
    donor.amount <== donorAmount;
    donor.nonce <== donorNonce;
    donor.ciphertextHash <== donorCiphertextHash;
    donor.shardRoot <== inputRoot;
    donor.depth <== donorDepth;
    donor.index <== donorIndex;
    donor.siblings <== donorSiblings;
    donor.spendNullifier === inputNullifier;
    component amountBits = Num2Bits(128);
    amountBits.in <== amount;
    component viewLoBits = Num2Bits(128); viewLoBits.in <== viewKeyLo;
    component viewHiBits = Num2Bits(128); viewHiBits.in <== viewKeyHi;
    component nonzero[4];
    for (var i = 0; i < 4; i++) nonzero[i] = IsZero();
    nonzero[0].in <== amount; nonzero[0].out === 0;
    nonzero[1].in <== commonBinding; nonzero[1].out === 0;
    nonzero[2].in <== ownerCommitment; nonzero[2].out === 0;
    nonzero[3].in <== viewKeyLo + viewKeyHi; nonzero[3].out === 0;
    component recipient = ShieldedDonorChange();
    recipient.valueNoteTag <== donor.valueNoteTag;
    recipient.ownerCommitment <== ownerCommitment;
    recipient.amount <== amount;
    recipient.nonce <== recipientNonce;
    recipient.ciphertextHash <== ciphertextHashes[0];
    recipient.noteCommitment === outputCommitments[0];
    component change = ShieldedDonorChange();
    change.valueNoteTag <== donor.valueNoteTag;
    change.ownerCommitment <== donor.ownerCommitment;
    change.amount <== donorAmount - amount;
    change.nonce <== changeNonce;
    change.ciphertextHash <== ciphertextHashes[1];
    change.noteCommitment === outputCommitments[1];
}

component main { public [chainId,pool,commonBinding,ownerCommitment,viewKeyLo,viewKeyHi,
    inputRoot,inputNullifier,outputCommitments,ciphertextHashes] } = Transfer();

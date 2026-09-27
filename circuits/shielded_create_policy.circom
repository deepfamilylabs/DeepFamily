pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "@zk-kit/binary-merkle-root.circom/src/binary-merkle-root.circom";

// Action 1. The policy note carries no DEEP value; the entire input value is
// returned as a fresh private value note. The policy itself is hidden behind
// a random salt and a separate random note nonce.
template ShieldedCreatePolicy() {
    signal input publicSignals[32];
    signal input ownerSecret;
    signal input inputAmount;
    signal input inputNonce;
    signal input inputCiphertextHash;
    signal input noteDepth;
    signal input noteIndex;
    signal input noteSiblings[32];
    signal input rootIdentityCommitment;
    signal input rootVersionIndex;
    signal input rate;
    signal input policySalt;
    signal input allocationKey;
    signal input policyNonce;
    signal input changeNonce;

    publicSignals[0] === 1;
    component chainBits = Num2Bits(64);
    chainBits.in <== publicSignals[1];
    component poolBits = Num2Bits(160);
    poolBits.in <== publicSignals[2];
    publicSignals[3] === publicSignals[5];
    publicSignals[4] === publicSignals[6];
    for (var i = 9; i <= 20; i++) {
        publicSignals[i] === 0;
    }
    for (var i = 25; i <= 31; i++) {
        publicSignals[i] === 0;
    }

    component ownerNotZero = IsZero();
    ownerNotZero.in <== ownerSecret;
    ownerNotZero.out === 0;
    component owner = Poseidon(2);
    owner.inputs[0] <== 1013;
    owner.inputs[1] <== ownerSecret;
    component amountBits = Num2Bits(128);
    amountBits.in <== inputAmount;
    component inputNonceNotZero = IsZero();
    inputNonceNotZero.in <== inputNonce;
    inputNonceNotZero.out === 0;
    component inputNote = Poseidon(5);
    inputNote.inputs[0] <== 1014;
    inputNote.inputs[1] <== owner.out;
    inputNote.inputs[2] <== inputAmount;
    inputNote.inputs[3] <== inputNonce;
    inputNote.inputs[4] <== inputCiphertextHash;

    component depthBits = Num2Bits(6);
    depthBits.in <== noteDepth;
    component depthOk = LessEqThan(6);
    depthOk.in[0] <== noteDepth;
    depthOk.in[1] <== 32;
    depthOk.out === 1;
    component membership = BinaryMerkleRoot(32);
    membership.leaf <== inputNote.out;
    membership.depth <== noteDepth;
    membership.index <== noteIndex;
    membership.siblings <== noteSiblings;
    membership.out === publicSignals[4];

    component spend = Poseidon(3);
    spend.inputs[0] <== 1016;
    spend.inputs[1] <== ownerSecret;
    spend.inputs[2] <== inputNote.out;
    spend.out === publicSignals[7];
    component dummySpend = Poseidon(3);
    dummySpend.inputs[0] <== 1021;
    dummySpend.inputs[1] <== ownerSecret;
    dummySpend.inputs[2] <== inputNote.out;
    dummySpend.out === publicSignals[8];

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
    component allocationKeyNotZero = IsZero();
    allocationKeyNotZero.in <== allocationKey;
    allocationKeyNotZero.out === 0;
    component keyCommitment = Poseidon(2);
    keyCommitment.inputs[0] <== 1028;
    keyCommitment.inputs[1] <== allocationKey;
    component policyNonceNotZero = IsZero();
    policyNonceNotZero.in <== policyNonce;
    policyNonceNotZero.out === 0;
    component changeNonceNotZero = IsZero();
    changeNonceNotZero.in <== changeNonce;
    changeNonceNotZero.out === 0;

    component policy = Poseidon(6);
    policy.inputs[0] <== 1010;
    policy.inputs[1] <== rootIdentityCommitment;
    policy.inputs[2] <== rootVersionIndex;
    policy.inputs[3] <== rate;
    policy.inputs[4] <== policySalt;
    policy.inputs[5] <== keyCommitment.out;
    component policyNote = Poseidon(4);
    policyNote.inputs[0] <== 1024;
    policyNote.inputs[1] <== policy.out;
    policyNote.inputs[2] <== policyNonce;
    policyNote.inputs[3] <== publicSignals[23];
    policyNote.out === publicSignals[21];

    component change = Poseidon(5);
    change.inputs[0] <== 1014;
    change.inputs[1] <== owner.out;
    change.inputs[2] <== inputAmount;
    change.inputs[3] <== changeNonce;
    change.inputs[4] <== publicSignals[24];
    change.out === publicSignals[22];
}

component main { public [publicSignals] } = ShieldedCreatePolicy();

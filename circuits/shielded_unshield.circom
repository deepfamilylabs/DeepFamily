pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "@zk-kit/binary-merkle-root.circom/src/binary-merkle-root.circom";

// Action 7 of ShieldedDeepPool's fixed publicSignals[32] interface. One real
// input note is spent; the second input slot is a domain-separated dummy tag
// bound to that same note. The output slots contain private change and an
// encrypted zero-value dummy. Clients merge notes before unshielding more than
// one input value note at a time.
template ShieldedUnshield() {
    signal input publicSignals[32];
    signal input ownerSecret;
    signal input inputAmount;
    signal input inputNonce;
    signal input inputCiphertextHash;
    signal input noteDepth;
    signal input noteIndex;
    signal input noteSiblings[32];
    signal input changeAmount;
    signal input changeNonce;
    signal input dummyNonce;

    publicSignals[0] === 7;
    component chainBits = Num2Bits(64);
    chainBits.in <== publicSignals[1];
    component poolBits = Num2Bits(160);
    poolBits.in <== publicSignals[2];
    publicSignals[3] === publicSignals[5];
    publicSignals[4] === publicSignals[6];
    for (var i = 9; i <= 20; i++) {
        publicSignals[i] === 0;
    }
    publicSignals[27] === 0;
    publicSignals[28] === 0;
    publicSignals[29] === 0;
    publicSignals[30] === 0;
    publicSignals[31] === 0;

    component amountBits = Num2Bits(128);
    amountBits.in <== publicSignals[25];
    component amountNotZero = IsZero();
    amountNotZero.in <== publicSignals[25];
    amountNotZero.out === 0;
    component recipientBits = Num2Bits(160);
    recipientBits.in <== publicSignals[26];
    component recipientNotZero = IsZero();
    recipientNotZero.in <== publicSignals[26];
    recipientNotZero.out === 0;

    component ownerNotZero = IsZero();
    ownerNotZero.in <== ownerSecret;
    ownerNotZero.out === 0;
    component owner = Poseidon(2);
    owner.inputs[0] <== 1013;
    owner.inputs[1] <== ownerSecret;
    component inputAmountBits = Num2Bits(128);
    inputAmountBits.in <== inputAmount;
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

    component changeBits = Num2Bits(128);
    changeBits.in <== changeAmount;
    inputAmount === publicSignals[25] + changeAmount;
    component changeNonceNotZero = IsZero();
    changeNonceNotZero.in <== changeNonce;
    changeNonceNotZero.out === 0;
    component dummyNonceNotZero = IsZero();
    dummyNonceNotZero.in <== dummyNonce;
    dummyNonceNotZero.out === 0;

    component changeNote = Poseidon(5);
    changeNote.inputs[0] <== 1014;
    changeNote.inputs[1] <== owner.out;
    changeNote.inputs[2] <== changeAmount;
    changeNote.inputs[3] <== changeNonce;
    changeNote.inputs[4] <== publicSignals[23];
    changeNote.out === publicSignals[21];
    component dummyNote = Poseidon(5);
    dummyNote.inputs[0] <== 1014;
    dummyNote.inputs[1] <== owner.out;
    dummyNote.inputs[2] <== 0;
    dummyNote.inputs[3] <== dummyNonce;
    dummyNote.inputs[4] <== publicSignals[24];
    dummyNote.out === publicSignals[22];
}

component main { public [publicSignals] } = ShieldedUnshield();

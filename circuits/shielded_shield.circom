pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Action 0 of ShieldedDeepPool's fixed publicSignals[32] interface. The
// deposited ERC20 amount is public; the two output amounts and their owner are
// private. Both outputs, including a zero-value dummy, must carry distinct
// encrypted note ciphertexts whose exact hashes occupy signals 23 and 24.
template ShieldedShield() {
    signal input publicSignals[32];
    signal input ownerSecret;
    signal input outputAmounts[2];
    signal input outputNonces[2];

    publicSignals[0] === 0;
    component chainBits = Num2Bits(64);
    chainBits.in <== publicSignals[1];
    component poolBits = Num2Bits(160);
    poolBits.in <== publicSignals[2];

    // Shielding consumes no old notes or period entitlements.
    for (var i = 3; i <= 20; i++) {
        publicSignals[i] === 0;
    }
    publicSignals[26] === 0;
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

    component ownerNotZero = IsZero();
    ownerNotZero.in <== ownerSecret;
    ownerNotZero.out === 0;
    component owner = Poseidon(2);
    owner.inputs[0] <== 1013;
    owner.inputs[1] <== ownerSecret;

    component outputAmountBits[2];
    component outputNonceNotZero[2];
    component notes[2];
    for (var i = 0; i < 2; i++) {
        outputAmountBits[i] = Num2Bits(128);
        outputAmountBits[i].in <== outputAmounts[i];
        outputNonceNotZero[i] = IsZero();
        outputNonceNotZero[i].in <== outputNonces[i];
        outputNonceNotZero[i].out === 0;
        notes[i] = Poseidon(5);
        notes[i].inputs[0] <== 1014;
        notes[i].inputs[1] <== owner.out;
        notes[i].inputs[2] <== outputAmounts[i];
        notes[i].inputs[3] <== outputNonces[i];
        notes[i].inputs[4] <== publicSignals[23 + i];
        notes[i].out === publicSignals[21 + i];
    }
    outputAmounts[0] + outputAmounts[1] === publicSignals[25];
}

component main { public [publicSignals] } = ShieldedShield();

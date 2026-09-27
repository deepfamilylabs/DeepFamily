pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "@zk-kit/binary-merkle-root.circom/src/binary-merkle-root.circom";

// Action 4. A child combines two of their BUDGET_NOTEs from the same private
// policy/enrollment. Both old notes are consumed. The combined budget remains
// in whole periods, and the second public output is an encrypted zero-value
// VALUE_NOTE to preserve the pool's two-output transaction shape.
template ShieldedMergeBudget() {
    signal input publicSignals[32];
    signal input ownerSecret;
    signal input policyCommitment;
    signal input enrollmentCommitment;
    signal input rate;
    signal input remaining[2];
    signal input remainingPeriods[2];
    signal input inputNonces[2];
    signal input inputCiphertextHashes[2];
    signal input inputDepths[2];
    signal input inputIndices[2];
    signal input inputSiblings[2][32];
    signal input mergedNonce;
    signal input dummyNonce;

    publicSignals[0] === 4;
    component chainBits = Num2Bits(64);
    chainBits.in <== publicSignals[1];
    component poolBits = Num2Bits(160);
    poolBits.in <== publicSignals[2];
    for (var i = 9; i <= 20; i++) {
        publicSignals[i] === 0;
    }
    for (var i = 25; i <= 31; i++) {
        publicSignals[i] === 0;
    }

    component ownerNotZero = IsZero();
    ownerNotZero.in <== ownerSecret;
    ownerNotZero.out === 0;
    component policyNotZero = IsZero();
    policyNotZero.in <== policyCommitment;
    policyNotZero.out === 0;
    component enrollmentNotZero = IsZero();
    enrollmentNotZero.in <== enrollmentCommitment;
    enrollmentNotZero.out === 0;
    component rateBits = Num2Bits(128);
    rateBits.in <== rate;
    component rateNotZero = IsZero();
    rateNotZero.in <== rate;
    rateNotZero.out === 0;
    component owner = Poseidon(2);
    owner.inputs[0] <== 1013;
    owner.inputs[1] <== ownerSecret;

    component amountBits[2];
    component periodBits[2];
    component nonceNotZero[2];
    component inputBudget[2];
    component depthBits[2];
    component depthOk[2];
    component membership[2];
    component spend[2];
    for (var i = 0; i < 2; i++) {
        amountBits[i] = Num2Bits(128);
        amountBits[i].in <== remaining[i];
        periodBits[i] = Num2Bits(64);
        periodBits[i].in <== remainingPeriods[i];
        remaining[i] === rate * remainingPeriods[i];
        nonceNotZero[i] = IsZero();
        nonceNotZero[i].in <== inputNonces[i];
        nonceNotZero[i].out === 0;
        inputBudget[i] = Poseidon(8);
        inputBudget[i].inputs[0] <== 1015;
        inputBudget[i].inputs[1] <== policyCommitment;
        inputBudget[i].inputs[2] <== enrollmentCommitment;
        inputBudget[i].inputs[3] <== owner.out;
        inputBudget[i].inputs[4] <== rate;
        inputBudget[i].inputs[5] <== remaining[i];
        inputBudget[i].inputs[6] <== inputNonces[i];
        inputBudget[i].inputs[7] <== inputCiphertextHashes[i];
        depthBits[i] = Num2Bits(6);
        depthBits[i].in <== inputDepths[i];
        depthOk[i] = LessEqThan(6);
        depthOk[i].in[0] <== inputDepths[i];
        depthOk[i].in[1] <== 32;
        depthOk[i].out === 1;
        membership[i] = BinaryMerkleRoot(32);
        membership[i].leaf <== inputBudget[i].out;
        membership[i].depth <== inputDepths[i];
        membership[i].index <== inputIndices[i];
        for (var level = 0; level < 32; level++) {
            membership[i].siblings[level] <== inputSiblings[i][level];
        }
        membership[i].out === publicSignals[4 + i * 2];
        spend[i] = Poseidon(3);
        spend[i].inputs[0] <== 1016;
        spend[i].inputs[1] <== ownerSecret;
        spend[i].inputs[2] <== inputBudget[i].out;
        spend[i].out === publicSignals[7 + i];
    }
    component notesAreDistinct = IsEqual();
    notesAreDistinct.in[0] <== inputBudget[0].out;
    notesAreDistinct.in[1] <== inputBudget[1].out;
    notesAreDistinct.out === 0;

    signal mergedRemaining <== remaining[0] + remaining[1];
    component mergedRemainingBits = Num2Bits(128);
    mergedRemainingBits.in <== mergedRemaining;
    signal mergedPeriods <== remainingPeriods[0] + remainingPeriods[1];
    component mergedPeriodsBits = Num2Bits(64);
    mergedPeriodsBits.in <== mergedPeriods;
    mergedRemaining === rate * mergedPeriods;
    component mergedNonceNotZero = IsZero();
    mergedNonceNotZero.in <== mergedNonce;
    mergedNonceNotZero.out === 0;
    component dummyNonceNotZero = IsZero();
    dummyNonceNotZero.in <== dummyNonce;
    dummyNonceNotZero.out === 0;
    component mergedBudget = Poseidon(8);
    mergedBudget.inputs[0] <== 1015;
    mergedBudget.inputs[1] <== policyCommitment;
    mergedBudget.inputs[2] <== enrollmentCommitment;
    mergedBudget.inputs[3] <== owner.out;
    mergedBudget.inputs[4] <== rate;
    mergedBudget.inputs[5] <== mergedRemaining;
    mergedBudget.inputs[6] <== mergedNonce;
    mergedBudget.inputs[7] <== publicSignals[23];
    mergedBudget.out === publicSignals[21];
    component dummyValue = Poseidon(5);
    dummyValue.inputs[0] <== 1014;
    dummyValue.inputs[1] <== owner.out;
    dummyValue.inputs[2] <== 0;
    dummyValue.inputs[3] <== dummyNonce;
    dummyValue.inputs[4] <== publicSignals[24];
    dummyValue.out === publicSignals[22];
}

component main { public [publicSignals] } = ShieldedMergeBudget();

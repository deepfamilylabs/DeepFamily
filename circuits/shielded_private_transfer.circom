pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "@zk-kit/binary-merkle-root.circom/src/binary-merkle-root.circom";

// Action 6. One or two independently owned VALUE_NOTE inputs fund two
// encrypted VALUE_NOTE outputs. An absent second input uses a domain-separated
// dummy nullifier bound to the first note, with no value contribution. The
// input count is a private witness, though different public roots reveal two
// inputs. Amounts, recipients, policy, and heir are not public inputs.
template ShieldedPrivateTransfer() {
    signal input publicSignals[32];
    signal input hasSecondInput;
    signal input inputOwnerSecrets[2];
    signal input inputAmounts[2];
    signal input inputNonces[2];
    signal input inputCiphertextHashes[2];
    signal input inputDepths[2];
    signal input inputIndices[2];
    signal input inputSiblings[2][32];
    signal input outputOwnerCommitments[2];
    signal input outputAmounts[2];
    signal input outputNonces[2];

    publicSignals[0] === 6;
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
    hasSecondInput * (hasSecondInput - 1) === 0;
    (1 - hasSecondInput) * (publicSignals[5] - publicSignals[3]) === 0;
    (1 - hasSecondInput) * (publicSignals[6] - publicSignals[4]) === 0;

    component ownerNotZero[2];
    component owner[2];
    component inputAmountBits[2];
    component inputNonceNotZero[2];
    component inputNote[2];
    component depthBits[2];
    component depthOk[2];
    component membership[2];
    component spend[2];
    component outputOwnerNotZero[2];
    component outputAmountBits[2];
    component outputNonceNotZero[2];
    component outputNote[2];
    for (var i = 0; i < 2; i++) {
        ownerNotZero[i] = IsZero();
        ownerNotZero[i].in <== inputOwnerSecrets[i];
        if (i == 0) {
            ownerNotZero[i].out === 0;
        } else {
            hasSecondInput * ownerNotZero[i].out === 0;
            (1 - hasSecondInput) * inputOwnerSecrets[i] === 0;
            (1 - hasSecondInput) * inputAmounts[i] === 0;
            (1 - hasSecondInput) * inputNonces[i] === 0;
            (1 - hasSecondInput) * inputCiphertextHashes[i] === 0;
            (1 - hasSecondInput) * inputDepths[i] === 0;
            (1 - hasSecondInput) * inputIndices[i] === 0;
            for (var level = 0; level < 32; level++) {
                (1 - hasSecondInput) * inputSiblings[i][level] === 0;
            }
        }
        owner[i] = Poseidon(2);
        owner[i].inputs[0] <== 1013;
        owner[i].inputs[1] <== inputOwnerSecrets[i];
        inputAmountBits[i] = Num2Bits(128);
        inputAmountBits[i].in <== inputAmounts[i];
        inputNonceNotZero[i] = IsZero();
        inputNonceNotZero[i].in <== inputNonces[i];
        if (i == 0) {
            inputNonceNotZero[i].out === 0;
        } else {
            hasSecondInput * inputNonceNotZero[i].out === 0;
        }
        inputNote[i] = Poseidon(5);
        inputNote[i].inputs[0] <== 1014;
        inputNote[i].inputs[1] <== owner[i].out;
        inputNote[i].inputs[2] <== inputAmounts[i];
        inputNote[i].inputs[3] <== inputNonces[i];
        inputNote[i].inputs[4] <== inputCiphertextHashes[i];
        depthBits[i] = Num2Bits(6);
        depthBits[i].in <== inputDepths[i];
        depthOk[i] = LessEqThan(6);
        depthOk[i].in[0] <== inputDepths[i];
        depthOk[i].in[1] <== 32;
        depthOk[i].out === 1;
        membership[i] = BinaryMerkleRoot(32);
        membership[i].leaf <== inputNote[i].out;
        membership[i].depth <== inputDepths[i];
        membership[i].index <== inputIndices[i];
        for (var level = 0; level < 32; level++) {
            membership[i].siblings[level] <== inputSiblings[i][level];
        }
        if (i == 0) {
            membership[i].out === publicSignals[4];
        } else {
            hasSecondInput * (membership[i].out - publicSignals[6]) === 0;
        }
        spend[i] = Poseidon(3);
        spend[i].inputs[0] <== 1016;
        spend[i].inputs[1] <== inputOwnerSecrets[i];
        spend[i].inputs[2] <== inputNote[i].out;
        if (i == 0) {
            spend[i].out === publicSignals[7];
        }

        outputOwnerNotZero[i] = IsZero();
        outputOwnerNotZero[i].in <== outputOwnerCommitments[i];
        outputOwnerNotZero[i].out === 0;
        outputAmountBits[i] = Num2Bits(128);
        outputAmountBits[i].in <== outputAmounts[i];
        outputNonceNotZero[i] = IsZero();
        outputNonceNotZero[i].in <== outputNonces[i];
        outputNonceNotZero[i].out === 0;
        outputNote[i] = Poseidon(5);
        outputNote[i].inputs[0] <== 1014;
        outputNote[i].inputs[1] <== outputOwnerCommitments[i];
        outputNote[i].inputs[2] <== outputAmounts[i];
        outputNote[i].inputs[3] <== outputNonces[i];
        outputNote[i].inputs[4] <== publicSignals[23 + i];
        outputNote[i].out === publicSignals[21 + i];
    }
    component dummySpend = Poseidon(3);
    dummySpend.inputs[0] <== 1021;
    dummySpend.inputs[1] <== inputOwnerSecrets[0];
    dummySpend.inputs[2] <== inputNote[0].out;
    publicSignals[8] === dummySpend.out + hasSecondInput * (spend[1].out - dummySpend.out);
    inputAmounts[0] + inputAmounts[1] === outputAmounts[0] + outputAmounts[1];
}

component main { public [publicSignals] } = ShieldedPrivateTransfer();

pragma circom 2.2.3;
include "shielded_value_common.circom";
include "shielded_receive_binding_common.circom";

// Action 3: one to four VALUE inputs owned by the same secret fund two
// encrypted outputs. Disabled slots use zero openings and secret-bound padding.
template ShieldedPrivateTransfer(CAPACITY) {
    signal input chainId;
    signal input pool;
    signal input inputRoots[CAPACITY];
    signal input inputNullifiers[CAPACITY];
    signal input outputCommitments[2];
    signal input ciphertextHashes[2];
    signal input receiveBindings[2];
    signal input receiveAuthorizationAliases[2];
    signal input receiveSalts[2];
    signal input receiveKeyModes[2];
    signal input receiveViewKeyLo[2];
    signal input receiveViewKeyHi[2];
    signal input inputEnabled[CAPACITY];
    signal input inputOwnerSecrets[CAPACITY];
    signal input inputAmounts[CAPACITY];
    signal input inputNonces[CAPACITY];
    signal input inputCiphertextHashes[CAPACITY];
    signal input inputDepths[CAPACITY];
    signal input inputIndices[CAPACITY];
    signal input inputSiblings[CAPACITY][32];
    signal input outputOwnerCommitments[2];
    signal input outputAmounts[2];
    signal input outputNonces[2];
    component scope = ShieldedPoolDomain();
    scope.chainId <== chainId;
    scope.pool <== pool;
    component inputs = ShieldedValueInputs(CAPACITY);
    inputs.poolDomain <== scope.domain;
    inputs.inputRoots <== inputRoots;
    inputs.inputNullifiers <== inputNullifiers;
    inputs.inputEnabled <== inputEnabled;
    inputs.inputOwnerSecrets <== inputOwnerSecrets;
    inputs.inputAmounts <== inputAmounts;
    inputs.inputNonces <== inputNonces;
    inputs.inputCiphertextHashes <== inputCiphertextHashes;
    inputs.inputDepths <== inputDepths;
    inputs.inputIndices <== inputIndices;
    inputs.inputSiblings <== inputSiblings;
    component outputs = ShieldedValueOutputs();
    outputs.poolDomain <== scope.domain;
    outputs.outputCommitments <== outputCommitments;
    outputs.ciphertextHashes <== ciphertextHashes;
    outputs.outputOwnerCommitments <== outputOwnerCommitments;
    outputs.outputAmounts <== outputAmounts;
    outputs.outputNonces <== outputNonces;
    inputs.totalAmount === outputs.totalAmount;
    component bindingZero[2];
    component receipt[2];
    component selfOwner[2];
    for (var i = 0; i < 2; i++) {
        bindingZero[i] = IsZero();
        bindingZero[i].in <== receiveBindings[i];
        // A zero authorization is permitted only for an output derived from
        // the actual root spending secret and that output's own nonce.
        selfOwner[i] = Poseidon(3);
        selfOwner[i].inputs[0] <== 1013;
        selfOwner[i].inputs[1] <== inputOwnerSecrets[0];
        selfOwner[i].inputs[2] <== outputNonces[i];
        bindingZero[i].out * (outputOwnerCommitments[i] - selfOwner[i].out) === 0;
        // A receiving code authenticates its complete address digest. The
        // same digest, reduced in the circuit field, diversifies its owner.
        (1 - bindingZero[i].out) * (outputNonces[i] - receiveViewKeyLo[i]
            - 340282366920938463463374607431768211456 * receiveViewKeyHi[i]) === 0;
        receipt[i] = ShieldedReceiveRecipientBinding();
        receipt[i].enabled <== 1 - bindingZero[i].out;
        receipt[i].authorizationAlias <== receiveAuthorizationAliases[i];
        receipt[i].ownerCommitment <== outputOwnerCommitments[i];
        receipt[i].keyMode <== receiveKeyModes[i];
        receipt[i].viewKeyLo <== receiveViewKeyLo[i];
        receipt[i].viewKeyHi <== receiveViewKeyHi[i];
        receipt[i].salt <== receiveSalts[i];
        receipt[i].binding === receiveBindings[i];
    }
}


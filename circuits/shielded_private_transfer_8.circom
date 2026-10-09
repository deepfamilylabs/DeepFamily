pragma circom 2.2.3;
include "shielded_value_common.circom";

template ShieldedPrivateTransfer8() {
    signal input chainId;
    signal input pool;
    signal input inputShardIds[8];
    signal input inputRoots[8];
    signal input inputNullifiers[8];
    signal input outputCommitments[2];
    signal input ciphertextHashes[2];
    signal input inputEnabled[8];
    signal input inputOwnerSecrets[8];
    signal input inputAmounts[8];
    signal input inputNonces[8];
    signal input inputCiphertextHashes[8];
    signal input inputDepths[8];
    signal input inputIndices[8];
    signal input inputSiblings[8][32];
    signal input outputOwnerCommitments[2];
    signal input outputAmounts[2];
    signal input outputNonces[2];
    component scope = ShieldedPoolDomain();
    scope.chainId <== chainId;
    scope.pool <== pool;
    component inputs = ShieldedValueInputs(8);
    inputs.poolDomain <== scope.domain;
    inputs.inputShardIds <== inputShardIds;
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
}

component main { public [chainId, pool, inputShardIds, inputRoots, inputNullifiers, outputCommitments, ciphertextHashes] } = ShieldedPrivateTransfer8();

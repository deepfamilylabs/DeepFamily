pragma circom 2.2.3;
include "shielded_value_common.circom";

// Action 4: one to four VALUE inputs fund a public withdrawal, private change,
// and a zero-value output. All real inputs share the same owner and pool.
template ShieldedUnshield() {
    signal input chainId;
    signal input pool;
    signal input inputShardIds[4];
    signal input inputRoots[4];
    signal input inputNullifiers[4];
    signal input outputCommitments[2];
    signal input ciphertextHashes[2];
    signal input amount;
    signal input recipient;
    signal input inputEnabled[4];
    signal input inputOwnerSecrets[4];
    signal input inputAmounts[4];
    signal input inputNonces[4];
    signal input inputCiphertextHashes[4];
    signal input inputDepths[4];
    signal input inputIndices[4];
    signal input inputSiblings[4][32];
    signal input changeAmount;
    signal input changeNonce;
    signal input dummyNonce;
    component scope = ShieldedPoolDomain();
    scope.chainId <== chainId;
    scope.pool <== pool;
    component inputs = ShieldedValueInputs(4);
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
    component amountBits = Num2Bits(128);
    amountBits.in <== amount;
    component amountZero = IsZero();
    amountZero.in <== amount;
    amountZero.out === 0;
    component recipientBits = Num2Bits(160);
    recipientBits.in <== recipient;
    component recipientZero = IsZero();
    recipientZero.in <== recipient;
    recipientZero.out === 0;
    component outputs = ShieldedValueOutputs();
    outputs.poolDomain <== scope.domain;
    outputs.outputCommitments <== outputCommitments;
    outputs.ciphertextHashes <== ciphertextHashes;
    outputs.outputOwnerCommitments[0] <== inputs.ownerCommitment;
    outputs.outputOwnerCommitments[1] <== inputs.ownerCommitment;
    outputs.outputAmounts[0] <== changeAmount;
    outputs.outputAmounts[1] <== 0;
    outputs.outputNonces[0] <== changeNonce;
    outputs.outputNonces[1] <== dummyNonce;
    inputs.totalAmount === amount + outputs.totalAmount;
}

component main { public [chainId, pool, inputShardIds, inputRoots, inputNullifiers, outputCommitments, ciphertextHashes, amount, recipient] } = ShieldedUnshield();

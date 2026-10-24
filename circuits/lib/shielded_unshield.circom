pragma circom 2.2.3;
include "../shielded_value_common.circom";

// Action 4: one to four VALUE inputs fund a public withdrawal, private change,
// and a zero-value output. All real inputs share the same owner and pool.
template ShieldedUnshield(CAPACITY) {
    signal input chainId;
    signal input pool;
    signal input inputShardIds[CAPACITY];
    signal input inputRoots[CAPACITY];
    signal input inputNullifiers[CAPACITY];
    signal input outputCommitments[2];
    signal input ciphertextHashes[2];
    signal input amount;
    signal input recipient;
    signal input inputEnabled[CAPACITY];
    signal input inputOwnerSecrets[CAPACITY];
    signal input inputAmounts[CAPACITY];
    signal input inputNonces[CAPACITY];
    signal input inputCiphertextHashes[CAPACITY];
    signal input inputDepths[CAPACITY];
    signal input inputIndices[CAPACITY];
    signal input inputSiblings[CAPACITY][32];
    signal input changeAmount;
    signal input changeNonce;
    signal input dummyNonce;
    component scope = ShieldedPoolDomain();
    scope.chainId <== chainId;
    scope.pool <== pool;
    component inputs = ShieldedValueInputs(CAPACITY);
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


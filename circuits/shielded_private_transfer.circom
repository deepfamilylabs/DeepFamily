pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "shielded_scope_common.circom";
include "shielded_merkle_common.circom";

// Action 3. One or two independently owned VALUE_NOTE inputs fund two
// encrypted VALUE_NOTE outputs. An absent second input uses a domain-separated
// dummy nullifier bound to the first note, with no value contribution, and
// repeats the first input's shard and root. The input count is a private
// witness, though different public roots reveal two inputs. Amounts,
// recipients, policy, and heir are not public inputs.
template ShieldedPrivateTransfer() {
    signal input chainId;
    signal input pool;
    signal input inputShardIds[2];
    signal input inputRoots[2];
    signal input inputNullifiers[2];
    signal input outputCommitments[2];
    signal input ciphertextHashes[2];

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

    component sharedScope = ShieldedPoolDomain();
    sharedScope.chainId <== chainId;
    sharedScope.pool <== pool;

    component valueTag = ShieldedScopedTag();
    valueTag.poolDomain <== sharedScope.domain;
    valueTag.purpose <== 1014;
    component spendTag = ShieldedScopedTag();
    spendTag.poolDomain <== sharedScope.domain;
    spendTag.purpose <== 1016;
    component dummyInputTag = ShieldedScopedTag();
    dummyInputTag.poolDomain <== sharedScope.domain;
    dummyInputTag.purpose <== 1021;

    hasSecondInput * (hasSecondInput - 1) === 0;
    (1 - hasSecondInput) * (inputShardIds[1] - inputShardIds[0]) === 0;
    (1 - hasSecondInput) * (inputRoots[1] - inputRoots[0]) === 0;

    component ownerNotZero[2];
    component owner[2];
    component inputAmountBits[2];
    component inputNonceNotZero[2];
    component inputNote[2];
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
        inputNote[i].inputs[0] <== valueTag.tag;
        inputNote[i].inputs[1] <== owner[i].out;
        inputNote[i].inputs[2] <== inputAmounts[i];
        inputNote[i].inputs[3] <== inputNonces[i];
        inputNote[i].inputs[4] <== inputCiphertextHashes[i];
        membership[i] = ShieldedMerkleRoot(32);
        membership[i].leaf <== inputNote[i].out;
        membership[i].depth <== inputDepths[i];
        membership[i].index <== inputIndices[i];
        for (var level = 0; level < 32; level++) {
            membership[i].siblings[level] <== inputSiblings[i][level];
        }
        if (i == 0) {
            membership[i].out === inputRoots[0];
        } else {
            hasSecondInput * (membership[i].out - inputRoots[1]) === 0;
        }
        spend[i] = Poseidon(3);
        spend[i].inputs[0] <== spendTag.tag;
        spend[i].inputs[1] <== inputOwnerSecrets[i];
        spend[i].inputs[2] <== inputNote[i].out;
        if (i == 0) {
            spend[i].out === inputNullifiers[0];
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
        outputNote[i].inputs[0] <== valueTag.tag;
        outputNote[i].inputs[1] <== outputOwnerCommitments[i];
        outputNote[i].inputs[2] <== outputAmounts[i];
        outputNote[i].inputs[3] <== outputNonces[i];
        outputNote[i].inputs[4] <== ciphertextHashes[i];
        outputNote[i].out === outputCommitments[i];
    }
    component dummySpend = Poseidon(3);
    dummySpend.inputs[0] <== dummyInputTag.tag;
    dummySpend.inputs[1] <== inputOwnerSecrets[0];
    dummySpend.inputs[2] <== inputNote[0].out;
    inputNullifiers[1] === dummySpend.out + hasSecondInput * (spend[1].out - dummySpend.out);
    inputAmounts[0] + inputAmounts[1] === outputAmounts[0] + outputAmounts[1];
}

component main {
    public [
        chainId,
        pool,
        inputShardIds,
        inputRoots,
        inputNullifiers,
        outputCommitments,
        ciphertextHashes
    ]
} = ShieldedPrivateTransfer();

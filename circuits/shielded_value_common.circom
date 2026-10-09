pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "shielded_scope_common.circom";
include "shielded_merkle_common.circom";

// VALUE spends share their real nullifier formula with every other pool action.
// Capacity changes only the number of slots, never the authority or spend tag.
template ShieldedValueInputs(CAPACITY) {
    assert(CAPACITY == 8);
    signal input poolDomain;
    signal input inputShardIds[CAPACITY];
    signal input inputRoots[CAPACITY];
    signal input inputNullifiers[CAPACITY];
    signal input inputEnabled[CAPACITY];
    signal input inputOwnerSecrets[CAPACITY];
    signal input inputAmounts[CAPACITY];
    signal input inputNonces[CAPACITY];
    signal input inputCiphertextHashes[CAPACITY];
    signal input inputDepths[CAPACITY];
    signal input inputIndices[CAPACITY];
    signal input inputSiblings[CAPACITY][32];
    signal output ownerCommitment;
    signal output totalAmount;

    component valueTag = ShieldedScopedTag();
    valueTag.poolDomain <== poolDomain;
    valueTag.purpose <== 1014;
    component spendTag = ShieldedScopedTag();
    spendTag.poolDomain <== poolDomain;
    spendTag.purpose <== 1016;
    component dummyTag = ShieldedScopedTag();
    dummyTag.poolDomain <== poolDomain;
    dummyTag.purpose <== 1021;

    component owner = Poseidon(2);
    owner.inputs[0] <== 1013;
    owner.inputs[1] <== inputOwnerSecrets[0];
    ownerCommitment <== owner.out;
    component ownerNonzero = IsZero();
    ownerNonzero.in <== inputOwnerSecrets[0];
    ownerNonzero.out === 0;
    inputEnabled[0] === 1;

    component amountBits[CAPACITY];
    component amountZero[CAPACITY];
    component nonceZero[CAPACITY];
    component shardBits[CAPACITY];
    component note[CAPACITY];
    component membership[CAPACITY];
    component spend[CAPACITY];
    signal sums[CAPACITY + 1];
    sums[0] <== 0;
    for (var i = 0; i < CAPACITY; i++) {
        inputEnabled[i] * (inputEnabled[i] - 1) === 0;
        if (i > 0) {
            (1 - inputEnabled[i - 1]) * inputEnabled[i] === 0;
            inputEnabled[i] * (inputOwnerSecrets[i] - inputOwnerSecrets[0]) === 0;
            (1 - inputEnabled[i]) * (inputShardIds[i] - inputShardIds[0]) === 0;
            (1 - inputEnabled[i]) * (inputRoots[i] - inputRoots[0]) === 0;
        }
        (1 - inputEnabled[i]) * inputOwnerSecrets[i] === 0;
        (1 - inputEnabled[i]) * inputAmounts[i] === 0;
        (1 - inputEnabled[i]) * inputNonces[i] === 0;
        (1 - inputEnabled[i]) * inputCiphertextHashes[i] === 0;
        (1 - inputEnabled[i]) * inputDepths[i] === 0;
        (1 - inputEnabled[i]) * inputIndices[i] === 0;
        amountBits[i] = Num2Bits(128);
        amountBits[i].in <== inputAmounts[i];
        amountZero[i] = IsZero();
        amountZero[i].in <== inputAmounts[i];
        inputEnabled[i] * amountZero[i].out === 0;
        nonceZero[i] = IsZero();
        nonceZero[i].in <== inputNonces[i];
        inputEnabled[i] * nonceZero[i].out === 0;
        shardBits[i] = Num2Bits(128);
        shardBits[i].in <== inputShardIds[i];
        note[i] = Poseidon(5);
        note[i].inputs[0] <== valueTag.tag;
        note[i].inputs[1] <== owner.out;
        note[i].inputs[2] <== inputAmounts[i];
        note[i].inputs[3] <== inputNonces[i];
        note[i].inputs[4] <== inputCiphertextHashes[i];
        membership[i] = ShieldedMerkleRoot(32);
        membership[i].leaf <== note[i].out;
        membership[i].depth <== inputDepths[i];
        membership[i].index <== inputIndices[i];
        for (var level = 0; level < 32; level++) {
            (1 - inputEnabled[i]) * inputSiblings[i][level] === 0;
            membership[i].siblings[level] <== inputSiblings[i][level];
        }
        inputEnabled[i] * (membership[i].out - inputRoots[i]) === 0;
        spend[i] = Poseidon(3);
        spend[i].inputs[0] <== spendTag.tag;
        spend[i].inputs[1] <== inputOwnerSecrets[0];
        spend[i].inputs[2] <== note[i].out;
        sums[i + 1] <== sums[i] + inputAmounts[i];
    }
    spend[0].out === inputNullifiers[0];
    // Slot one preserves the existing small-capacity dummy; all further slots
    // include their fixed slot index in the independent dummy-purpose hash.
    component dummyOne = Poseidon(3);
    dummyOne.inputs[0] <== dummyTag.tag;
    dummyOne.inputs[1] <== inputOwnerSecrets[0];
    dummyOne.inputs[2] <== note[0].out;
    inputNullifiers[1] === dummyOne.out + inputEnabled[1] * (spend[1].out - dummyOne.out);
    component dummy[CAPACITY - 2];
    for (var i = 2; i < CAPACITY; i++) {
        dummy[i - 2] = Poseidon(4);
        dummy[i - 2].inputs[0] <== dummyTag.tag;
        dummy[i - 2].inputs[1] <== inputOwnerSecrets[0];
        dummy[i - 2].inputs[2] <== note[0].out;
        dummy[i - 2].inputs[3] <== i;
        inputNullifiers[i] === dummy[i - 2].out + inputEnabled[i] * (spend[i].out - dummy[i - 2].out);
    }
    component sumBits = Num2Bits(131);
    sumBits.in <== sums[CAPACITY];
    totalAmount <== sums[CAPACITY];
    component duplicateNote[CAPACITY * (CAPACITY - 1) / 2];
    component duplicateNullifier[CAPACITY * (CAPACITY - 1) / 2];
    var pair = 0;
    for (var i = 0; i < CAPACITY; i++) {
        for (var j = i + 1; j < CAPACITY; j++) {
            duplicateNote[pair] = IsEqual();
            duplicateNote[pair].in[0] <== note[i].out;
            duplicateNote[pair].in[1] <== note[j].out;
            inputEnabled[j] * duplicateNote[pair].out === 0;
            duplicateNullifier[pair] = IsEqual();
            duplicateNullifier[pair].in[0] <== inputNullifiers[i];
            duplicateNullifier[pair].in[1] <== inputNullifiers[j];
            duplicateNullifier[pair].out === 0;
            pair++;
        }
    }
}

template ShieldedValueOutputs() {
    signal input poolDomain;
    signal input outputCommitments[2];
    signal input ciphertextHashes[2];
    signal input outputOwnerCommitments[2];
    signal input outputAmounts[2];
    signal input outputNonces[2];
    signal output totalAmount;
    component tag = ShieldedScopedTag();
    tag.poolDomain <== poolDomain;
    tag.purpose <== 1014;
    component owners[2];
    component nonces[2];
    component amounts[2];
    component notes[2];
    for (var i = 0; i < 2; i++) {
        owners[i] = IsZero();
        owners[i].in <== outputOwnerCommitments[i];
        owners[i].out === 0;
        nonces[i] = IsZero();
        nonces[i].in <== outputNonces[i];
        nonces[i].out === 0;
        amounts[i] = Num2Bits(128);
        amounts[i].in <== outputAmounts[i];
        notes[i] = Poseidon(5);
        notes[i].inputs[0] <== tag.tag;
        notes[i].inputs[1] <== outputOwnerCommitments[i];
        notes[i].inputs[2] <== outputAmounts[i];
        notes[i].inputs[3] <== outputNonces[i];
        notes[i].inputs[4] <== ciphertextHashes[i];
        notes[i].out === outputCommitments[i];
    }
    totalAmount <== outputAmounts[0] + outputAmounts[1];
}

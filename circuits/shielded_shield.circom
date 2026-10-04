pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "shielded_scope_common.circom";

// Action 0 of the asset pool. The deposited asset amount is public; the two
// output amounts and their owner are private. Both outputs, including a
// zero-value dummy, must carry distinct encrypted note ciphertexts whose exact
// hashes are public inputs. Shielding consumes no old notes.
template ShieldedShield() {
    signal input chainId;
    signal input pool;
    signal input outputCommitments[2];
    signal input ciphertextHashes[2];
    signal input amount;

    signal input ownerSecret;
    signal input outputAmounts[2];
    signal input outputNonces[2];

    component valueTag = ShieldedScopedTag();
    valueTag.chainId <== chainId;
    valueTag.pool <== pool;
    valueTag.purpose <== 1014;

    component chainBits = Num2Bits(64);
    chainBits.in <== chainId;
    component poolBits = Num2Bits(160);
    poolBits.in <== pool;

    component amountBits = Num2Bits(128);
    amountBits.in <== amount;
    component amountNotZero = IsZero();
    amountNotZero.in <== amount;
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
        notes[i].inputs[0] <== valueTag.tag;
        notes[i].inputs[1] <== owner.out;
        notes[i].inputs[2] <== outputAmounts[i];
        notes[i].inputs[3] <== outputNonces[i];
        notes[i].inputs[4] <== ciphertextHashes[i];
        notes[i].out === outputCommitments[i];
    }
    outputAmounts[0] + outputAmounts[1] === amount;
}

component main {
    public [chainId, pool, outputCommitments, ciphertextHashes, amount]
} = ShieldedShield();

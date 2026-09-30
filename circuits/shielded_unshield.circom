pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "@zk-kit/binary-merkle-root.circom/src/binary-merkle-root.circom";

// Action 7 of ShieldedDeepPool. One real input note is spent; the second
// nullifier is a domain-separated dummy tag bound to that same note. The pool
// requires the input's shard and root to fill both of its input slots. The
// output slots contain private change and an encrypted zero-value dummy.
// Clients merge notes before unshielding more than one input value note.
template ShieldedUnshield() {
    signal input chainId;
    signal input pool;
    signal input inputShardId;
    signal input inputRoot;
    signal input inputNullifiers[2];
    signal input outputCommitments[2];
    signal input ciphertextHashes[2];
    signal input amount;
    signal input recipient;

    signal input ownerSecret;
    signal input inputAmount;
    signal input inputNonce;
    signal input inputCiphertextHash;
    signal input noteDepth;
    signal input noteIndex;
    signal input noteSiblings[32];
    signal input changeAmount;
    signal input changeNonce;
    signal input dummyNonce;

    component chainBits = Num2Bits(64);
    chainBits.in <== chainId;
    component poolBits = Num2Bits(160);
    poolBits.in <== pool;

    component amountBits = Num2Bits(128);
    amountBits.in <== amount;
    component amountNotZero = IsZero();
    amountNotZero.in <== amount;
    amountNotZero.out === 0;
    component recipientBits = Num2Bits(160);
    recipientBits.in <== recipient;
    component recipientNotZero = IsZero();
    recipientNotZero.in <== recipient;
    recipientNotZero.out === 0;

    component ownerNotZero = IsZero();
    ownerNotZero.in <== ownerSecret;
    ownerNotZero.out === 0;
    component owner = Poseidon(2);
    owner.inputs[0] <== 1013;
    owner.inputs[1] <== ownerSecret;
    component inputAmountBits = Num2Bits(128);
    inputAmountBits.in <== inputAmount;
    component inputNonceNotZero = IsZero();
    inputNonceNotZero.in <== inputNonce;
    inputNonceNotZero.out === 0;
    component inputNote = Poseidon(5);
    inputNote.inputs[0] <== 1014;
    inputNote.inputs[1] <== owner.out;
    inputNote.inputs[2] <== inputAmount;
    inputNote.inputs[3] <== inputNonce;
    inputNote.inputs[4] <== inputCiphertextHash;

    component depthBits = Num2Bits(6);
    depthBits.in <== noteDepth;
    component depthOk = LessEqThan(6);
    depthOk.in[0] <== noteDepth;
    depthOk.in[1] <== 32;
    depthOk.out === 1;
    component membership = BinaryMerkleRoot(32);
    membership.leaf <== inputNote.out;
    membership.depth <== noteDepth;
    membership.index <== noteIndex;
    membership.siblings <== noteSiblings;
    membership.out === inputRoot;

    component spend = Poseidon(3);
    spend.inputs[0] <== 1016;
    spend.inputs[1] <== ownerSecret;
    spend.inputs[2] <== inputNote.out;
    spend.out === inputNullifiers[0];
    component dummySpend = Poseidon(3);
    dummySpend.inputs[0] <== 1021;
    dummySpend.inputs[1] <== ownerSecret;
    dummySpend.inputs[2] <== inputNote.out;
    dummySpend.out === inputNullifiers[1];

    component changeBits = Num2Bits(128);
    changeBits.in <== changeAmount;
    inputAmount === amount + changeAmount;
    component changeNonceNotZero = IsZero();
    changeNonceNotZero.in <== changeNonce;
    changeNonceNotZero.out === 0;
    component dummyNonceNotZero = IsZero();
    dummyNonceNotZero.in <== dummyNonce;
    dummyNonceNotZero.out === 0;

    component changeNote = Poseidon(5);
    changeNote.inputs[0] <== 1014;
    changeNote.inputs[1] <== owner.out;
    changeNote.inputs[2] <== changeAmount;
    changeNote.inputs[3] <== changeNonce;
    changeNote.inputs[4] <== ciphertextHashes[0];
    changeNote.out === outputCommitments[0];
    component dummyNote = Poseidon(5);
    dummyNote.inputs[0] <== 1014;
    dummyNote.inputs[1] <== owner.out;
    dummyNote.inputs[2] <== 0;
    dummyNote.inputs[3] <== dummyNonce;
    dummyNote.inputs[4] <== ciphertextHashes[1];
    dummyNote.out === outputCommitments[1];
}

component main {
    public [
        chainId,
        pool,
        inputShardId,
        inputRoot,
        inputNullifiers,
        outputCommitments,
        ciphertextHashes,
        amount,
        recipient
    ]
} = ShieldedUnshield();

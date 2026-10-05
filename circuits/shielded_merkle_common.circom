pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "@zk-kit/binary-merkle-root.circom/src/binary-merkle-root.circom";

// Compact LeanIMT roots depend only on the first depth path steps.
// BinaryMerkleRoot returns zero above MAX_DEPTH, so these bounds must remain
// unconditional even when callers gate root equality. The library bounds index.
// Note shards support depth 32; endorsement and trusted trees support 64.
template ShieldedMerkleRoot(MAX_DEPTH) {
    assert(MAX_DEPTH == 32 || MAX_DEPTH == 64);
    var DEPTH_BITS = 6;
    if (MAX_DEPTH == 64) DEPTH_BITS = 7;

    signal input leaf;
    signal input depth;
    signal input index;
    signal input siblings[MAX_DEPTH];
    signal output out;

    component depthBits = Num2Bits(DEPTH_BITS);
    depthBits.in <== depth;
    component depthOk = LessEqThan(DEPTH_BITS);
    depthOk.in[0] <== depth;
    depthOk.in[1] <== MAX_DEPTH;
    depthOk.out === 1;

    component merkle = BinaryMerkleRoot(MAX_DEPTH);
    merkle.leaf <== leaf;
    merkle.depth <== depth;
    merkle.index <== index;
    merkle.siblings <== siblings;
    out <== merkle.out;
}

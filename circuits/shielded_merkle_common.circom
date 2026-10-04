pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Compact LeanIMT roots depend only on the first depth path steps.
// Bounds remain unconditional even when callers gate root equality.
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

    component indexBits = Num2Bits(MAX_DEPTH);
    indexBits.in <== index;

    signal nodes[MAX_DEPTH + 1];
    signal swapDelta[MAX_DEPTH];
    component hashes[MAX_DEPTH];
    nodes[0] <== leaf;
    for (var i = 0; i < MAX_DEPTH; i++) {
        // Bit 0 hashes (node, sibling); bit 1 hashes (sibling, node).
        swapDelta[i] <== indexBits.out[i] * (siblings[i] - nodes[i]);
        hashes[i] = Poseidon(2);
        hashes[i].inputs[0] <== nodes[i] + swapDelta[i];
        hashes[i].inputs[1] <== siblings[i] - swapDelta[i];
        nodes[i + 1] <== hashes[i].out;
    }

    // MAX_DEPTH is a power of two: low bits select nodes[0..MAX_DEPTH-1].
    // depth <= MAX_DEPTH makes a set high bit denote exactly nodes[MAX_DEPTH].
    signal choices[2 * MAX_DEPTH - 1];
    for (var i = 0; i < MAX_DEPTH; i++) choices[i] <== nodes[i];
    var inputOffset = 0; // Start of the current mux layer.
    var outputOffset = MAX_DEPTH; // Start of the next layer, after all leaves.
    var width = MAX_DEPTH;
    for (var bit = 0; bit < DEPTH_BITS - 1; bit++) {
        for (var i = 0; i < width / 2; i++) {
            choices[outputOffset + i] <== choices[inputOffset + 2 * i]
                + depthBits.out[bit] * (choices[inputOffset + 2 * i + 1] - choices[inputOffset + 2 * i]);
        }
        inputOffset = outputOffset;
        outputOffset += width / 2;
        width /= 2;
    }
    out <== choices[2 * MAX_DEPTH - 2]
        + depthBits.out[DEPTH_BITS - 1] * (nodes[MAX_DEPTH] - choices[2 * MAX_DEPTH - 2]);
}

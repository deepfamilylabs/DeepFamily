pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Pool-local hashes derive their domain from the real public chain and pool.
// Identity, lineage, receive-code keys and Merkle node hashing remain global.
template ShieldedPoolDomain() {
    signal input chainId;
    signal input pool;
    signal output domain;

    component chainBits = Num2Bits(64);
    chainBits.in <== chainId;
    component poolBits = Num2Bits(160);
    poolBits.in <== pool;
    component chainNotZero = IsZero();
    chainNotZero.in <== chainId;
    chainNotZero.out === 0;
    component poolNotZero = IsZero();
    poolNotZero.in <== pool;
    poolNotZero.out === 0;

    component scope = Poseidon(3);
    scope.inputs[0] <== 1031;
    scope.inputs[1] <== chainId;
    scope.inputs[2] <== pool;
    domain <== scope.out;
}

// Internal helper: the enclosing asset action must constrain poolDomain once
// with ShieldedPoolDomain using its public chainId and pool inputs.
template ShieldedScopedTag() {
    signal input poolDomain;
    signal input purpose;
    signal output tag;
    component purposeTag = Poseidon(3);
    purposeTag.inputs[0] <== 1032;
    purposeTag.inputs[1] <== poolDomain;
    purposeTag.inputs[2] <== purpose;
    tag <== purposeTag.out;
}

pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Every witness entry is public on the source's append-only revocation log.
// The source authenticates both prefix hashes and requires the cached progress
// to equal start, so no prover may skip, repeat or replace a log interval.
template EligibilityRevocationScan() {
    signal input chainId;
    signal input sourceAddress;
    signal input role;
    signal input nonce;
    signal input tag;
    signal input start;
    signal input end;
    signal input startHash;
    signal input endHash;
    signal input secrets[32];

    component chainBits = Num2Bits(64);
    chainBits.in <== chainId;
    component sourceBits = Num2Bits(160);
    sourceBits.in <== sourceAddress;
    component startBits = Num2Bits(64);
    startBits.in <== start;
    component endBits = Num2Bits(64);
    endBits.in <== end;
    component roleBits = Num2Bits(2);
    roleBits.in <== role;
    component roleAllowed = LessThan(2);
    roleAllowed.in[0] <== role;
    roleAllowed.in[1] <== 3;
    roleAllowed.out === 1;
    component beforeEnd = LessThan(64);
    beforeEnd.in[0] <== start;
    beforeEnd.in[1] <== end;
    beforeEnd.out === 1;
    signal count <== end - start;
    component countBits = Num2Bits(6);
    countBits.in <== count;
    component batchFits = LessEqThan(6);
    batchFits.in[0] <== count;
    batchFits.in[1] <== 32;
    batchFits.out === 1;

    component nonzero[4];
    nonzero[0] = IsZero(); nonzero[0].in <== chainId;
    nonzero[1] = IsZero(); nonzero[1].in <== sourceAddress;
    nonzero[2] = IsZero(); nonzero[2].in <== nonce;
    nonzero[3] = IsZero(); nonzero[3].in <== tag;
    for (var i = 0; i < 4; i++) nonzero[i].out === 0;

    component genesis = Poseidon(3);
    genesis.inputs[0] <== 74300 + role;
    genesis.inputs[1] <== chainId;
    genesis.inputs[2] <== sourceAddress;
    component first = IsZero();
    first.in <== start;
    first.out * (startHash - genesis.out) === 0;

    signal hashes[33];
    hashes[0] <== startHash;
    component enabled[32];
    component secretZero[32];
    component roleTag[32];
    component match[32];
    component append[32];
    for (var i = 0; i < 32; i++) {
        enabled[i] = LessThan(6);
        enabled[i].in[0] <== i;
        enabled[i].in[1] <== count;
        (1 - enabled[i].out) * secrets[i] === 0;
        secretZero[i] = IsZero();
        secretZero[i].in <== secrets[i];
        enabled[i].out * secretZero[i].out === 0;
        roleTag[i] = Poseidon(3);
        roleTag[i].inputs[0] <== 73301 + role;
        roleTag[i].inputs[1] <== secrets[i];
        roleTag[i].inputs[2] <== nonce;
        match[i] = IsEqual();
        match[i].in[0] <== roleTag[i].out;
        match[i].in[1] <== tag;
        enabled[i].out * match[i].out === 0;
        append[i] = Poseidon(3);
        append[i].inputs[0] <== 74310 + role;
        append[i].inputs[1] <== hashes[i];
        append[i].inputs[2] <== secrets[i];
        hashes[i + 1] <== hashes[i] + enabled[i].out * (append[i].out - hashes[i]);
    }
    hashes[32] === endHash;
}

component main { public [chainId,sourceAddress,role,nonce,tag,start,end,startHash,endHash] } = EligibilityRevocationScan();

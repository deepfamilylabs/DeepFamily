pragma circom 2.1.6;

include "circomlib/circuits/bitify.circom";       // Num2Bits
include "circomlib/circuits/comparators.circom";  // LessThan
include "circomlib/circuits/keccak.circom";       // Keccak256(N)

template Keccak256Var(N) {
    signal input in[N];   // bytes (0..255)
    signal input len;     // actual absorption length (0..N)
    signal output out[32];

    // len range check
    component lenBits = Num2Bits(32);
    lenBits.in <== len;

    component leN = LessThan(32);
    leN.in[0] <== len;
    leN.in[1] <== N + 1;      // len <= N
    leN.out == 1;

    // each in[i] must be a byte
    component b[N];
    for (var i = 0; i < N; i++) {
        b[i] = Num2Bits(8);
        b[i].in <== in[i];
    }

    // call Keccak, only absorb the first len bytes
    component k = Keccak256(N);   // if your library uses Keccak256Bytes(N), change to corresponding name
    for (var j = 0; j < N; j++) {
        k.in[j] <== in[j];
    }
    k.len <== len;

    for (var o = 0; o < 32; o++) {
        out[o] <== k.out[o];
    }
}

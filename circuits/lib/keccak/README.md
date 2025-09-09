# Keccak Vendor Guide

This directory is used to place Keccak constraint circuit implementations for reference by `circuits/person_hash_keccak.circom`.

## Expected Interface
Please provide `Keccak256.circom` and expose template:
```circom
// bytes input, supports variable length (msgLen specifies effective length)
template Keccak256Var(MAX_LEN) {
    signal input in[MAX_LEN];   // each byte 0..255
    signal input msgLen;        // effective byte length, 0 <= msgLen <= MAX_LEN
    signal output out[32];      // keccak256 output, 32 bytes (big-endian)
}
```

## Sources and Adaptation
- Can use community implementations (like zk‑kit keccak256 circuits). If interface differs, please write a wrapper template to adapt it to the above signature.
- Can also implement based on circomlib's keccak primitives:
  - Note that circomlib's Keccak interface usually takes bit stream/bit-packed format as input;
  - Need to convert bytes to bits, assemble according to correct byte order and padding rules, then output 32 bytes.

## Testing
- Use TypeScript for comparison calculation:
  - `ethers.solidityPackedKeccak256(["bytes"], [Uint8Array(...)])`
  - Or `keccak256(toUtf8Bytes(str))` for name-only cases.
- Verify circuit output `out[0..31]` matches JS results byte by byte.

# Circuits

This directory contains a single circuit:
- `person_hash_keccak.circom`: Keccak constraint integrated version, directly takes raw fields (name, etc.) as input, performs contract serialization and keccak256 computation internally, then outputs 16×64-bit limbs + submitter (aligned with contract `publicSignals`).

## Goals and Mapping
- publicSignals order (consistent with `contracts/DeepFamily.sol`):
  - 0..3: personHash limbs (high→low, 64 bits each)
  - 4..7: nameHash limbs
  - 8..11: fatherHash limbs
  - 12..15: motherHash limbs
  - 16: submitter (only low 160 bits valid; on-chain constrains msg.sender)

## Serialization and Hashing
- personHash computation in contract:
  - `keccak256(uint16(nameBytes.length) || nameBytes || uint8(isBirthBC) || uint16(birthYear) || uint8(birthMonth) || uint8(birthDay) || uint8(gender))`
- nameHash is `keccak256(fullName)`.
- Basic version does not embed Keccak; Keccak version includes the above two keccak computations.

## Dependencies
- circom 2.1+, snarkjs
- circomlib (uses bitify's Num2Bits for range checking)

## Build
First vendor Keccak sub-circuits to `circuits/lib/keccak/` (see Vendor instructions below), then compile:
```bash
circom circuits/person_hash_keccak.circom --r1cs --wasm --sym -o artifacts/circuits
snarkjs groth16 setup artifacts/circuits/person_hash_keccak.r1cs path/to/potxx_final.ptau artifacts/circuits/person_hash_keccak_0000.zkey
snarkjs zkey contribute artifacts/circuits/person_hash_keccak_0000.zkey artifacts/circuits/person_hash_keccak_final.zkey --name "contrib" -v
snarkjs zkey export solidityverifier artifacts/circuits/person_hash_keccak_final.zkey contracts/PersonHashVerifier.sol
```

## Generate Proof (Example)
```bash
node artifacts/circuits/person_hash_keccak_js/generate_witness.js \
  artifacts/circuits/person_hash_keccak_js/person_hash_keccak.wasm \
  input.json \
  witness.wtns

snarkjs groth16 prove artifacts/circuits/person_hash_keccak_final.zkey witness.wtns proof.json public.json
```

Keccak version example (input fields):
```json
{
  "nameLen": 12,
  "nameBytes": [78,97,109,101,32,69,120,97,109,112,108,101,0,0, ... zeros to 256],
  "isBirthBC": 0,
  "birthYear": 1990,
  "birthMonth": 5,
  "birthDay": 20,
  "gender": 1,
  "fatherHashBytes": [0,0, ... 32 bytes],
  "motherHashBytes": [0,0, ... 32 bytes],
  "submitter": "12345678901234567890"
}
```
Note: `nameBytes` length is fixed at 256, only the first `nameLen` bytes are valid, the rest must be 0; the circuit dynamically selects the valid range to participate in Keccak based on `nameLen`.

## Notes
- Contract performs `< 2^64` checks on all limbs before going on-chain, and verifies `publicSignals.length == 17`.
- Submitter address is only passed through in circuit, on-chain uses low 160 bits for binding verification with `msg.sender`.
- Keccak version provides serialization logic consistent with `getPersonHash` (byte order and bit width are completely consistent).
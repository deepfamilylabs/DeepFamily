# Circuits (Test Version)

The circuit in this repo is a test-only prototype `person_hash_zk.circom`, which differs from the final on-chain design. Treat this file as the source of truth for the current state.

## Current Implementation
- Main circuit: `person_hash_zk.circom` (component `PersonHashTest`).
- Dependencies:
  - circom 2.1+, snarkjs
  - circomlib: bitify (Num2Bits), comparators (LessThan)
  - Keccak gadget: `circuits/lib/keccak256.circom` (`SimpleKeccak`)
- Fixed name lengths (for testing only):
  - Member nameBytes[5]
  - Father father_nameBytes[3]
  - Mother mother_nameBytes[5]
- Other fields (per person): `isBirthBC` (1 bit), `birthYear` (uint16), `birthMonth` (uint8), `birthDay` (uint8), `gender` (uint8)
- Extra input: `submitter` (passed through; not constrained to 160 bits inside the circuit)

## Serialization and Hashing
- For each person, the personHash preimage is serialized as:
  - `keccak256( uint16(nameLen, BE) || nameBytes || uint8(isBirthBC) || uint16(birthYear, BE) || uint8(birthMonth) || uint8(birthDay) || uint8(gender) )`
- In this test circuit, `nameLen` is constant: member=5, father=3, mother=5; no dynamic `nameLen` or variable-length selection is implemented.
- Constraints:
  - All name bytes are range-checked via `Num2Bits(8)`
  - `isBirthBC` via `Num2Bits(1)`
  - `birthMonth < 13`, `birthDay < 32` via `LessThan`
  - `birthYear` is converted to big-endian using `Uint16ToBytes`

## Public Outputs (publicSignals)
This test version outputs 7 items:
- `person_limb0`, `person_limb1`
- `father_limb0`, `father_limb1`
- `mother_limb0`, `mother_limb1`
- `submitter_out`

Notes:
- Each 32-byte Keccak hash is split into two 128-bit limbs:
  - `limb0` = high 128 bits (bytes[0..15])
  - `limb1` = low 128 bits (bytes[16..31])
- This differs from the final contract mapping (16×64-bit limbs + submitter, total 17 items). Do not map this test circuit directly to on-chain verification.

## Build
```bash
circom circuits/person_hash_zk.circom --r1cs --wasm --sym -o artifacts/circuits
snarkjs groth16 setup artifacts/circuits/person_hash_zk.r1cs path/to/potxx_final.ptau artifacts/circuits/person_hash_zk_0000.zkey
snarkjs zkey contribute artifacts/circuits/person_hash_zk_0000.zkey artifacts/circuits/person_hash_zk_final.zkey --name "contrib" -v
snarkjs zkey export solidityverifier artifacts/circuits/person_hash_zk_final.zkey contracts/PersonHashVerifier.sol
```

## Generate Proof (Example)
```bash
node artifacts/circuits/person_hash_zk_js/generate_witness.js \
  artifacts/circuits/person_hash_zk_js/person_hash_zk.wasm \
  input.json \
  witness.wtns

snarkjs groth16 prove artifacts/circuits/person_hash_zk_final.zkey witness.wtns proof.json public.json
```

## Input Example (Test Version)
```json
{
  "nameBytes": [65,108,105,99,101],
  "isBirthBC": 0,
  "birthYear": 1990,
  "birthMonth": 5,
  "birthDay": 20,
  "gender": 1,

  "father_nameBytes": [66,111,98],
  "father_isBirthBC": 0,
  "father_birthYear": 1960,
  "father_birthMonth": 6,
  "father_birthDay": 10,
  "father_gender": 1,

  "mother_nameBytes": [67,97,114,111,108],
  "mother_isBirthBC": 0,
  "mother_birthYear": 1962,
  "mother_birthMonth": 7,
  "mother_birthDay": 12,
  "mother_gender": 0,

  "submitter": "12345678901234567890"
}
```

## Limitations and Roadmap
- Prototype only: fixed name lengths (5/3/5); no variable-length names or zero-padding checks; no nameHash output; no 160-bit address truncation.
- Not aligned with the final on-chain mapping in `DeepFamily.sol` (16×64-bit limbs + submitter, 17 items). Do not use this test circuit directly for on-chain verification.
- Next steps:
  - Introduce variable `nameLen` with zero-padding and unified serialization
  - Expand outputs to the 16×64-bit limbs layout and ordering
  - Match the contract `getPersonHash` byte order and bit widths exactly
  - Strengthen range checks
```
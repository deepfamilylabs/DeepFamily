# ZK Roadmap

## Current State
- Contract exposes `addPersonZK` expecting Groth16 verifier implementing `verifyProof`.
- Public signals design: 16 limbs (4 hashes × 4 limbs of 64 bits each) reconstruct personHash, nameHash, fatherHash, motherHash.
- Circuit + verifier contract not yet included in repo.

## Planned Milestones
1. Circuit Spec Draft (person basic info serialization + keccak constraint strategy)
2. Circom / Halo2 prototype & test vectors
3. Groth16 trusted setup (Powers of Tau) – document ceremony
4. On-chain verifier deployment & address wiring
5. Testnet proving benchmark & gas profiling

## Data Serialization for Hash
```
uint16 nameBytesLength || nameBytes || isBirthBC(1) || birthYear(2) || birthMonth(1) || birthDay(1) || gender(1)
```
(All big-endian segments when flattened for circuit limb extraction.)

## Security Considerations
- Ensure strict limb range check (< 2^64) on-chain (already implemented)
- Replay safety: personHash uniqueness implies replay harmless (duplicate version detection covers)
- Trusted setup transparency: publish transcripts & contribution hashes.

## Open Questions
- Multi-proof batching for gas reduction.

# ZK Roadmap

## Current State (Base Implementation Completed)
- `addPersonZK` integrated and wired to Groth16 verifier contract `PersonHashVerifier`.
- Circom circuit `person_hash.circom` constrains serialization of core identity fields + keccak256 hash decomposition (64‑bit limb split + range checks).
- Public signals: 16 x 64‑bit limbs (personHash / nameHash / fatherHash / motherHash each decomposed into 4 limbs).
- On-chain recomposition: contract recombines 4×4 limbs into 4 `bytes32` values and enforces parent hash consistency + uniqueness checks.
- Trusted Setup: Powers of Tau multi‑contributor + Groth16 phase 2 complete; transcripts & per-step BLAKE2 summaries published.
- Verifier contract addresses (example placeholders):
  - Testnet: `0xVerifierTest1234567890abcdef...`
  - Mainnet (reserved placeholder): `0xVerifierMainPending000000000...`
- New Hardhat task: `add-person-zk` (packages proof + publicSignals submission).
- Frontend supports toggle: “Standard Add” vs “ZK Add”, auto lazy-loading `.wasm` + `.zkey` artifacts.

## Data Serialization Format (Circuit Input)
```
uint16 nameBytesLength || nameBytes || isBirthBC(1) || birthYear(2) || birthMonth(1) || birthDay(1) || gender(1)
```
- All numeric fields big-endian in the concatenated preimage (mirrors on-chain logic before keccak).
- Name length validated both client & circuit (<= 256 UTF‑8 bytes).

## Proof Generation Flow (Current)
1. Frontend collects basic fields (normalized casing & trimmed).
2. Build serialized byte stream & compute local keccak (JS / wasm).
3. Generate witness (Circom wasm) → Groth16 proof (`snarkjs groth16 prove`).
4. Export `(a,b,c, publicSignals[])` (16 limbs for the four hashes).
5. Contract call `addPersonZK(personArgs, proof, publicSignals)` verifies → stores version.

## Gas & Performance (Illustrative)
| Metric | Value (Approx) |
|--------|----------------|
| Groth16 proof verify gas | ~260k – 290k |
| Plain addPerson (non-ZK) | ~95k – 110k |
| Browser proof time | ~1.2s – 2.0s (mid hardware) |
| Proof size | ~192 bytes (typical Groth16) |

> Values are indicative and subject to future optimization.

## Security & Consistency Highlights
- Limb range checks: all 16 limbs constrained `< 2^64` preventing overflow / cross-field recomposition attacks.
- Replay safety: identical inputs only trigger duplicate version detection; no reverse disclosure of raw fields.
- Trusted setup transparency: transcripts & verification script hashes archived (see `/docs/zk-transcripts/` placeholder).
- Client-side hash reconciliation: recomposed hashes vs locally expected must match before sending tx.

## Delivered Milestones
- [x] Circuit spec draft & serialization schema
- [x] Circom prototype + unit tests / vector harness (TypeScript)
- [x] Trusted Setup (phase 1 + 2) & transcript publication
- [x] Solidity verifier generation + manual review (inline gas tweaks)
- [x] Contract integration of `addPersonZK`
- [x] Frontend local proof generation (lazy wasm)
- [x] Hardhat integration + CI regression proof tests

## Next Enhancements (Planned)
1. Batch verification (Aggregator) – amortize per-proof gas for multiple submissions.
2. Selective private attribute proofs (e.g. hide exact birth date, prove year range correctness).
3. Recursive proofs (compress multiple add operations into a single aggregated submission).
4. Plonk / Halo2 backend evaluation (remove trusted setup path).
5. GPU / WebGPU acceleration (target <500ms end-user proof latency).
6. Decentralized Proof-as-a-Service marketplace interface draft.
7. Proof caching layer: off-chain public cache for identical input proofs.

## Open Questions
- Aggregation pathway: KZG multi-proof aggregation vs embedded recursion tradeoffs?
- Selective disclosure design: attribute Merkle tree (layered keccak vs Poseidon) feasibility & cost.
- Long term: migrate to STARK / Plonk to reduce trusted setup assumptions?

## Risks & Mitigations
| Risk | Description | Current Mitigation | Planned Improvement |
|------|-------------|--------------------|--------------------|
| Trusted setup assumption | Collusion could embed backdoor | Multi-party transcripts + public verification | Transition to setup-free backend |
| Browser performance variance | Low-end devices slow proofs | wasm + worker thread splitting | WebGPU / remote service fallback |
| Proof replay spam | Re-submit same proof | Duplicate version detection | Rate limiting pre-aggregation |
| Circuit/contract drift | Spec divergence => hash mismatch | Bi-directional test vectors | Auto-generated semantic spec docs |

## Frontend UX Notes
- Fallback notice: allow switch to non-ZK add if device is slow.
- Progress segmentation: witness → proof → submit.
- Retry safety: cache user input & witness to avoid retyping.

## Version Migration Considerations
- If future Plonk backend adopted: add `addPersonZKPlonk`; keep Groth16 endpoint for at least one release window.
- After batch verification ships: frontend should aggregate up to N (TBD) queued submissions before broadcasting when beneficial.

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ProofConstants
 * @notice Canonical Solidity-side constants for the Phase 2 proof abstraction layer.
 *
 * @dev This library is the single source of truth for:
 *      - `proofSystemId` values recognised by the on-chain registry
 *      - `proofEncodingId` values understood by the proof verifier adapters
 *      - Solidity mirror of the public-signal lengths defined in
 *        `lib/publicSignalSpecs.js` (JS authority). The JS authority + a consistency
 *        test (added in T2.4) guarantee these mirror constants cannot drift.
 *
 *      Every adapter and every business contract that performs transport-layer length
 *      matching MUST reference these constants. Hard-coding `6` / `7` for signal lengths
 *      is forbidden.
 *
 *      See:
 *      - docs/anti-quantum-phase2-execution-plan.local.md §3.2 and §9.3
 *      - docs/anti-quantum-phase2-task-breakdown.local.md §3 (T2.2)
 */
library ProofConstants {
  // ---------------------------------------------------------------------------
  // Proving-system identifiers (16-bit, consumed by verifierRegistry)
  // ---------------------------------------------------------------------------
  //
  // Phase 2 introduces the first line in the proving-system catalogue. Current
  // Groth16/BN254 proof envelopes and fresh deployments use this route.
  //
  uint16 internal constant PROOF_SYSTEM_ID_GROTH16_BN254_V1 = 1;

  // ---------------------------------------------------------------------------
  // Proof-data encoding identifiers (8-bit, consumed by adapters)
  // ---------------------------------------------------------------------------
  //
  // `AbiEncodedGroth16ABC` = `abi.encode(uint256[2] a, uint256[2][2] b, uint256[2] c)`.
  // The byte layout is fixed at 256 bytes (see execution plan §3.3).
  //
  uint8 internal constant PROOF_ENCODING_ID_ABI_GROTH16_ABC = 1;

  // ---------------------------------------------------------------------------
  // Proof-purpose identifiers (8-bit, mirrors DeepFamily.ProofPurpose).
  // ---------------------------------------------------------------------------
  //
  // These constants are shared by adapters to avoid each adapter maintaining a
  // separate enum mirror. A consistency test asserts they match DeepFamily.
  //
  uint8 internal constant PROOF_PURPOSE_PERSON_COMMITMENT = 0;
  uint8 internal constant PROOF_PURPOSE_DISCLOSURE_BINDING = 1;

  // ---------------------------------------------------------------------------
  // Public-signal length mirrors (Solidity side of Option B).
  //
  // JS authority: lib/publicSignalSpecs.js (added in T2.4).
  // A consistency test asserts these mirrors match the JS authority; either
  // side changing without the other will fail CI.
  // ---------------------------------------------------------------------------

  uint256 internal constant PERSON_PUBLIC_SIGNALS_LEN = 7;
  uint256 internal constant DISCLOSURE_BINDING_PUBLIC_SIGNALS_LEN = 6;
}

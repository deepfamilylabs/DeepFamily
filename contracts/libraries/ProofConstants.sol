// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ProofConstants
 * @notice Canonical Solidity-side constants for proof transport and frozen entrypoint ABIs.
 *
 * @dev This library is the single source of truth for:
 *      - `proofEncodingId` values understood by the proof verifier adapters
 *      - Solidity mirror of the public-signal lengths defined in
 *        `lib/publicSignalSpecs.js` (JS authority). The JS authority + a consistency
 *        test (added in T2.4) guarantee these mirror constants cannot drift.
 *
 *      Every adapter and every business contract that performs transport-layer length
 *      matching MUST reference these constants. Hard-coding signal lengths
 *      is forbidden.
 */
library ProofConstants {
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
  uint8 internal constant PROOF_PURPOSE_PERSON_RELATION = 0;
  uint8 internal constant PROOF_PURPOSE_DISCLOSURE_BINDING = 1;

  // ---------------------------------------------------------------------------
  // Public-signal length mirrors (Solidity side of Option B).
  //
  // JS authority: lib/publicSignalSpecs.js (added in T2.4).
  // A consistency test asserts these mirrors match the JS authority; either
  // side changing without the other will fail CI.
  // ---------------------------------------------------------------------------

  uint256 internal constant PERSON_RELATION_PUBLIC_SIGNALS_LEN = 5;
  uint256 internal constant DISCLOSURE_BINDING_PUBLIC_SIGNALS_LEN = 4;
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ProofConstants
 * @notice Canonical Solidity-side constants for proof transport and verifier routes.
 *
 * @dev This library is the single source of truth for:
 *      - `proofEncodingId` values understood by the proof verifier adapters
 *      - Solidity mirrors of the public-signal shapes in
 *        `packages/proof-core/publicSignalSpecs.js` (identity/disclosure) and
 *        `packages/protocol-core/shielded-signals.js` (pool actions).
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
  // The byte layout is fixed at 256 bytes.
  //
  uint8 internal constant PROOF_ENCODING_ID_ABI_GROTH16_ABC = 1;

  // ---------------------------------------------------------------------------
  // Proof-purpose identifiers shared by all Groth16 business entrypoints.
  // ---------------------------------------------------------------------------
  //
  // The first two constants mirror DeepFamily.ProofPurpose. Pool actions use distinct
  // routes, so a pool action cannot select an identity or disclosure verifier even when
  // their local enum values are the same.
  //
  uint8 internal constant PROOF_PURPOSE_PERSON_RELATION = 0;
  uint8 internal constant PROOF_PURPOSE_DISCLOSURE_BINDING = 1;
  uint8 internal constant PROOF_PURPOSE_SHIELDED_ACTION_BASE = 2;
  uint8 internal constant PROOF_PURPOSE_SHIELDED_SHIELD = PROOF_PURPOSE_SHIELDED_ACTION_BASE;
  uint8 internal constant PROOF_PURPOSE_SHIELDED_FUND =
    PROOF_PURPOSE_SHIELDED_ACTION_BASE + 1;
  uint8 internal constant PROOF_PURPOSE_SHIELDED_CLAIM = PROOF_PURPOSE_SHIELDED_ACTION_BASE + 2;
  uint8 internal constant PROOF_PURPOSE_SHIELDED_PRIVATE_TRANSFER =
    PROOF_PURPOSE_SHIELDED_ACTION_BASE + 3;
  uint8 internal constant PROOF_PURPOSE_SHIELDED_UNSHIELD = PROOF_PURPOSE_SHIELDED_ACTION_BASE + 4;

  // ---------------------------------------------------------------------------
  // Public-signal length mirrors.
  //
  // JS signal builders/specs live in packages/proof-core/publicSignalSpecs.js and
  // packages/protocol-core/shielded-signals.js. Transport length checks use these
  // constants; fixed-array declarations preserve each generated verifier's ABI.
  // ---------------------------------------------------------------------------

  uint256 internal constant PERSON_RELATION_PUBLIC_SIGNALS_LEN = 5;
  uint256 internal constant DISCLOSURE_BINDING_PUBLIC_SIGNALS_LEN = 4;

  // Each pool action proves only the inputs it uses, in ShieldedDeepPool._publicSignals order.
  uint256 internal constant SHIELDED_SHIELD_PUBLIC_SIGNALS_LEN = 7;
  uint256 internal constant SHIELDED_FUND_PUBLIC_SIGNALS_LEN = 16;
  uint256 internal constant SHIELDED_CLAIM_PUBLIC_SIGNALS_LEN = 27;
  uint256 internal constant SHIELDED_PRIVATE_TRANSFER_PUBLIC_SIGNALS_LEN = 12;
  uint256 internal constant SHIELDED_UNSHIELD_PUBLIC_SIGNALS_LEN = 12;
}

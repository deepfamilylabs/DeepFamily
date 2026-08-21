// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IProofVerifierAdapter} from "../interfaces/IProofVerifierAdapter.sol";
import {ProofConstants} from "../libraries/ProofConstants.sol";

/**
 * @dev Minimal Groth16/BN254 verifier interface for the person-relation circuit
 *      (5 public signals).
 */
interface IGroth16PersonRelationVerifier {
  function verifyProof(
    uint256[2] calldata a,
    uint256[2][2] calldata b,
    uint256[2] calldata c,
    uint256[5] calldata publicSignals
  ) external view returns (bool);
}

/**
 * @dev Minimal Groth16/BN254 verifier interface for the disclosure-binding circuit
 *      (4 public signals).
 */
interface IGroth16DisclosureBindingVerifier {
  function verifyProof(
    uint256[2] calldata a,
    uint256[2][2] calldata b,
    uint256[2] calldata c,
    uint256[4] calldata publicSignals
  ) external view returns (bool);
}

/**
 * @title Groth16VerifierAdapter
 * @notice Transport-layer adapter between DeepFamily's business entrypoints and the
 *         two v1 Groth16 verifier contracts.
 *
 *         A DeepFamily `(purpose, circuitId)` route selects this adapter. The adapter then
 *         validates the proof encoding and forwards to the purpose-specific verifier.
 */
contract Groth16VerifierAdapter is IProofVerifierAdapter {
  error UnsupportedProofEncoding();
  error MalformedProofData();
  error UnsupportedPurpose();

  // 256 bytes = 32 * (2 + 4 + 2) for abi.encode(uint256[2], uint256[2][2], uint256[2]).
  uint256 internal constant GROTH16_ABC_PAYLOAD_LENGTH = 256;

  address public immutable personVerifier;
  address public immutable disclosureBindingVerifier;

  constructor(address _personVerifier, address _disclosureBindingVerifier) {
    personVerifier = _personVerifier;
    disclosureBindingVerifier = _disclosureBindingVerifier;
  }

  /**
   * @inheritdoc IProofVerifierAdapter
   *
   * @dev Transport-layer contract:
   *      - `UnsupportedProofEncoding` — `proofEncodingId` is not
   *        `PROOF_ENCODING_ID_ABI_GROTH16_ABC`.
   *      - `MalformedProofData` — `proofData` is not exactly 256 bytes, or
   *        `publicSignals.length` does not match the purpose-specific constant.
   *      - `UnsupportedPurpose` — `purpose` is neither `PersonRelation` nor `DisclosureBinding`.
   *      - `false` — proof cryptographically rejected by the underlying Groth16 verifier.
   */
  function verifyProof(
    uint8 purpose,
    uint8 proofEncodingId,
    bytes calldata proofData,
    uint256[] calldata publicSignals
  ) external view override returns (bool ok) {
    if (proofEncodingId != ProofConstants.PROOF_ENCODING_ID_ABI_GROTH16_ABC) {
      revert UnsupportedProofEncoding();
    }
    if (proofData.length != GROTH16_ABC_PAYLOAD_LENGTH) {
      revert MalformedProofData();
    }

    (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = abi.decode(
      proofData,
      (uint256[2], uint256[2][2], uint256[2])
    );

    if (purpose == ProofConstants.PROOF_PURPOSE_PERSON_RELATION) {
      if (publicSignals.length != ProofConstants.PERSON_RELATION_PUBLIC_SIGNALS_LEN) {
        revert MalformedProofData();
      }
      uint256[5] memory buf;
      for (uint256 i = 0; i < ProofConstants.PERSON_RELATION_PUBLIC_SIGNALS_LEN; ++i) {
        buf[i] = publicSignals[i];
      }
      return IGroth16PersonRelationVerifier(personVerifier).verifyProof(a, b, c, buf);
    }

    if (purpose == ProofConstants.PROOF_PURPOSE_DISCLOSURE_BINDING) {
      if (publicSignals.length != ProofConstants.DISCLOSURE_BINDING_PUBLIC_SIGNALS_LEN) {
        revert MalformedProofData();
      }
      uint256[4] memory buf;
      for (uint256 i = 0; i < ProofConstants.DISCLOSURE_BINDING_PUBLIC_SIGNALS_LEN; ++i) {
        buf[i] = publicSignals[i];
      }
      return IGroth16DisclosureBindingVerifier(disclosureBindingVerifier).verifyProof(a, b, c, buf);
    }

    revert UnsupportedPurpose();
  }
}

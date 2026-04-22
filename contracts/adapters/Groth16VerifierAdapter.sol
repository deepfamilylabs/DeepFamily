// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IProofVerifierAdapter} from "../interfaces/IProofVerifierAdapter.sol";
import {ProofConstants} from "../libraries/ProofConstants.sol";

/**
 * @dev Minimal Groth16/BN254 verifier interface for the person-commitment circuit
 *      (7 public signals). Matches the existing PersonCommitmentVerifier output.
 */
interface IGroth16PersonVerifier {
  function verifyProof(
    uint256[2] calldata a,
    uint256[2][2] calldata b,
    uint256[2] calldata c,
    uint256[7] calldata publicSignals
  ) external view returns (bool);
}

/**
 * @dev Minimal Groth16/BN254 verifier interface for the disclosure-binding circuit
 *      (6 public signals). Matches the existing DisclosureBindingVerifier output.
 */
interface IGroth16DisclosureBindingVerifier {
  function verifyProof(
    uint256[2] calldata a,
    uint256[2][2] calldata b,
    uint256[2] calldata c,
    uint256[6] calldata publicSignals
  ) external view returns (bool);
}

/**
 * @title Groth16VerifierAdapter
 * @notice Transport-layer adapter between DeepFamily's business entrypoints and the
 *         two existing Groth16 verifier contracts.
 *
 *         Registered under `PROOF_SYSTEM_ID_GROTH16_BN254_V1` for both purposes
 *         (`PersonCommitment` and `DisclosureBinding`). Routes internally to the correct
 *         backend verifier based on `purpose`.
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
   *      - `UnsupportedPurpose` — `purpose` is neither `PersonCommitment` nor `DisclosureBinding`.
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

    if (purpose == ProofConstants.PROOF_PURPOSE_PERSON_COMMITMENT) {
      if (publicSignals.length != ProofConstants.PERSON_PUBLIC_SIGNALS_LEN) {
        revert MalformedProofData();
      }
      uint256[7] memory buf;
      for (uint256 i = 0; i < ProofConstants.PERSON_PUBLIC_SIGNALS_LEN; ++i) {
        buf[i] = publicSignals[i];
      }
      return IGroth16PersonVerifier(personVerifier).verifyProof(a, b, c, buf);
    }

    if (purpose == ProofConstants.PROOF_PURPOSE_DISCLOSURE_BINDING) {
      if (publicSignals.length != ProofConstants.DISCLOSURE_BINDING_PUBLIC_SIGNALS_LEN) {
        revert MalformedProofData();
      }
      uint256[6] memory buf;
      for (uint256 i = 0; i < ProofConstants.DISCLOSURE_BINDING_PUBLIC_SIGNALS_LEN; ++i) {
        buf[i] = publicSignals[i];
      }
      return IGroth16DisclosureBindingVerifier(disclosureBindingVerifier).verifyProof(a, b, c, buf);
    }

    revert UnsupportedPurpose();
  }
}

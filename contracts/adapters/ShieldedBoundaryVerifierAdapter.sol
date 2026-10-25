// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IProofVerifierAdapter} from "../interfaces/IProofVerifierAdapter.sol";
import {ProofConstants} from "../libraries/ProofConstants.sol";

interface IShieldedBoundaryVerifier7 {
  function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b,
    uint256[2] calldata c, uint256[7] calldata publicSignals) external view returns (bool);
}
interface IShieldedBoundaryVerifier11 {
  function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b,
    uint256[2] calldata c, uint256[11] calldata publicSignals) external view returns (bool);
}
interface IShieldedBoundaryVerifier20 {
  function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b,
    uint256[2] calldata c, uint256[20] calldata publicSignals) external view returns (bool);
}

/// @notice Fixed VALUE deposit/withdrawal routes, independent of receive eligibility.
/// @dev The budget deposit, Claim and Transfer relations have separate immutable
///      verifiers on the pool and cannot be selected through this adapter.
contract ShieldedBoundaryVerifierAdapter is IProofVerifierAdapter {
  error InvalidVerifier();
  error UnsupportedPurpose();
  error UnsupportedProofEncoding();
  error MalformedProofData();

  address public immutable shieldVerifier;
  address public immutable unshieldVerifier;
  address public immutable unshield4Verifier;

  constructor(address shield, address unshield, address unshield4) {
    if (shield.code.length == 0 || unshield.code.length == 0 || unshield4.code.length == 0) {
      revert InvalidVerifier();
    }
    shieldVerifier = shield;
    unshieldVerifier = unshield;
    unshield4Verifier = unshield4;
  }

  function verifierForPurpose(uint8 purpose) external view returns (address) {
    if (purpose == ProofConstants.PROOF_PURPOSE_SHIELDED_SHIELD) return shieldVerifier;
    if (purpose == ProofConstants.PROOF_PURPOSE_SHIELDED_UNSHIELD) return unshieldVerifier;
    revert UnsupportedPurpose();
  }

  function verifyProof(uint8 purpose, uint8 encoding, bytes calldata proof,
    uint256[] calldata publicSignals) external view returns (bool) {
    if (encoding != ProofConstants.PROOF_ENCODING_ID_ABI_GROTH16_ABC) revert UnsupportedProofEncoding();
    bool isShield = purpose == ProofConstants.PROOF_PURPOSE_SHIELDED_SHIELD;
    if (!isShield && purpose != ProofConstants.PROOF_PURPOSE_SHIELDED_UNSHIELD) revert UnsupportedPurpose();
    uint256 length = publicSignals.length;
    if (proof.length != 256 || (isShield ? length != ProofConstants.SHIELDED_SHIELD_PUBLIC_SIGNALS_LEN
      : (length != ProofConstants.SHIELDED_UNSHIELD_PUBLIC_SIGNALS_LEN &&
        length != ProofConstants.SHIELDED_UNSHIELD_4_PUBLIC_SIGNALS_LEN))) revert MalformedProofData();
    (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) =
      abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));
    if (isShield) {
      uint256[7] memory values7;
      for (uint256 i; i < values7.length; ++i) values7[i] = publicSignals[i];
      return IShieldedBoundaryVerifier7(shieldVerifier).verifyProof(a, b, c, values7);
    }
    if (length == ProofConstants.SHIELDED_UNSHIELD_PUBLIC_SIGNALS_LEN) {
      uint256[11] memory values11;
      for (uint256 i; i < values11.length; ++i) values11[i] = publicSignals[i];
      return IShieldedBoundaryVerifier11(unshieldVerifier).verifyProof(a, b, c, values11);
    }
    uint256[20] memory values20;
    for (uint256 i; i < values20.length; ++i) values20[i] = publicSignals[i];
    return IShieldedBoundaryVerifier20(unshield4Verifier).verifyProof(a, b, c, values20);
  }
}

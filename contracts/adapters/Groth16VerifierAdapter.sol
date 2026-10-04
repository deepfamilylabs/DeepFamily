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

/** @dev Generated verifier interface for the seven-signal shield circuit. */
interface IGroth16Verifier7 {
  function verifyProof(
    uint256[2] calldata a,
    uint256[2][2] calldata b,
    uint256[2] calldata c,
    uint256[7] calldata publicSignals
  ) external view returns (bool);
}

/** @dev Generated verifier interface shared by the twelve-signal pool circuits. */
interface IGroth16Verifier12 {
  function verifyProof(
    uint256[2] calldata a,
    uint256[2][2] calldata b,
    uint256[2] calldata c,
    uint256[12] calldata publicSignals
  ) external view returns (bool);
}

/** @dev Generated verifier interface shared by the funding and claim circuits. */
interface IGroth16Verifier27 {
  function verifyProof(
    uint256[2] calldata a,
    uint256[2][2] calldata b,
    uint256[2] calldata c,
    uint256[27] calldata publicSignals
  ) external view returns (bool);
}

/**
 * @title Groth16VerifierAdapter
 * @notice Shared Groth16 proof transport for identity, disclosure and the five shielded pool
 *         actions. Each route has an immutable verifier address.
 *
 *         Business contracts select a purpose and construct its public signals. This adapter
 *         validates their encoding and length without interpreting their business meaning.
 */
contract Groth16VerifierAdapter is IProofVerifierAdapter {
  error UnsupportedProofEncoding();
  error MalformedProofData();
  error UnsupportedPurpose();
  error InvalidVerifier();
  error VerifierNotConfigured(uint8 purpose);

  // 256 bytes = 32 * (2 + 4 + 2) for abi.encode(uint256[2], uint256[2][2], uint256[2]).
  uint256 internal constant GROTH16_ABC_PAYLOAD_LENGTH = 256;

  address public immutable personVerifier;
  address public immutable disclosureBindingVerifier;
  address public immutable shieldVerifier;
  address public immutable fundVerifier;
  address public immutable claimVerifier;
  address public immutable privateTransferVerifier;
  address public immutable unshieldVerifier;

  /**
   * @param shieldedVerifiers The five ShieldedPoolCore actions in Action enum order. A zero
   *                          address explicitly disables a route.
   */
  constructor(
    address _personVerifier,
    address _disclosureBindingVerifier,
    address[5] memory shieldedVerifiers
  ) {
    _validateVerifier(_personVerifier);
    _validateVerifier(_disclosureBindingVerifier);
    for (uint256 i = 0; i < shieldedVerifiers.length; ++i) {
      _validateVerifier(shieldedVerifiers[i]);
    }
    personVerifier = _personVerifier;
    disclosureBindingVerifier = _disclosureBindingVerifier;
    shieldVerifier = shieldedVerifiers[0];
    fundVerifier = shieldedVerifiers[1];
    claimVerifier = shieldedVerifiers[2];
    privateTransferVerifier = shieldedVerifiers[3];
    unshieldVerifier = shieldedVerifiers[4];
  }

  /** @notice Returns a known route's verifier, or zero when the route was explicitly disabled. */
  function verifierForPurpose(uint8 purpose) public view returns (address) {
    if (purpose == ProofConstants.PROOF_PURPOSE_PERSON_RELATION) return personVerifier;
    if (purpose == ProofConstants.PROOF_PURPOSE_DISCLOSURE_BINDING) {
      return disclosureBindingVerifier;
    }
    if (purpose == ProofConstants.PROOF_PURPOSE_SHIELDED_SHIELD) return shieldVerifier;
    if (purpose == ProofConstants.PROOF_PURPOSE_SHIELDED_FUND) return fundVerifier;
    if (purpose == ProofConstants.PROOF_PURPOSE_SHIELDED_CLAIM) return claimVerifier;
    if (purpose == ProofConstants.PROOF_PURPOSE_SHIELDED_PRIVATE_TRANSFER) {
      return privateTransferVerifier;
    }
    if (purpose == ProofConstants.PROOF_PURPOSE_SHIELDED_UNSHIELD) return unshieldVerifier;
    revert UnsupportedPurpose();
  }

  /**
   * @inheritdoc IProofVerifierAdapter
   *
   * @dev Transport-layer contract:
   *      - `UnsupportedProofEncoding` — `proofEncodingId` is not
   *        `PROOF_ENCODING_ID_ABI_GROTH16_ABC`.
   *      - `MalformedProofData` — `proofData` is not exactly 256 bytes, or
   *        `publicSignals.length` does not match the purpose-specific constant.
   *      - `UnsupportedPurpose` — `purpose` does not identify one of the seven circuit routes.
   *      - `VerifierNotConfigured` — the selected route was explicitly disabled at deployment.
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

    address verifier = verifierForPurpose(purpose);
    if (publicSignals.length != _publicSignalsLength(purpose)) revert MalformedProofData();
    if (verifier == address(0)) revert VerifierNotConfigured(purpose);

    (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = abi.decode(
      proofData,
      (uint256[2], uint256[2][2], uint256[2])
    );

    if (purpose == ProofConstants.PROOF_PURPOSE_PERSON_RELATION) {
      uint256[5] memory personSignals;
      for (uint256 i = 0; i < ProofConstants.PERSON_RELATION_PUBLIC_SIGNALS_LEN; ++i) {
        personSignals[i] = publicSignals[i];
      }
      return IGroth16PersonRelationVerifier(verifier).verifyProof(a, b, c, personSignals);
    }

    if (purpose == ProofConstants.PROOF_PURPOSE_DISCLOSURE_BINDING) {
      uint256[4] memory disclosureSignals;
      for (uint256 i = 0; i < ProofConstants.DISCLOSURE_BINDING_PUBLIC_SIGNALS_LEN; ++i) {
        disclosureSignals[i] = publicSignals[i];
      }
      return IGroth16DisclosureBindingVerifier(verifier).verifyProof(a, b, c, disclosureSignals);
    }

    return _verifyShieldedAction(verifier, a, b, c, publicSignals);
  }

  /** @dev The purpose already fixed the length, which selects the generated verifier ABI. */
  function _verifyShieldedAction(
    address verifier,
    uint256[2] memory a,
    uint256[2][2] memory b,
    uint256[2] memory c,
    uint256[] calldata publicSignals
  ) private view returns (bool) {
    uint256 length = publicSignals.length;
    if (length == 7) {
      uint256[7] memory signals7;
      for (uint256 i = 0; i < length; ++i) signals7[i] = publicSignals[i];
      return IGroth16Verifier7(verifier).verifyProof(a, b, c, signals7);
    }
    if (length == 12) {
      uint256[12] memory signals12;
      for (uint256 i = 0; i < length; ++i) signals12[i] = publicSignals[i];
      return IGroth16Verifier12(verifier).verifyProof(a, b, c, signals12);
    }
    uint256[27] memory signals27;
    for (uint256 i = 0; i < length; ++i) signals27[i] = publicSignals[i];
    return IGroth16Verifier27(verifier).verifyProof(a, b, c, signals27);
  }

  function _publicSignalsLength(uint8 purpose) private pure returns (uint256) {
    if (purpose == ProofConstants.PROOF_PURPOSE_PERSON_RELATION) {
      return ProofConstants.PERSON_RELATION_PUBLIC_SIGNALS_LEN;
    }
    if (purpose == ProofConstants.PROOF_PURPOSE_DISCLOSURE_BINDING) {
      return ProofConstants.DISCLOSURE_BINDING_PUBLIC_SIGNALS_LEN;
    }
    if (purpose == ProofConstants.PROOF_PURPOSE_SHIELDED_SHIELD) {
      return ProofConstants.SHIELDED_SHIELD_PUBLIC_SIGNALS_LEN;
    }
    if (purpose == ProofConstants.PROOF_PURPOSE_SHIELDED_FUND) {
      return ProofConstants.SHIELDED_FUND_PUBLIC_SIGNALS_LEN;
    }
    if (purpose == ProofConstants.PROOF_PURPOSE_SHIELDED_CLAIM) {
      return ProofConstants.SHIELDED_CLAIM_PUBLIC_SIGNALS_LEN;
    }
    if (purpose == ProofConstants.PROOF_PURPOSE_SHIELDED_PRIVATE_TRANSFER) {
      return ProofConstants.SHIELDED_PRIVATE_TRANSFER_PUBLIC_SIGNALS_LEN;
    }
    if (purpose == ProofConstants.PROOF_PURPOSE_SHIELDED_UNSHIELD) {
      return ProofConstants.SHIELDED_UNSHIELD_PUBLIC_SIGNALS_LEN;
    }
    revert UnsupportedPurpose();
  }

  function _validateVerifier(address verifier) private view {
    if (verifier != address(0) && verifier.code.length == 0) revert InvalidVerifier();
  }
}

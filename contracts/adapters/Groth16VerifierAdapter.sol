// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IProofVerifierAdapter} from "../interfaces/IProofVerifierAdapter.sol";
import {ProofConstants} from "../libraries/ProofConstants.sol";

interface IGroth16PersonRelationVerifier {
  function verifyProof(
    uint256[2] calldata a,
    uint256[2][2] calldata b,
    uint256[2] calldata c,
    uint256[5] calldata publicSignals
  ) external view returns (bool);
}
interface IGroth16DisclosureBindingVerifier {
  function verifyProof(
    uint256[2] calldata a,
    uint256[2][2] calldata b,
    uint256[2] calldata c,
    uint256[4] calldata publicSignals
  ) external view returns (bool);
}

/// @notice Identity and disclosure transport. Asset boundaries and receiving
///         operations have separate fixed verifiers and are not identity routes.
contract Groth16VerifierAdapter is IProofVerifierAdapter {
  error UnsupportedProofEncoding();
  error MalformedProofData();
  error UnsupportedPurpose();
  error InvalidVerifier();
  error VerifierNotConfigured(uint8 purpose);
  address public immutable personVerifier;
  address public immutable disclosureBindingVerifier;

  constructor(address person, address disclosure) {
    if (
      (person != address(0) && person.code.length == 0) ||
      (disclosure != address(0) && disclosure.code.length == 0)
    ) revert InvalidVerifier();
    personVerifier = person;
    disclosureBindingVerifier = disclosure;
  }
  function verifierForPurpose(uint8 purpose) public view returns (address) {
    if (purpose == ProofConstants.PROOF_PURPOSE_PERSON_RELATION) return personVerifier;
    if (purpose == ProofConstants.PROOF_PURPOSE_DISCLOSURE_BINDING)
      return disclosureBindingVerifier;
    revert UnsupportedPurpose();
  }
  function verifyProof(
    uint8 purpose,
    uint8 encoding,
    bytes calldata data,
    uint256[] calldata signals
  ) external view returns (bool) {
    if (encoding != ProofConstants.PROOF_ENCODING_ID_ABI_GROTH16_ABC)
      revert UnsupportedProofEncoding();
    if (data.length != 256) revert MalformedProofData();
    address verifier = verifierForPurpose(purpose);
    uint256 count = purpose == ProofConstants.PROOF_PURPOSE_PERSON_RELATION ? 5 : 4;
    if (signals.length != count) revert MalformedProofData();
    if (verifier == address(0)) revert VerifierNotConfigured(purpose);
    (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = abi.decode(
      data,
      (uint256[2], uint256[2][2], uint256[2])
    );
    if (count == 5) {
      uint256[5] memory values;
      for (uint256 i; i < 5; ++i) values[i] = signals[i];
      return IGroth16PersonRelationVerifier(verifier).verifyProof(a, b, c, values);
    }
    uint256[4] memory values4;
    for (uint256 i; i < 4; ++i) values4[i] = signals[i];
    return IGroth16DisclosureBindingVerifier(verifier).verifyProof(a, b, c, values4);
  }
}

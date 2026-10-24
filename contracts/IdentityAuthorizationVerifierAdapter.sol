// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIdentityCounterUpdateVerifier} from "./interfaces/IIdentityAuthorizationState.sol";

interface IIdentityAuthorizationGroth16Verifier {
  function verifyProof(
    uint256[2] calldata a,
    uint256[2][2] calldata b,
    uint256[2] calldata c,
    uint256[6] calldata inputs
  ) external view returns (bool);
}

/** @notice Adapts the fixed six-signal Circom counter authorization to shared state transport. */
contract IdentityAuthorizationVerifierAdapter is IIdentityCounterUpdateVerifier {
  error InvalidVerifier();
  IIdentityAuthorizationGroth16Verifier public immutable VERIFIER;

  constructor(address verifier) {
    if (verifier.code.length == 0) revert InvalidVerifier();
    VERIFIER = IIdentityAuthorizationGroth16Verifier(verifier);
  }

  function verifyProof(
    bytes calldata proof,
    uint256[6] calldata inputs
  ) external view returns (bool) {
    if (proof.length != 256) return false;
    (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = abi.decode(
      proof,
      (uint256[2], uint256[2][2], uint256[2])
    );
    return VERIFIER.verifyProof(a, b, c, inputs);
  }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice One immutable verification key and one exact public-signal layout per instance.
interface IFixedProofVerifier {
  function verifyProof(bytes calldata proof, uint256[] calldata publicSignals) external view returns (bool);
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/** @notice Shared counter dictionary for private receipts and letter delivery on this chain. */
interface IIdentityAuthorizationState {
  struct Checkpoint {
    uint256 root;
    uint64 createdAt;
    uint64 retiredAt;
  }

  function currentCheckpointId() external view returns (uint256);
  function currentRoot() external view returns (uint256);
  function getCheckpoint(uint256 checkpointId) external view returns (Checkpoint memory);

  /** @dev Reverts for unknown, mistimed or expired checkpoints; zero is the empty root. */
  function validateCheckpoint(uint256 checkpointId, uint64 asOf) external view returns (uint256);
}

/**
 * @dev The verifier MUST prove canonical R from identity and its nonzero identity secret,
 *      a canonical sparse-dictionary transition, an exact uint64 increment, and the
 *      authorization nullifier bound to the actual chain and state contract.
 *      An absent counter is zero only with a dictionary non-membership proof.
 */
interface IIdentityCounterUpdateVerifier {
  function verifyProof(
    bytes calldata proof,
    uint256[8] calldata inputs
  ) external view returns (bool);
}

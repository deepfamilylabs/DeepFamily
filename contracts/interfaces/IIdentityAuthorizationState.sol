// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/** @notice Shared counter dictionary for private receipts and letter delivery on this chain. */
interface IIdentityAuthorizationState {
  struct Checkpoint {
    uint256 root;
    uint64 createdAt;
    uint64 retiredAt;
  }

  /** @notice Current compressed dictionary opening; siblings follow low-bit-first paths. */
  struct CounterProof {
    uint64 authorizationCounter;
    uint256 stateRoot;
    uint256 depth;
    uint256[64] siblings;
    uint256 oldKey;
    uint64 oldValue;
    bool isOld0;
    bool absent;
  }

  function currentCheckpointId() external view returns (uint256);
  function currentRoot() external view returns (uint256);
  function getCheckpoint(uint256 checkpointId) external view returns (Checkpoint memory);
  function authorizationCounter(uint256 aliasR) external view returns (uint64);
  function getCounterProof(uint256 aliasR) external view returns (CounterProof memory);

  /** @dev Reverts for unknown, mistimed or expired checkpoints; zero is the empty root. */
  function validateCheckpoint(uint256 checkpointId, uint64 asOf) external view returns (uint256);
}

/**
 * @dev The verifier MUST prove canonical R from identity and its nonzero identity secret,
 *      a canonical sparse-dictionary transition, an exact uint64 increment, and the
 *      authorization nullifier bound to the actual chain and state contract.
 *      An absent counter is zero only with a dictionary non-membership proof. The proof's
 *      dictionary roots authenticate its original witness, not the live execution root:
 *      the state contract independently checks the live alias counter and computes the
 *      actual transition from its own nodes. Unrelated updates cannot stale owner authority.
 */
interface IIdentityCounterUpdateVerifier {
  function verifyProof(
    bytes calldata proof,
    uint256[8] calldata inputs
  ) external view returns (bool);
}

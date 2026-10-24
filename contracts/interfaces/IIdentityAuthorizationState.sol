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

  struct StateSnapshotHeader {
    uint256 formatVersion;
    uint64 rootNodeId;
    uint64 nodeCount;
    uint256 root;
    uint256 checkpointId;
  }

  struct NodeSnapshot {
    uint256 hash;
    uint256 key;
    uint64 counter;
    uint64 left;
    uint64 right;
  }

  function currentCheckpointId() external view returns (uint256);
  function currentRoot() external view returns (uint256);
  function getCheckpoint(uint256 checkpointId) external view returns (Checkpoint memory);
  function authorizationCounter(uint256 aliasR) external view returns (uint64);
  function getCounterProof(uint256 aliasR) external view returns (CounterProof memory);
  /** @notice Read the header and every page at the same block tag, then verify the root. */
  function getStateSnapshotHeader() external view returns (StateSnapshotHeader memory);
  /** @notice Node IDs start at one; startId == nodeCount + 1 returns an empty page. */
  function getNodePage(
    uint256 startId,
    uint256 limit
  ) external view returns (NodeSnapshot[] memory);

  /** @dev Reverts for unknown, mistimed or expired checkpoints; zero is the empty root. */
  function validateCheckpoint(uint256 checkpointId, uint64 asOf) external view returns (uint256);
}

/**
 * @dev The verifier MUST prove canonical R from identity and its nonzero identity secret,
 *      an exact uint64 increment, and the authorization nullifier bound to the actual
 *      chain and state contract. The state contract independently checks the live alias
 *      counter (zero for an absent identity) and computes the tree transition from its
 *      own nodes. Neither tree paths nor roots are part of the owner proof.
 */
interface IIdentityCounterUpdateVerifier {
  function verifyProof(
    bytes calldata proof,
    uint256[6] calldata inputs
  ) external view returns (bool);
}

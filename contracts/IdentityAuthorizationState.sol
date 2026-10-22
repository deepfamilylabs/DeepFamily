// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIdentityAuthorizationState, IIdentityCounterUpdateVerifier} from "./interfaces/IIdentityAuthorizationState.sol";

/**
 * @notice Immutable, proof-authorized counter state shared by every canonical pool and letter
 *         archive. Updates publish R and counters, but never publish the identity behind R.
 * @dev There is no owner, initializer, root setter, or verifier replacement entry point.
 *      Off-chain mirrors rebuild the sparse dictionary from CounterIncremented events.
 */
contract IdentityAuthorizationState is IIdentityAuthorizationState {
  error InvalidVerifier();
  error InvalidFieldElement();
  error StaleCounterRoot();
  error InvalidCounterIncrement();
  error AuthorizationAlreadyUsed();
  error InvalidCounterProof();
  error UnknownCheckpoint();
  error InvalidStateTime();
  error CheckpointExpired();

  uint256 public constant SNARK_SCALAR_FIELD =
    21888242871839275222246405745257275088548364400416034343698204186575808495617;
  uint256 public constant CHECKPOINT_RETIREMENT_WINDOW = 15 minutes;
  IIdentityCounterUpdateVerifier public immutable VERIFIER;
  uint256 public creationBlock;
  uint256 public override currentCheckpointId = 1;
  mapping(uint256 checkpointId => Checkpoint checkpoint) private _checkpoints;
  mapping(uint256 root => uint64 firstRetiredAt) public firstRetiredAtByRoot;
  mapping(uint256 authorizationNullifier => bool used) public authorizationUsed;

  event CounterIncremented(
    uint256 indexed checkpointId,
    uint256 indexed aliasR,
    uint64 oldCounter,
    uint64 newCounter,
    uint256 oldRoot,
    uint256 newRoot,
    uint256 authorizationNullifier
  );

  constructor(address verifier) {
    if (verifier.code.length == 0) revert InvalidVerifier();
    VERIFIER = IIdentityCounterUpdateVerifier(verifier);
    creationBlock = block.number;
    // Canonical circomlib sparse dictionary: an empty dictionary has root zero.
    _checkpoints[1] = Checkpoint(0, uint64(block.timestamp), 0);
  }

  function currentRoot() public view override returns (uint256) {
    return _checkpoints[currentCheckpointId].root;
  }

  function getCheckpoint(uint256 checkpointId) external view override returns (Checkpoint memory) {
    return _checkpoints[checkpointId];
  }

  /**
   * @notice Increment exactly one identity counter with its owner's ZK authorization.
   * @dev The verifier, rather than a caller-selected wallet, authenticates the identity secret.
   *      A concurrently superseded root must be reproved against the current dictionary.
   */
  function incrementCounter(
    uint256 authorizationNullifier,
    uint256 aliasR,
    uint256 oldRoot,
    uint256 newRoot,
    uint64 oldCounter,
    uint64 newCounter,
    bytes calldata proof
  ) external {
    if (oldRoot != currentRoot()) revert StaleCounterRoot();
    if (uint256(newCounter) != uint256(oldCounter) + 1 || newRoot == oldRoot)
      revert InvalidCounterIncrement();
    if (
      aliasR == 0 ||
      aliasR >= SNARK_SCALAR_FIELD ||
      authorizationNullifier == 0 ||
      authorizationNullifier >= SNARK_SCALAR_FIELD ||
      newRoot >= SNARK_SCALAR_FIELD
    ) revert InvalidFieldElement();
    if (authorizationUsed[authorizationNullifier]) revert AuthorizationAlreadyUsed();
    uint256[8] memory inputs = [
      authorizationNullifier,
      block.chainid,
      uint256(uint160(address(this))),
      aliasR,
      oldRoot,
      newRoot,
      uint256(oldCounter),
      uint256(newCounter)
    ];
    try VERIFIER.verifyProof(proof, inputs) returns (bool valid) {
      if (!valid) revert InvalidCounterProof();
    } catch {
      revert InvalidCounterProof();
    }

    authorizationUsed[authorizationNullifier] = true;
    Checkpoint storage previous = _checkpoints[currentCheckpointId];
    uint64 retiredAt = uint64(block.timestamp);
    previous.retiredAt = retiredAt;
    if (firstRetiredAtByRoot[oldRoot] == 0) firstRetiredAtByRoot[oldRoot] = retiredAt;
    uint256 checkpointId = ++currentCheckpointId;
    _checkpoints[checkpointId] = Checkpoint(newRoot, retiredAt, 0);
    emit CounterIncremented(
      checkpointId,
      aliasR,
      oldCounter,
      newCounter,
      oldRoot,
      newRoot,
      authorizationNullifier
    );
  }

  function validateCheckpoint(
    uint256 checkpointId,
    uint64 asOf
  ) external view override returns (uint256 root) {
    if (checkpointId == 0 || checkpointId > currentCheckpointId) revert UnknownCheckpoint();
    Checkpoint storage checkpoint = _checkpoints[checkpointId];
    if (asOf < checkpoint.createdAt || asOf > block.timestamp) revert InvalidStateTime();
    root = checkpoint.root;
    // A root's FIRST retirement governs all its IDs, including any later reappearance.
    // No unrelated update can evict it early or extend the original retirement window.
    uint64 retiredAt = firstRetiredAtByRoot[root];
    if (retiredAt != 0) {
      if (asOf > retiredAt) revert InvalidStateTime();
      if (block.timestamp >= uint256(retiredAt) + CHECKPOINT_RETIREMENT_WINDOW) {
        revert CheckpointExpired();
      }
    }
  }
}

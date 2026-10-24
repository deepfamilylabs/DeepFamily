// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIdentityAuthorizationState, IIdentityCounterUpdateVerifier} from "./interfaces/IIdentityAuthorizationState.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
import {PoseidonT4} from "poseidon-solidity/PoseidonT4.sol";

/**
 * @notice Immutable, proof-authorized counter state shared by every canonical pool and letter
 *         archive. Updates publish R and counters, but never publish the identity behind R.
 * @dev There is no owner, initializer, root setter, or verifier replacement entry point.
 *      Current dictionary nodes are retained for direct proof queries. Their stable IDs
 *      are reused by counter updates; only new aliases allocate leaves and branches.
 */
contract IdentityAuthorizationState is IIdentityAuthorizationState {
  error InvalidVerifier();
  error InvalidFieldElement();
  error StaleAuthorizationCounter();
  error InvalidCounterIncrement();
  error AuthorizationAlreadyUsed();
  error InvalidCounterProof();
  error UnknownCheckpoint();
  error InvalidStateTime();
  error CheckpointExpired();
  error AuthorizationPathCollision();
  error InvalidSnapshotPage();

  uint256 public constant SNARK_SCALAR_FIELD =
    21888242871839275222246405745257275088548364400416034343698204186575808495617;
  uint256 public constant CHECKPOINT_RETIREMENT_WINDOW = 15 minutes;
  uint256 public constant MAX_SNAPSHOT_PAGE_SIZE = 256;
  IIdentityCounterUpdateVerifier public immutable VERIFIER;
  uint256 public creationBlock;
  uint256 public override currentCheckpointId = 1;
  mapping(uint256 checkpointId => Checkpoint checkpoint) private _checkpoints;
  mapping(uint256 root => uint64 firstRetiredAt) public firstRetiredAtByRoot;
  mapping(uint256 authorizationNullifier => bool used) public authorizationUsed;
  mapping(uint256 aliasR => uint64 counter) public override authorizationCounter;

  // Zero ID is the empty subtree. Positive-counter nodes are leaves; zero-counter
  // nodes are branches. Child IDs/counter share one slot; hashes and full alias keys
  // each need one slot. Nodes are mutable current state, not historical hash objects.
  struct Node {
    uint256 hash;
    uint256 key;
    uint64 counter;
    uint64 left;
    uint64 right;
  }

  mapping(uint64 nodeId => Node node) private _nodes;
  uint64 private _rootNodeId;
  uint64 public nodeCount;

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

  function getStateSnapshotHeader() external view override returns (StateSnapshotHeader memory) {
    return StateSnapshotHeader(1, _rootNodeId, nodeCount, currentRoot(), currentCheckpointId);
  }

  function getNodePage(
    uint256 startId,
    uint256 limit
  ) external view override returns (NodeSnapshot[] memory page) {
    uint256 count = nodeCount;
    if (startId == 0 || startId > count + 1 || limit == 0 || limit > MAX_SNAPSHOT_PAGE_SIZE)
      revert InvalidSnapshotPage();
    uint256 length = count + 1 - startId;
    if (length > limit) length = limit;
    page = new NodeSnapshot[](length);
    for (uint256 offset; offset < length; ++offset) {
      Node storage node = _nodes[uint64(startId + offset)];
      page[offset] = NodeSnapshot(node.hash, node.key, node.counter, node.left, node.right);
    }
  }

  /** @notice Fetch at one block tag alongside the checkpoint; no history replay is needed. */
  function getCounterProof(
    uint256 aliasR
  ) external view override returns (CounterProof memory result) {
    if (aliasR == 0 || aliasR >= SNARK_SCALAR_FIELD) revert InvalidFieldElement();
    result.stateRoot = currentRoot();
    uint64 nodeId = _rootNodeId;
    while (nodeId != 0) {
      Node storage node = _nodes[nodeId];
      if (node.counter != 0) {
        result.oldKey = node.key;
        result.oldValue = node.counter;
        if (node.key == aliasR) result.authorizationCounter = node.counter;
        break;
      }
      uint256 depth = result.depth;
      if (depth >= 64) revert AuthorizationPathCollision();
      bool right = ((aliasR >> depth) & 1) != 0;
      result.siblings[depth] = _nodes[right ? node.left : node.right].hash;
      nodeId = right ? node.right : node.left;
      result.depth = depth + 1;
    }
    result.isOld0 = nodeId == 0;
    result.absent = result.authorizationCounter == 0;
  }

  /**
   * @notice Increment exactly one identity counter with its owner's ZK authorization.
   * @dev The verifier, rather than a caller-selected wallet, authenticates the identity secret.
   *      The owner proof authenticates the alias, scope and exact counter increment.
   *      The live counter is checked here and the root is computed from stored nodes;
   *      proofs do not depend on global tree paths or unrelated identity updates.
   */
  function incrementCounter(
    uint256 authorizationNullifier,
    uint256 aliasR,
    uint64 oldCounter,
    uint64 newCounter,
    bytes calldata proof
  ) external {
    if (uint256(newCounter) != uint256(oldCounter) + 1) revert InvalidCounterIncrement();
    if (
      aliasR == 0 ||
      aliasR >= SNARK_SCALAR_FIELD ||
      authorizationNullifier == 0 ||
      authorizationNullifier >= SNARK_SCALAR_FIELD
    ) revert InvalidFieldElement();
    if (authorizationUsed[authorizationNullifier]) revert AuthorizationAlreadyUsed();
    if (authorizationCounter[aliasR] != oldCounter) revert StaleAuthorizationCounter();
    uint256[6] memory inputs = [
      authorizationNullifier,
      block.chainid,
      uint256(uint160(address(this))),
      aliasR,
      uint256(oldCounter),
      uint256(newCounter)
    ];
    try VERIFIER.verifyProof(proof, inputs) returns (bool valid) {
      if (!valid) revert InvalidCounterProof();
    } catch {
      revert InvalidCounterProof();
    }

    uint256 actualOldRoot = currentRoot();
    _writeCounter(aliasR, newCounter);
    uint256 actualNewRoot = _nodes[_rootNodeId].hash;
    if (actualNewRoot == actualOldRoot) revert InvalidCounterIncrement();
    authorizationCounter[aliasR] = newCounter;
    authorizationUsed[authorizationNullifier] = true;
    Checkpoint storage previous = _checkpoints[currentCheckpointId];
    uint64 retiredAt = uint64(block.timestamp);
    previous.retiredAt = retiredAt;
    if (firstRetiredAtByRoot[actualOldRoot] == 0) firstRetiredAtByRoot[actualOldRoot] = retiredAt;
    uint256 checkpointId = ++currentCheckpointId;
    _checkpoints[checkpointId] = Checkpoint(actualNewRoot, retiredAt, 0);
    emit CounterIncremented(
      checkpointId,
      aliasR,
      oldCounter,
      newCounter,
      actualOldRoot,
      actualNewRoot,
      authorizationNullifier
    );
  }

  function _newLeaf(uint256 key, uint64 counter) private returns (uint64 nodeId) {
    nodeId = ++nodeCount;
    Node storage node = _nodes[nodeId];
    node.key = key;
    node.counter = counter;
    node.hash = PoseidonT4.hash([key, uint256(counter), uint256(1)]);
  }

  function _newBranch(uint64 left, uint64 right) private returns (uint64 nodeId) {
    nodeId = ++nodeCount;
    Node storage node = _nodes[nodeId];
    node.left = left;
    node.right = right;
    node.hash = PoseidonT3.hash([_nodes[left].hash, _nodes[right].hash]);
  }

  /** @dev Iterative low-bit-first insertion/update, identical to the Circom dictionary. */
  function _writeCounter(uint256 key, uint64 counter) private {
    uint64[64] memory ancestors;
    uint256 depth;
    uint64 nodeId = _rootNodeId;
    while (nodeId != 0 && _nodes[nodeId].counter == 0) {
      if (depth >= 64) revert AuthorizationPathCollision();
      ancestors[depth] = nodeId;
      nodeId = ((key >> depth) & 1) != 0 ? _nodes[nodeId].right : _nodes[nodeId].left;
      ++depth;
    }

    uint64 updated;
    if (nodeId == 0) {
      updated = _newLeaf(key, counter);
    } else if (_nodes[nodeId].key == key) {
      Node storage leaf = _nodes[nodeId];
      leaf.counter = counter;
      leaf.hash = PoseidonT4.hash([key, uint256(counter), uint256(1)]);
      updated = nodeId;
    } else {
      uint256 oldKey = _nodes[nodeId].key;
      uint256 split = depth;
      while (split < 64 && ((oldKey >> split) & 1) == ((key >> split) & 1)) ++split;
      if (split == 64) revert AuthorizationPathCollision();
      uint64 next = _newLeaf(key, counter);
      updated = ((key >> split) & 1) != 0 ? _newBranch(nodeId, next) : _newBranch(next, nodeId);
      while (split > depth) {
        --split;
        updated = ((key >> split) & 1) != 0 ? _newBranch(0, updated) : _newBranch(updated, 0);
      }
    }

    while (depth != 0) {
      --depth;
      uint64 parentId = ancestors[depth];
      Node storage parent = _nodes[parentId];
      if (((key >> depth) & 1) != 0) parent.right = updated;
      else parent.left = updated;
      parent.hash = PoseidonT3.hash([_nodes[parent.left].hash, _nodes[parent.right].hash]);
      updated = parentId;
    }
    _rootNodeId = updated;
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

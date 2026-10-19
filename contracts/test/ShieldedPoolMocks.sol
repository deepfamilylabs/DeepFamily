// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IProofVerifierAdapter} from "../interfaces/IProofVerifierAdapter.sol";
import {IDeepFamilyLineageIndex} from "../interfaces/IDeepFamilyLineageIndex.sol";
import {ShieldedErc20Pool} from "../ShieldedErc20Pool.sol";

/**
 * @dev Test only. This is deliberately not a ZK verifier and must never secure real funds.
 *      A "proof" is abi.encode(purpose, publicSignals), so it matches only the exact route and
 *      public signals that the pool builds.
 */
contract ShieldedPoolVerifierMock is IProofVerifierAdapter {
  function verifyProof(
    uint8 purpose,
    uint8 proofEncodingId,
    bytes calldata proof,
    uint256[] calldata publicSignals
  ) external pure returns (bool) {
    if (proofEncodingId != 1) return false;
    return keccak256(proof) == keccak256(abi.encode(purpose, publicSignals));
  }
}

contract ShieldedPoolLineageMock {
  uint256 public constant CHECKPOINT_RETIREMENT_WINDOW = 15 minutes;
  uint256[2] private _roots;
  uint256 public currentCheckpointId;
  mapping(uint256 checkpointId => IDeepFamilyLineageIndex.Checkpoint checkpoint)
    private _checkpoints;

  function setRoot(uint8 treeId, uint256 value) external {
    if (_roots[treeId] == value) return;
    _roots[treeId] = value;
    _recordCheckpoint();
  }

  function setRoots(uint256 endorsementRoot, uint256 trustedRoot) external {
    if (_roots[0] == endorsementRoot && _roots[1] == trustedRoot) return;
    _roots[0] = endorsementRoot;
    _roots[1] = trustedRoot;
    _recordCheckpoint();
  }

  function root(uint8 treeId) external view returns (uint256) {
    return _roots[treeId];
  }

  function getCheckpoint(
    uint256 checkpointId
  )
    external
    view
    returns (uint256 endorsementRoot, uint256 trustedRoot, uint256 createdAt, uint256 retiredAt)
  {
    IDeepFamilyLineageIndex.Checkpoint storage checkpoint = _checkpoints[checkpointId];
    return (
      checkpoint.endorsementRoot,
      checkpoint.trustedRoot,
      checkpoint.createdAt,
      checkpoint.retiredAt
    );
  }

  function isKnownCheckpoint(
    uint256 checkpointId,
    uint256 endorsementRoot,
    uint256 trustedRoot,
    uint256 asOf
  ) external view returns (bool) {
    if (
      checkpointId == 0 ||
      checkpointId > currentCheckpointId ||
      endorsementRoot == 0 ||
      trustedRoot == 0 ||
      asOf > block.timestamp
    ) return false;
    IDeepFamilyLineageIndex.Checkpoint storage checkpoint = _checkpoints[checkpointId];
    if (
      checkpoint.endorsementRoot != endorsementRoot ||
      checkpoint.trustedRoot != trustedRoot ||
      checkpoint.createdAt > asOf
    ) return false;
    if (checkpointId == currentCheckpointId) return true;
    return
      asOf <= checkpoint.retiredAt &&
      block.timestamp < checkpoint.retiredAt + CHECKPOINT_RETIREMENT_WINDOW;
  }

  function _recordCheckpoint() private {
    uint256 previousId = currentCheckpointId;
    if (previousId != 0) _checkpoints[previousId].retiredAt = block.timestamp;
    uint256 checkpointId = previousId + 1;
    currentCheckpointId = checkpointId;
    _checkpoints[checkpointId] = IDeepFamilyLineageIndex.Checkpoint({
      endorsementRoot: _roots[0],
      trustedRoot: _roots[1],
      createdAt: block.timestamp,
      retiredAt: 0
    });
  }
}

contract ShieldedPoolTokenMock is ERC20 {
  constructor() ERC20("Test DEEP", "TDEEP") {}

  function mint(address recipient, uint256 amount) external {
    _mint(recipient, amount);
  }
}

/** @dev Test only: recipients receive one token less than the requested transfer. */
contract ShieldedPoolFeeTokenMock is ERC20 {
  constructor() ERC20("Fee DEEP", "FDEEP") {}

  function mint(address recipient, uint256 amount) external {
    _mint(recipient, amount);
  }

  function _update(address from, address to, uint256 amount) internal override {
    if (from != address(0) && to != address(0) && amount != 0) {
      super._update(from, to, amount - 1);
      super._update(from, address(0), 1);
    } else {
      super._update(from, to, amount);
    }
  }
}

/** @dev Test only: models transfer fees, reverse balance changes and collateral loss. */
contract ShieldedPoolBehaviorTokenMock is ERC20 {
  error TokenCallbackFailed();
  uint8 private immutable _precision;
  uint8 private _behavior;
  address private _watchedFrom;
  address private _watchedTo;
  address private _callbackTarget;
  bytes private _callbackData;

  constructor(uint8 precision) ERC20("Behavior asset", "BHV") {
    _precision = precision;
  }

  function decimals() public view override returns (uint8) {
    return _precision;
  }

  function mint(address recipient, uint256 amount) external {
    _mint(recipient, amount);
  }

  function burn(address account, uint256 amount) external {
    _burn(account, amount);
  }

  function setBehavior(uint8 behavior, address watchedFrom, address watchedTo) external {
    _behavior = behavior;
    _watchedFrom = watchedFrom;
    _watchedTo = watchedTo;
  }

  function setCallback(address target, bytes calldata callData) external {
    _callbackTarget = target;
    _callbackData = callData;
  }

  function _update(address from, address to, uint256 amount) internal override {
    if (
      from == address(0) ||
      to == address(0) ||
      amount == 0 ||
      (_watchedFrom != address(0) && from != _watchedFrom) ||
      (_watchedTo != address(0) && to != _watchedTo)
    ) {
      super._update(from, to, amount);
      return;
    }
    if (_behavior == 1) {
      super._update(from, to, amount - 1);
      super._update(from, address(0), 1);
      return;
    }
    super._update(from, to, amount);
    if (_behavior == 2) super._update(from, address(0), 1);
    if (_behavior == 3) super._update(address(0), from, amount * 2);
    if (_behavior == 4) super._update(to, address(0), amount * 2);
    if (_behavior == 5) {
      (bool success, ) = _callbackTarget.call(_callbackData);
      if (!success) revert TokenCallbackFailed();
    }
  }
}

/** @dev Test only: rejects payment, forwards it, or propagates a blocked reentrant call. */
contract ShieldedNativeReceiverMock {
  error ReceiverRejected();
  uint8 private _mode;
  address private _target;
  bytes private _callData;

  function configure(uint8 mode, address target, bytes calldata callData) external {
    _mode = mode;
    _target = target;
    _callData = callData;
  }

  receive() external payable {
    if (_mode == 1) revert ReceiverRejected();
    if (_mode == 2) {
      (bool success, ) = _target.call(_callData);
      if (!success) revert ReceiverRejected();
    } else if (_mode == 3) {
      (bool success, ) = _target.call{value: msg.value}("");
      if (!success) revert ReceiverRejected();
    }
  }
}

/** @dev Test only: force a native surplus without calling the pool's shield entry. */
contract ShieldedForcedNativeMock {
  constructor() payable {}

  function force(address target) external {
    selfdestruct(payable(target));
  }
}

/** @dev Test only: initializes an otherwise impossible 2^32-leaf boundary state. */
contract ShieldedPoolRolloverHarness is ShieldedErc20Pool {
  constructor(
    address token,
    address lineageIndex,
    address verifierAdapter
  ) ShieldedErc20Pool(token, lineageIndex, verifierAdapter) {}

  function seedFullShard() external {
    Shard storage shard = _shards[0];
    shard.size = MAX_SHARD_LEAVES;
    shard.depth = NOTE_TREE_DEPTH;
    shard.root = 1;
    shard.knownRoots[1] = true;
  }
}

/**
 * @dev Test only: represents the root of a synthetic, full 2^31-leaf left subtree.
 *      The next two appends exercise the actual 32-level pool write path without
 *      allocating billions of storage slots. It does not establish that a witness
 *      belongs to the synthetic subtree; tests must use a real verifier for that.
 */
contract ShieldedPoolDepthHarness is ShieldedErc20Pool {
  constructor(
    address token,
    address lineageIndex,
    address verifierAdapter
  ) ShieldedErc20Pool(token, lineageIndex, verifierAdapter) {}

  function seedSyntheticLeftSubtree(uint256 leftRoot) external {
    Shard storage shard = _shards[0];
    if (shard.size != 0 || leftRoot == 0 || leftRoot >= SNARK_SCALAR_FIELD) {
      revert InvalidActionData();
    }
    uint256 size = uint256(1) << 31;
    shard.size = size;
    shard.depth = 31;
    shard.root = leftRoot;
    shard.nodes[31][0] = leftRoot;
    shard.knownRoots[leftRoot] = true;
  }
}

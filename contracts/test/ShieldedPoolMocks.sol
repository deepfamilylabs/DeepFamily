// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IProofVerifierAdapter} from "../interfaces/IProofVerifierAdapter.sol";
import {ShieldedDeepPool} from "../ShieldedDeepPool.sol";

/** @dev Test only. This is deliberately not a ZK verifier and must never secure real funds. */
contract ShieldedPoolVerifierMock is IProofVerifierAdapter {
  function verifyProof(
    uint8 purpose,
    uint8 proofEncodingId,
    bytes calldata proof,
    uint256[] calldata publicSignals
  ) external pure returns (bool) {
    if (publicSignals.length != 32 || proofEncodingId != 1 || purpose != 3 + publicSignals[0]) {
      return false;
    }
    uint256[32] memory fixedSignals;
    for (uint256 i = 0; i < 32; ++i) fixedSignals[i] = publicSignals[i];
    return keccak256(proof) == keccak256(abi.encode(fixedSignals));
  }
}

contract ShieldedPoolLineageMock {
  uint256[2] private _roots;

  function setRoot(uint8 treeId, uint256 value) external {
    _roots[treeId] = value;
  }

  function root(uint8 treeId) external view returns (uint256) {
    return _roots[treeId];
  }
}

contract ShieldedPoolKeyRegistryMock {
  mapping(uint256 shardId => mapping(uint256 root => bool known)) private _known;
  mapping(uint256 shardId => mapping(uint256 root => uint256 size)) private _sizes;

  function setKnownRoot(uint256 shardId, uint256 root, bool known, uint256 size) external {
    _known[shardId][root] = known;
    _sizes[shardId][root] = known ? size : 0;
  }

  function isKnownRoot(uint256 shardId, uint256 root) external view returns (bool) {
    return _known[shardId][root];
  }

  function knownRootSize(uint256 shardId, uint256 root) external view returns (uint256) {
    return _sizes[shardId][root];
  }
}

contract ShieldedPoolTokenMock is ERC20 {
  constructor() ERC20("Test DEEP", "TDEEP") {}

  function mint(address recipient, uint256 amount) external {
    _mint(recipient, amount);
  }
}

/** @dev Test only: initializes an otherwise impossible 2^32-leaf boundary state. */
contract ShieldedPoolRolloverHarness is ShieldedDeepPool {
  constructor(
    address token,
    address lineageIndex,
    address keyRegistry,
    address verifierAdapter
  ) ShieldedDeepPool(token, lineageIndex, keyRegistry, verifierAdapter) {}

  function seedFullShard() external {
    Shard storage shard = _shards[0];
    shard.size = MAX_SHARD_LEAVES;
    shard.depth = NOTE_TREE_DEPTH;
    shard.root = 1;
    shard.knownRoots[1] = true;
    shard.rootSizes[1] = MAX_SHARD_LEAVES;
  }
}

/**
 * @dev Test only: represents the root of a synthetic, full 2^31-leaf left subtree.
 *      The next two appends exercise the actual 32-level pool write path without
 *      allocating billions of storage slots. It does not establish that a witness
 *      belongs to the synthetic subtree; tests must use a real verifier for that.
 */
contract ShieldedPoolDepthHarness is ShieldedDeepPool {
  constructor(
    address token,
    address lineageIndex,
    address keyRegistry,
    address verifierAdapter
  ) ShieldedDeepPool(token, lineageIndex, keyRegistry, verifierAdapter) {}

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
    shard.rootSizes[leftRoot] = size;
  }
}

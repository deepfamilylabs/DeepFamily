// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
import {PoseidonT4} from "poseidon-solidity/PoseidonT4.sol";
import {PoseidonT5} from "poseidon-solidity/PoseidonT5.sol";
import {PoseidonT6} from "poseidon-solidity/PoseidonT6.sol";
import {IDeepFamilyLineageIndex} from "./interfaces/IDeepFamilyLineageIndex.sol";

/**
 * @title DeepFamilyLineageIndex
 * @notice Immutable companion of the DeepFamily proxy. DeepFamily reports every version,
 *         endorsement and trusted-endorser change; the index keeps two Poseidon LeanIMTs whose
 *         roots let an inheritance claim prove "my version is endorsed by a trusted endorser of
 *         that root" in zero knowledge. Both trees mirror public DeepFamily state in full, so being
 *         indexed reveals nothing that DeepFamily does not already publish.
 * @dev Trees follow zk-kit LeanIMT semantics: a node without a right sibling rises unchanged.
 *      Every node stays in storage so an update recomputes its path without caller-supplied
 *      siblings, and concurrent writes never invalidate each other.
 */
contract DeepFamilyLineageIndex is ERC165, IDeepFamilyLineageIndex {
  error InvalidDeepFamilyAddress();
  error UnauthorizedCaller();
  error InvalidTreeId();
  error IdentityCommitmentMismatch();
  error UnknownPerson();
  error UnknownVersion();
  error EndorsementNotIndexed();

  uint8 public constant ENDORSEMENT_TREE = 0;
  uint8 public constant TRUSTED_TREE = 1;
  /// @notice How long a replaced root still verifies, so a proof built just before a write lands.
  uint256 public constant ROOT_HISTORY_WINDOW = 1 hours;

  uint256 internal constant DOMAIN_ENDORSEMENT_LEAF = 1007;
  uint256 internal constant DOMAIN_TRUSTED_LEAF = 1008;
  uint256 internal constant DOMAIN_PARENTS = 1009;

  address public immutable override DEEP_FAMILY;

  struct Tree {
    uint256 size;
    uint256 depth;
    uint256 root;
    mapping(uint256 level => mapping(uint256 index => uint256 node)) nodes;
    mapping(uint256 root => uint256 replacedAt) replacedAt;
  }

  Tree[2] private _trees;
  mapping(bytes32 personHash => uint256 identityCommitment) private _identityCommitments;
  mapping(bytes32 personHash => mapping(uint256 versionIndex => uint256 digest))
    private _parentsDigests;
  // Slots hold leafIndex + 1, so zero means "never indexed".
  mapping(bytes32 personHash => mapping(address endorser => uint256 slot))
    private _endorsementSlots;
  mapping(bytes32 personHash => mapping(uint256 versionIndex => mapping(address account => uint256 slot)))
    private _trustedSlots;

  modifier onlyDeepFamily() {
    if (msg.sender != DEEP_FAMILY) revert UnauthorizedCaller();
    _;
  }

  constructor(address deepFamily) {
    if (deepFamily == address(0) || deepFamily.code.length == 0) revert InvalidDeepFamilyAddress();
    DEEP_FAMILY = deepFamily;
  }

  function indexKind() external pure override returns (bytes32) {
    return keccak256("deepfamily.lineage-index.v1");
  }

  function apiVersion() external pure override returns (uint256) {
    return 1;
  }

  function supportsInterface(
    bytes4 interfaceId
  ) public view override(ERC165, IERC165) returns (bool) {
    return
      interfaceId == type(IDeepFamilyLineageIndex).interfaceId ||
      super.supportsInterface(interfaceId);
  }

  // ========== DeepFamily hooks ==========

  function onVersionAdded(
    bytes32 personHash,
    uint256 versionIndex,
    uint256 identityCommitment,
    uint256 fatherIdentityCommitment,
    uint256 motherIdentityCommitment
  ) external override onlyDeepFamily {
    if (keccak256(abi.encodePacked(bytes32(identityCommitment))) != personHash) {
      revert IdentityCommitmentMismatch();
    }
    _identityCommitments[personHash] = identityCommitment;
    _parentsDigests[personHash][versionIndex] = PoseidonT4.hash(
      [DOMAIN_PARENTS, fatherIdentityCommitment, motherIdentityCommitment]
    );
    emit VersionIndexed(
      personHash,
      versionIndex,
      identityCommitment,
      fatherIdentityCommitment,
      motherIdentityCommitment
    );
  }

  function onTrustedEndorserSet(
    bytes32 personHash,
    uint256 versionIndex,
    address account,
    bool trusted
  ) external override onlyDeepFamily {
    uint256 leaf;
    if (trusted) {
      leaf = PoseidonT5.hash(
        [DOMAIN_TRUSTED_LEAF, _identityOf(personHash), versionIndex, uint256(uint160(account))]
      );
    }
    uint256 slot = _trustedSlots[personHash][versionIndex][account];
    if (slot != 0) {
      _write(TRUSTED_TREE, slot - 1, leaf);
    } else if (trusted) {
      _trustedSlots[personHash][versionIndex][account] = _append(TRUSTED_TREE, leaf) + 1;
    }
  }

  function onEndorsementSet(
    bytes32 personHash,
    address endorser,
    uint256 versionIndex
  ) external override onlyDeepFamily {
    uint256 digest = _parentsDigests[personHash][versionIndex];
    if (digest == 0) revert UnknownVersion();
    // Bits 0..159 hold the endorser and bits 160..223 the write time; both fit one field element.
    uint256 endorserAndTime = (block.timestamp << 160) | uint256(uint160(endorser));
    uint256 leaf = PoseidonT6.hash(
      [DOMAIN_ENDORSEMENT_LEAF, _identityOf(personHash), digest, versionIndex, endorserAndTime]
    );
    uint256 slot = _endorsementSlots[personHash][endorser];
    if (slot != 0) {
      _write(ENDORSEMENT_TREE, slot - 1, leaf);
    } else {
      _endorsementSlots[personHash][endorser] = _append(ENDORSEMENT_TREE, leaf) + 1;
    }
  }

  function onEndorsementCleared(
    bytes32 personHash,
    address endorser
  ) external override onlyDeepFamily {
    uint256 slot = _endorsementSlots[personHash][endorser];
    if (slot == 0) revert EndorsementNotIndexed();
    _write(ENDORSEMENT_TREE, slot - 1, 0);
  }

  // ========== Views ==========

  function root(uint8 treeId) external view override returns (uint256) {
    return _tree(treeId).root;
  }

  function size(uint8 treeId) external view override returns (uint256) {
    return _tree(treeId).size;
  }

  function depth(uint8 treeId) external view override returns (uint256) {
    return _tree(treeId).depth;
  }

  function isKnownRoot(uint8 treeId, uint256 candidate) external view override returns (bool) {
    Tree storage tree = _tree(treeId);
    if (candidate == 0) return false;
    if (candidate == tree.root) return true;
    uint256 replacedAt = tree.replacedAt[candidate];
    return replacedAt != 0 && block.timestamp <= replacedAt + ROOT_HISTORY_WINDOW;
  }

  function identityCommitmentOf(bytes32 personHash) external view override returns (uint256) {
    return _identityCommitments[personHash];
  }

  function parentsDigestOf(
    bytes32 personHash,
    uint256 versionIndex
  ) external view override returns (uint256) {
    return _parentsDigests[personHash][versionIndex];
  }

  function endorsementLeafIndex(
    bytes32 personHash,
    address endorser
  ) external view override returns (bool exists, uint256 leafIndex) {
    uint256 slot = _endorsementSlots[personHash][endorser];
    return slot == 0 ? (false, 0) : (true, slot - 1);
  }

  function trustedLeafIndex(
    bytes32 personHash,
    uint256 versionIndex,
    address account
  ) external view override returns (bool exists, uint256 leafIndex) {
    uint256 slot = _trustedSlots[personHash][versionIndex][account];
    return slot == 0 ? (false, 0) : (true, slot - 1);
  }

  // ========== Tree internals ==========

  function _tree(uint8 treeId) private view returns (Tree storage) {
    if (treeId > TRUSTED_TREE) revert InvalidTreeId();
    return _trees[treeId];
  }

  function _identityOf(bytes32 personHash) private view returns (uint256 identityCommitment) {
    identityCommitment = _identityCommitments[personHash];
    if (identityCommitment == 0) revert UnknownPerson();
  }

  function _append(uint8 treeId, uint256 leaf) private returns (uint256 leafIndex) {
    Tree storage tree = _trees[treeId];
    leafIndex = tree.size;
    uint256 newSize = leafIndex + 1;
    uint256 treeDepth = tree.depth;
    // The depth is ceil(log2(size)); one more leaf raises it by at most one level.
    if ((uint256(1) << treeDepth) < newSize) {
      treeDepth += 1;
      tree.depth = treeDepth;
    }
    tree.size = newSize;
    _commit(treeId, tree, leafIndex, leaf, _writePath(tree, leafIndex, leaf, newSize, treeDepth));
  }

  function _write(uint8 treeId, uint256 leafIndex, uint256 leaf) private {
    Tree storage tree = _trees[treeId];
    _commit(
      treeId,
      tree,
      leafIndex,
      leaf,
      _writePath(tree, leafIndex, leaf, tree.size, tree.depth)
    );
  }

  function _writePath(
    Tree storage tree,
    uint256 index,
    uint256 node,
    uint256 levelSize,
    uint256 treeDepth
  ) private returns (uint256) {
    for (uint256 level = 0; level < treeDepth; ++level) {
      tree.nodes[level][index] = node;
      if (index & 1 == 1) {
        node = PoseidonT3.hash([tree.nodes[level][index - 1], node]);
      } else if (index + 1 < levelSize) {
        node = PoseidonT3.hash([node, tree.nodes[level][index + 1]]);
      }
      index >>= 1;
      levelSize = (levelSize + 1) >> 1;
    }
    tree.nodes[treeDepth][0] = node;
    return node;
  }

  function _commit(
    uint8 treeId,
    Tree storage tree,
    uint256 leafIndex,
    uint256 leaf,
    uint256 newRoot
  ) private {
    uint256 oldRoot = tree.root;
    if (oldRoot != newRoot) {
      if (oldRoot != 0) tree.replacedAt[oldRoot] = block.timestamp;
      tree.root = newRoot;
    }
    emit LeafWritten(treeId, leafIndex, leaf, newRoot);
  }
}

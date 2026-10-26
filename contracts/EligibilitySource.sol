// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
import {IEligibilitySource} from "./interfaces/IEligibilitySource.sol";
import {IFixedProofVerifier} from "./interfaces/IFixedProofVerifier.sol";

interface ISourceLineage {
  function DEEP_FAMILY() external view returns (address);
  function root(uint8 treeId) external view returns (uint256);
}

interface ISourceManagers {
  function eligibilitySource() external view returns (address);
  function isTrustedEndorserManager(
    bytes32 personHash,
    uint256 versionIndex,
    address actor
  ) external view returns (bool);
}

/**
 * @notice Authenticates hidden role commitments against DeepFamily's actual current lineage.
 * @dev Publication is controlled by the existing endorser/parent managers and a fixed source
 *      attestation verifier. Only hidden, salted leaves enter the source trees. Source roles
 *      cannot be replaced through DeepFamily until their preimages have been revoked; the
 *      DeepFamily wrapper publishes those preimages and changes lineage in one transaction.
 *      Source leaves are append-only: old leaves are made ineligible by current role status.
 */
contract EligibilitySource is IEligibilitySource {
  error InvalidDependency();
  error UnauthorizedCaller();
  error InactiveSource();
  error InvalidField();
  error InvalidRole();
  error InvalidProof();
  error DuplicateLeaf();
  error DuplicateRole();
  error UnknownRole();
  error RoleAlreadyRevoked();
  error MissingRoleRevocation(uint8 role, uint256 commitment);
  error TooManyActiveRoles();
  error InvalidArrayLengths();
  error TreeCapacityExceeded();
  error InvalidLeafIndex();
  error InvalidPage();

  uint256 public constant SNARK_SCALAR_FIELD =
    21888242871839275222246405745257275088548364400416034343698204186575808495617;
  uint256 public constant MAX_TREE_LEAVES = uint256(1) << 64;
  uint256 public constant MAX_ACTIVE_ROLES_PER_KEY = 64;
  uint256 public constant MAX_PAGE_SIZE = 256;

  ISourceLineage public immutable LINEAGE_INDEX;
  address public immutable DEEP_FAMILY;
  IFixedProofVerifier public immutable FACT_VERIFIER;
  IFixedProofVerifier public immutable TRUST_VERIFIER;

  struct Tree {
    uint256 size;
    uint256 depth;
    uint256 root;
    mapping(uint256 level => mapping(uint256 index => uint256 node)) nodes;
    mapping(uint256 leaf => bool exists) knownLeaves;
  }

  struct RoleRecord {
    address controller;
    bytes32 parentHash;
    uint64 parentVersion;
    bool registered;
    bool revoked;
  }

  Tree[2] private _trees;
  mapping(uint8 role => mapping(uint256 commitment => RoleRecord record)) private _roles;
  mapping(bytes32 key => uint256[] commitments) private _childRoles;
  mapping(bytes32 key => uint256[] commitments) private _endorsementRoles;
  mapping(bytes32 key => uint256[] commitments) private _trustedRoles;
  uint256[][3] private _revokedSecrets;
  mapping(uint8 role => mapping(uint256 roleIndex => bool revoked)) private _revokedRoleIndices;

  event SourceLeafPublished(
    uint8 indexed treeId,
    uint256 indexed leafIndex,
    uint256 leaf,
    uint256 root
  );
  event RoleRegistered(uint8 indexed role, uint256 indexed commitment);
  event RoleRevoked(uint8 indexed role, uint256 secret, uint256 indexed commitment);

  constructor(address lineageIndex, address factVerifier, address trustVerifier) {
    if (
      lineageIndex.code.length == 0 ||
      factVerifier.code.length == 0 ||
      trustVerifier.code.length == 0
    ) {
      revert InvalidDependency();
    }
    LINEAGE_INDEX = ISourceLineage(lineageIndex);
    address deepFamily = ISourceLineage(lineageIndex).DEEP_FAMILY();
    if (deepFamily.code.length == 0 || block.chainid == 0 || block.chainid > type(uint64).max)
      revert InvalidDependency();
    DEEP_FAMILY = deepFamily;
    FACT_VERIFIER = IFixedProofVerifier(factVerifier);
    TRUST_VERIFIER = IFixedProofVerifier(trustVerifier);
  }

  function sourceRoot() external view returns (uint256) {
    return _trees[0].root;
  }
  function trustedRoot() external view returns (uint256) {
    return _trees[1].root;
  }
  function sourceSize(uint8 treeId) external view returns (uint256) {
    return _tree(treeId).size;
  }
  function sourceDepth(uint8 treeId) external view returns (uint256) {
    return _tree(treeId).depth;
  }

  function publishFact(
    uint256 childIdentity,
    uint256 parentIdentity,
    address endorser,
    uint256 parentVersion,
    uint256 factLeaf,
    uint256 childRoleCommitment,
    uint256 endorsementRoleCommitment,
    bytes calldata proof
  ) external returns (uint256 leafIndex, uint256 root) {
    _requireActive();
    if (msg.sender != endorser) revert UnauthorizedCaller();
    _nonzeroField(childIdentity);
    _nonzeroField(parentIdentity);
    _version(parentVersion);
    _nonzeroField(factLeaf);
    _nonzeroField(childRoleCommitment);
    _nonzeroField(endorsementRoleCommitment);
    uint256 lineageRoot = LINEAGE_INDEX.root(0);
    _nonzeroField(lineageRoot);
    uint256[] memory signals = new uint256[](10);
    signals[0] = factLeaf;
    signals[1] = childRoleCommitment;
    signals[2] = endorsementRoleCommitment;
    signals[3] = block.chainid;
    signals[4] = uint256(uint160(address(this)));
    signals[5] = childIdentity;
    signals[6] = parentIdentity;
    signals[7] = uint256(uint160(endorser));
    signals[8] = parentVersion;
    signals[9] = lineageRoot;
    if (!FACT_VERIFIER.verifyProof(proof, signals)) revert InvalidProof();
    bytes32 key = keccak256(abi.encode(childIdentity, endorser));
    _registerRole(0, childRoleCommitment, endorser, bytes32(0), 0, _childRoles[key]);
    _registerRole(1, endorsementRoleCommitment, endorser, bytes32(0), 0, _endorsementRoles[key]);
    (leafIndex, root) = _append(0, factLeaf);
  }

  function publishTrust(
    uint256 parentIdentity,
    address endorser,
    uint256 parentVersion,
    uint256 trustLeaf,
    uint256 trustRoleCommitment,
    bytes calldata proof
  ) external returns (uint256 leafIndex, uint256 root) {
    _requireActive();
    _nonzeroField(parentIdentity);
    _version(parentVersion);
    _nonzeroField(trustLeaf);
    _nonzeroField(trustRoleCommitment);
    if (endorser == address(0)) revert InvalidField();
    bytes32 parentHash = _personHash(parentIdentity);
    if (!_isManager(parentHash, parentVersion, msg.sender)) revert UnauthorizedCaller();
    uint256 lineageRoot = LINEAGE_INDEX.root(1);
    _nonzeroField(lineageRoot);
    uint256[] memory signals = new uint256[](8);
    signals[0] = trustLeaf;
    signals[1] = trustRoleCommitment;
    signals[2] = block.chainid;
    signals[3] = uint256(uint160(address(this)));
    signals[4] = parentIdentity;
    signals[5] = uint256(uint160(endorser));
    signals[6] = parentVersion;
    signals[7] = lineageRoot;
    if (!TRUST_VERIFIER.verifyProof(proof, signals)) revert InvalidProof();
    bytes32 key = keccak256(abi.encode(parentIdentity, parentVersion, endorser));
    _registerRole(
      2,
      trustRoleCommitment,
      address(0),
      parentHash,
      uint64(parentVersion),
      _trustedRoles[key]
    );
    (leafIndex, root) = _append(1, trustLeaf);
  }

  function revokeRoles(address actor, uint8[] calldata roles, uint256[] calldata secrets) external {
    if (msg.sender != DEEP_FAMILY || actor == address(0)) revert UnauthorizedCaller();
    _requireActive();
    if (roles.length == 0 || roles.length != secrets.length) revert InvalidArrayLengths();
    for (uint256 index; index < roles.length; ++index) {
      uint8 role = roles[index];
      if (role > 2) revert InvalidRole();
      uint256 secret = secrets[index];
      _nonzeroField(secret);
      uint256 commitment = PoseidonT3.hash([uint256(74201) + role, secret]);
      RoleRecord storage record = _roles[role][commitment];
      if (!record.registered) revert UnknownRole();
      if (record.revoked) revert RoleAlreadyRevoked();
      if (role == 2) {
        if (!_isManager(record.parentHash, record.parentVersion, actor))
          revert UnauthorizedCaller();
      } else if (record.controller != actor) revert UnauthorizedCaller();
      record.revoked = true;
      _revokedSecrets[role].push(secret);
      _revokedRoleIndices[role][PoseidonT3.hash([uint256(74321) + role, secret])] = true;
      emit RoleRevoked(role, secret, commitment);
    }
  }

  function beforeEndorsementChange(uint256 childIdentity, address endorser) external view {
    if (msg.sender != DEEP_FAMILY) revert UnauthorizedCaller();
    bytes32 key = keccak256(abi.encode(childIdentity, endorser));
    _requireRevoked(0, _childRoles[key]);
    _requireRevoked(1, _endorsementRoles[key]);
  }

  function beforeTrustedChange(
    uint256 parentIdentity,
    uint256 parentVersion,
    address endorser
  ) external view {
    if (msg.sender != DEEP_FAMILY) revert UnauthorizedCaller();
    bytes32 key = keccak256(abi.encode(parentIdentity, parentVersion, endorser));
    _requireRevoked(2, _trustedRoles[key]);
  }

  /// @notice Latest status for a stable, proof-authenticated qualification index.
  /// @dev Each lookup reads one mapping slot, regardless of the global revocation history.
  ///      This index uses a domain distinct from source registration commitments so that an
  ///      unrevoked code does not directly reveal its public source publication record.
  function isRoleRevoked(uint8 role, uint256 roleIndex) external view returns (bool) {
    if (role > 2) revert InvalidRole();
    _nonzeroField(roleIndex);
    return _revokedRoleIndices[role][roleIndex];
  }

  function roleRecord(uint8 role, uint256 commitment) external view returns (RoleRecord memory) {
    if (role > 2) revert InvalidRole();
    return _roles[role][commitment];
  }

  function revokedRoleCount(uint8 role) external view returns (uint256) {
    if (role > 2) revert InvalidRole();
    return _revokedSecrets[role].length;
  }

  function getRevokedRolePage(
    uint8 role,
    uint256 start,
    uint256 limit
  ) external view returns (uint256[] memory page) {
    if (role > 2) revert InvalidRole();
    uint256 length = _pageLength(_revokedSecrets[role].length, start, limit);
    page = new uint256[](length);
    for (uint256 offset; offset < length; ++offset)
      page[offset] = _revokedSecrets[role][start + offset];
  }

  function getSourceLeafPage(
    uint8 treeId,
    uint256 start,
    uint256 limit
  ) external view returns (uint256[] memory page) {
    Tree storage tree = _tree(treeId);
    uint256 length = _pageLength(tree.size, start, limit);
    page = new uint256[](length);
    for (uint256 offset; offset < length; ++offset) page[offset] = tree.nodes[0][start + offset];
  }

  function getSourceProof(
    uint8 treeId,
    uint256 leafIndex
  )
    external
    view
    returns (uint256 leaf, uint256 root, uint256 index, uint256 depth, uint256[] memory siblings)
  {
    Tree storage tree = _tree(treeId);
    if (leafIndex >= tree.size) revert InvalidLeafIndex();
    leaf = tree.nodes[0][leafIndex];
    root = tree.root;
    uint256 position = leafIndex;
    uint256 width = tree.size;
    for (uint256 level; level < tree.depth; ++level) {
      if ((position & 1) == 1 || position + 1 < width) ++depth;
      position >>= 1;
      width = (width + 1) >> 1;
    }
    siblings = new uint256[](depth);
    position = leafIndex;
    width = tree.size;
    uint256 step;
    for (uint256 level; level < tree.depth; ++level) {
      if ((position & 1) == 1) {
        siblings[step] = tree.nodes[level][position - 1];
        index |= uint256(1) << step;
        ++step;
      } else if (position + 1 < width) {
        siblings[step] = tree.nodes[level][position + 1];
        ++step;
      }
      position >>= 1;
      width = (width + 1) >> 1;
    }
  }

  function _registerRole(
    uint8 role,
    uint256 commitment,
    address controller,
    bytes32 parentHash,
    uint64 parentVersion,
    uint256[] storage keyRoles
  ) private {
    if (_roles[role][commitment].registered) revert DuplicateRole();
    // Prune only roles whose revocation is permanent and remains in the global published list.
    uint256 index;
    while (index < keyRoles.length) {
      if (_roles[role][keyRoles[index]].revoked) {
        keyRoles[index] = keyRoles[keyRoles.length - 1];
        keyRoles.pop();
      } else ++index;
    }
    if (keyRoles.length >= MAX_ACTIVE_ROLES_PER_KEY) revert TooManyActiveRoles();
    keyRoles.push(commitment);
    _roles[role][commitment] = RoleRecord(controller, parentHash, parentVersion, true, false);
    emit RoleRegistered(role, commitment);
  }

  function _requireRevoked(uint8 role, uint256[] storage commitments) private view {
    for (uint256 index; index < commitments.length; ++index) {
      if (!_roles[role][commitments[index]].revoked)
        revert MissingRoleRevocation(role, commitments[index]);
    }
  }

  function _requireActive() private view {
    if (ISourceManagers(DEEP_FAMILY).eligibilitySource() != address(this)) revert InactiveSource();
  }

  function _isManager(
    bytes32 personHash,
    uint256 version,
    address actor
  ) private view returns (bool) {
    return ISourceManagers(DEEP_FAMILY).isTrustedEndorserManager(personHash, version, actor);
  }

  function _personHash(uint256 identity) private pure returns (bytes32) {
    return keccak256(abi.encodePacked(bytes32(identity)));
  }

  function _nonzeroField(uint256 value) private pure {
    if (value == 0 || value >= SNARK_SCALAR_FIELD) revert InvalidField();
  }

  function _version(uint256 version) private pure {
    if (version == 0 || version > type(uint64).max) revert InvalidField();
  }

  function _pageLength(
    uint256 count,
    uint256 start,
    uint256 limit
  ) private pure returns (uint256 length) {
    if (start > count || limit == 0 || limit > MAX_PAGE_SIZE) revert InvalidPage();
    length = count - start;
    if (length > limit) length = limit;
  }

  function _tree(uint8 treeId) private view returns (Tree storage tree) {
    if (treeId > 1) revert InvalidRole();
    return _trees[treeId];
  }

  function _append(uint8 treeId, uint256 leaf) private returns (uint256 leafIndex, uint256 root) {
    Tree storage tree = _trees[treeId];
    if (tree.knownLeaves[leaf]) revert DuplicateLeaf();
    uint256 size = tree.size;
    if (size == MAX_TREE_LEAVES) revert TreeCapacityExceeded();
    leafIndex = size;
    uint256 position = size;
    uint256 width = size + 1;
    root = leaf;
    tree.nodes[0][position] = root;
    uint256 level;
    while (width > 1) {
      if ((position & 1) == 1) root = PoseidonT3.hash([tree.nodes[level][position - 1], root]);
      position >>= 1;
      width = (width + 1) >> 1;
      ++level;
      tree.nodes[level][position] = root;
    }
    tree.size = size + 1;
    tree.depth = level;
    tree.root = root;
    tree.knownLeaves[leaf] = true;
    emit SourceLeafPublished(treeId, leafIndex, leaf, root);
  }
}

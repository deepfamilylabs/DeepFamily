// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IDeepFamilyLineageIndex} from "./interfaces/IDeepFamilyLineageIndex.sol";
import {IProofVerifierAdapter} from "./interfaces/IProofVerifierAdapter.sol";
import {ProofConstants} from "./libraries/ProofConstants.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
import {PoseidonT6} from "poseidon-solidity/PoseidonT6.sol";

/**
 * @notice Lets an existing person register a public viewing key by proving knowledge of their
 *         existing identity secret. The public key only addresses encrypted notes; note events
 *         do not name this registry entry or the person receiving them.
 */
contract ShieldedHeirKeyRegistry {
  error InvalidConstructorAddress();
  error UnknownIdentity();
  error AlreadyRegistered();
  error InvalidViewingKey();
  error InvalidOwnerCommitment();
  error InvalidIdentityCommitment();
  error InvalidRegistrationTag();
  error InvalidRegistrationProof();
  error InvalidLeafIndex();
  error InvalidLeaf();

  uint256 private constant SNARK_SCALAR_FIELD =
    21888242871839275222246405745257275088548364400416034343698204186575808495617;
  uint256 public constant KEY_TREE_DEPTH = 32;
  uint256 public constant MAX_SHARD_LEAVES = uint256(1) << KEY_TREE_DEPTH;

  struct Shard {
    uint256 size;
    uint256 depth;
    uint256 root;
    mapping(uint256 level => mapping(uint256 index => uint256 node)) nodes;
    mapping(uint256 root => bool known) knownRoots;
    mapping(uint256 root => uint256 size) rootSizes;
  }

  struct Registration {
    bytes32 viewingKey;
    uint256 ownerCommitment;
  }

  IDeepFamilyLineageIndex public immutable LINEAGE_INDEX;
  IProofVerifierAdapter public immutable VERIFIER;
  uint256 public currentShardId;
  mapping(uint256 shardId => Shard shard) private _shards;
  mapping(bytes32 personHash => Registration) private _registrations;

  event ViewingKeyRegistered(
    bytes32 indexed personHash,
    uint256 identityCommitment,
    bytes32 viewingKey,
    uint256 ownerCommitment
  );
  event KeyLeafAppended(
    uint256 indexed shardId,
    uint256 indexed leafIndex,
    uint256 leaf,
    uint256 root
  );

  constructor(address lineageIndex, address verifier) {
    if (lineageIndex.code.length == 0 || verifier.code.length == 0) {
      revert InvalidConstructorAddress();
    }
    LINEAGE_INDEX = IDeepFamilyLineageIndex(lineageIndex);
    VERIFIER = IProofVerifierAdapter(verifier);
  }

  function registrationOf(
    bytes32 personHash
  ) external view returns (bytes32 viewingKey, uint256 ownerCommitment) {
    Registration storage entry = _registrations[personHash];
    return (entry.viewingKey, entry.ownerCommitment);
  }

  function keyShard(
    uint256 shardId
  ) external view returns (uint256 size, uint256 depth, uint256 root) {
    Shard storage shard = _shards[shardId];
    return (shard.size, shard.depth, shard.root);
  }

  function isKnownRoot(uint256 shardId, uint256 candidate) external view returns (bool) {
    return candidate != 0 && _shards[shardId].knownRoots[candidate];
  }

  function knownRootSize(uint256 shardId, uint256 candidate) external view returns (uint256) {
    return _shards[shardId].rootSizes[candidate];
  }

  /** @notice Compact LeanIMT path; clients may instead replay all public KeyLeafAppended events. */
  function getMerkleProof(
    uint256 shardId,
    uint256 leafIndex
  )
    external
    view
    returns (
      uint256 leaf,
      uint256 proofRoot,
      uint256 proofIndex,
      uint256 proofDepth,
      uint256[] memory siblings
    )
  {
    Shard storage shard = _shards[shardId];
    uint256 levelSize = shard.size;
    if (leafIndex >= levelSize) revert InvalidLeafIndex();
    leaf = shard.nodes[0][leafIndex];
    proofRoot = shard.root;
    uint256 index = leafIndex;
    uint256 treeDepth = shard.depth;
    for (uint256 level = 0; level < treeDepth; ++level) {
      if ((index & 1) == 1 || index + 1 < levelSize) ++proofDepth;
      index >>= 1;
      levelSize = (levelSize + 1) >> 1;
    }
    siblings = new uint256[](proofDepth);
    index = leafIndex;
    levelSize = shard.size;
    uint256 siblingIndex;
    for (uint256 level = 0; level < treeDepth; ++level) {
      if ((index & 1) == 1) {
        siblings[siblingIndex] = shard.nodes[level][index - 1];
        proofIndex |= uint256(1) << siblingIndex;
        ++siblingIndex;
      } else if (index + 1 < levelSize) {
        siblings[siblingIndex] = shard.nodes[level][index + 1];
        ++siblingIndex;
      }
      index >>= 1;
      levelSize = (levelSize + 1) >> 1;
    }
  }

  /**
   * @notice A copied transaction can only register the same key, because the proof binds both
   *         halves of the key, chain and registry address to the holder's identity secret.
   * @dev The key is the 32-byte X25519 public key used by local HPKE encryption. The circuit
   *      proves authorization to choose it; clients must derive/check the matching private key.
   */
  function register(
    uint256 identityCommitment,
    uint256 ownerCommitment,
    bytes32 viewingKey,
    uint256 registrationTag,
    bytes calldata proofData
  ) external {
    if (identityCommitment == 0 || identityCommitment >= SNARK_SCALAR_FIELD) {
      revert InvalidIdentityCommitment();
    }
    if (viewingKey == bytes32(0)) revert InvalidViewingKey();
    if (ownerCommitment == 0 || ownerCommitment >= SNARK_SCALAR_FIELD) {
      revert InvalidOwnerCommitment();
    }
    if (registrationTag == 0 || registrationTag >= SNARK_SCALAR_FIELD) {
      revert InvalidRegistrationTag();
    }
    bytes32 personHash = keccak256(abi.encodePacked(bytes32(identityCommitment)));
    if (LINEAGE_INDEX.identityCommitmentOf(personHash) != identityCommitment) {
      revert UnknownIdentity();
    }
    if (_registrations[personHash].viewingKey != bytes32(0)) revert AlreadyRegistered();

    uint256[] memory publicSignals = new uint256[](ProofConstants.KEY_REGISTRATION_PUBLIC_SIGNALS_LEN);
    publicSignals[0] = identityCommitment;
    publicSignals[1] = ownerCommitment;
    publicSignals[2] = uint256(uint128(uint256(viewingKey)));
    publicSignals[3] = uint256(viewingKey) >> 128;
    publicSignals[4] = block.chainid;
    publicSignals[5] = uint256(uint160(address(this)));
    publicSignals[6] = registrationTag;
    if (
      !VERIFIER.verifyProof(
        ProofConstants.PROOF_PURPOSE_KEY_REGISTRATION,
        ProofConstants.PROOF_ENCODING_ID_ABI_GROTH16_ABC,
        proofData,
        publicSignals
      )
    ) revert InvalidRegistrationProof();

    _registrations[personHash] = Registration({
      viewingKey: viewingKey,
      ownerCommitment: ownerCommitment
    });
    emit ViewingKeyRegistered(personHash, identityCommitment, viewingKey, ownerCommitment);
    uint256 leaf = PoseidonT6.hash(
      [
        uint256(1023),
        identityCommitment,
        ownerCommitment,
        uint256(viewingKey) >> 128,
        uint256(uint128(uint256(viewingKey)))
      ]
    );
    if (leaf == 0) revert InvalidLeaf();
    _append(leaf);
  }

  function _append(uint256 leaf) private {
    uint256 shardId = currentShardId;
    Shard storage shard = _shards[shardId];
    if (shard.size == MAX_SHARD_LEAVES) {
      shardId = ++currentShardId;
      shard = _shards[shardId];
    }
    uint256 leafIndex = shard.size;
    uint256 newSize = leafIndex + 1;
    uint256 treeDepth = shard.depth;
    if ((uint256(1) << treeDepth) < newSize) {
      ++treeDepth;
      shard.depth = treeDepth;
    }
    shard.size = newSize;
    uint256 index = leafIndex;
    uint256 node = leaf;
    uint256 levelSize = newSize;
    for (uint256 level = 0; level < treeDepth; ++level) {
      shard.nodes[level][index] = node;
      if ((index & 1) == 1) {
        node = PoseidonT3.hash([shard.nodes[level][index - 1], node]);
      } else if (index + 1 < levelSize) {
        node = PoseidonT3.hash([node, shard.nodes[level][index + 1]]);
      }
      index >>= 1;
      levelSize = (levelSize + 1) >> 1;
    }
    shard.nodes[treeDepth][0] = node;
    shard.root = node;
    shard.knownRoots[node] = true;
    shard.rootSizes[node] = newSize;
    emit KeyLeafAppended(shardId, leafIndex, leaf, node);
  }
}

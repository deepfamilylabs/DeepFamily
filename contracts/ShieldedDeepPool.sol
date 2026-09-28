// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
import {IDeepFamilyLineageIndex} from "./interfaces/IDeepFamilyLineageIndex.sol";
import {IProofVerifierAdapter} from "./interfaces/IProofVerifierAdapter.sol";
import {ProofConstants} from "./libraries/ProofConstants.sol";

interface IShieldedKeyRegistryRoots {
  function isKnownRoot(uint256 shardId, uint256 candidate) external view returns (bool);
  function knownRootSize(uint256 shardId, uint256 candidate) external view returns (uint256);
}

/**
 * @title ShieldedDeepPool
 * @notice Append-only, sharded Poseidon note tree and one-time nullifier registry for DEEP.
 *         The pool has no public inheritance IDs, policy balances, or claim recipients.
 * @dev One immutable shared adapter selects the matching circuit for each action. The circuits
 *      enforce input ownership, value conservation, permitted note transitions and binding of
 *      notes to ciphertext hashes. On-chain token conservation at shield/unshield boundaries
 *      relies on those private constraints for all internal transitions.
 */
contract ShieldedDeepPool is ReentrancyGuardTransient {
  using SafeERC20 for IERC20;

  error InvalidConstructorAddress();
  error InvalidAmount();
  error InvalidRecipient();
  error InvalidActionData();
  error InvalidFieldElement();
  error InvalidCiphertext();
  error DuplicateCommitment();
  error NullifierAlreadySpent();
  error UnknownNoteRoot();
  error SingleLeafNoteRoot();
  error UnknownLineageRoot();
  error UnknownKeyRegistryRoot();
  error SingleLeafKeyRegistryRoot();
  error InvalidClaimTime();
  error InvalidZKProof();
  error UnexpectedTokenTransfer();
  error InvalidLeafIndex();

  enum Action {
    Shield,
    CreatePolicy,
    Allocate,
    TopUp,
    MergeBudget,
    Claim,
    PrivateTransfer,
    Unshield
  }

  /// @notice All actions use two output slots and two input slots. Circuits enforce dummy slots.
  struct ActionData {
    uint256[2] inputShardIds;
    uint256[2] inputRoots;
    uint256[2] inputNullifiers;
    uint256[12] periodNullifiers;
    uint256[2] outputCommitments;
    bytes[2] outputCiphertexts;
    // Allocate/Claim: current endorsement/trusted roots.
    uint256 relation0;
    uint256 relation1;
    uint256 asOf;
    // Allocate/TopUp: recipient key registry root/shard.
    uint256 registryRoot;
    uint256 registryShardId;
  }

  struct Shard {
    uint256 size;
    uint256 depth;
    uint256 root;
    mapping(uint256 level => mapping(uint256 index => uint256 node)) nodes;
    mapping(uint256 root => bool known) knownRoots;
    mapping(uint256 root => uint256 size) rootSizes;
  }

  uint256 public constant NOTE_TREE_DEPTH = 32;
  uint256 public constant MAX_SHARD_LEAVES = uint256(1) << NOTE_TREE_DEPTH;
  uint256 public constant CIPHERTEXT_BYTES = 512;
  uint256 public constant ACTION_PROOF_LIFETIME = 2 hours;
  uint256 public constant SNARK_SCALAR_FIELD =
    21888242871839275222246405745257275088548364400416034343698204186575808495617;

  IERC20 public immutable TOKEN;
  IDeepFamilyLineageIndex public immutable LINEAGE_INDEX;
  IShieldedKeyRegistryRoots public immutable KEY_REGISTRY;
  IProofVerifierAdapter public immutable VERIFIER;

  uint256 public currentShardId;
  uint256 public totalShielded;
  mapping(uint256 shardId => Shard shard) internal _shards;
  mapping(uint256 nullifier => bool spent) public nullifierSpent;
  mapping(uint256 commitment => bool exists) public commitmentExists;

  /// @notice Ciphertexts contain only encrypted note data and no public policy or recipient ID.
  event NoteAppended(
    uint256 indexed shardId,
    uint256 indexed leafIndex,
    uint256 commitment,
    uint256 root,
    bytes ciphertext
  );
  event NullifierSpent(uint256 nullifier);
  /// @notice Public action boundary for direct calls and contract-batched calls alike.
  event ActionExecuted(uint8 action, uint256 inputShardId0, uint256 inputShardId1);

  /**
   * @param verifier The shared Groth16 adapter configured with all eight pool action verifiers.
   */
  constructor(
    address token,
    address lineageIndex,
    address keyRegistry,
    address verifier
  ) {
    if (
      token.code.length == 0 || lineageIndex.code.length == 0 || keyRegistry.code.length == 0 ||
      verifier.code.length == 0
    ) {
      revert InvalidConstructorAddress();
    }
    TOKEN = IERC20(token);
    LINEAGE_INDEX = IDeepFamilyLineageIndex(lineageIndex);
    KEY_REGISTRY = IShieldedKeyRegistryRoots(keyRegistry);
    VERIFIER = IProofVerifierAdapter(verifier);
  }

  /** @notice Publicly deposit exactly `amount` tokens and mint two privately owned notes. */
  function shield(
    uint256 amount,
    ActionData calldata data,
    bytes calldata proof
  ) external nonReentrant {
    if (amount == 0 || amount >= SNARK_SCALAR_FIELD) revert InvalidAmount();
    _execute(Action.Shield, data, proof, amount, address(0));
    uint256 beforeBalance = TOKEN.balanceOf(address(this));
    TOKEN.safeTransferFrom(msg.sender, address(this), amount);
    if (TOKEN.balanceOf(address(this)) - beforeBalance != amount) {
      revert UnexpectedTokenTransfer();
    }
    totalShielded += amount;
    _appendOutputs(Action.Shield, data);
  }

  function createPolicy(ActionData calldata data, bytes calldata proof) external nonReentrant {
    _privateAction(Action.CreatePolicy, data, proof);
  }

  /** @dev The Allocate circuit enforces eligibleFrom == asOf + ACTION_PROOF_LIFETIME. */
  function allocate(ActionData calldata data, bytes calldata proof) external nonReentrant {
    _privateAction(Action.Allocate, data, proof);
  }

  function topUp(ActionData calldata data, bytes calldata proof) external nonReentrant {
    _privateAction(Action.TopUp, data, proof);
  }

  function mergeBudget(ActionData calldata data, bytes calldata proof) external nonReentrant {
    _privateAction(Action.MergeBudget, data, proof);
  }

  /**
   * @notice Produces shielded output notes only; no ordinary wallet receives DEEP here.
   * @dev The Claim circuit uses complete 30-day periods from the per-heir eligibility start.
   *      The start is a private witness but is derivable from the allocation's public asOf.
   *      The one-time initial enrollment tag prevents competing starts for a policy and heir.
   */
  function claim(ActionData calldata data, bytes calldata proof) external nonReentrant {
    _privateAction(Action.Claim, data, proof);
  }

  function privateTransfer(ActionData calldata data, bytes calldata proof) external nonReentrant {
    _privateAction(Action.PrivateTransfer, data, proof);
  }

  /** @notice Burn a private value note and pay an ordinary, publicly visible recipient. */
  function unshield(
    address recipient,
    uint256 amount,
    ActionData calldata data,
    bytes calldata proof
  ) external nonReentrant {
    if (recipient == address(0)) revert InvalidRecipient();
    if (amount == 0 || amount >= SNARK_SCALAR_FIELD) revert InvalidAmount();
    _execute(Action.Unshield, data, proof, amount, recipient);
    _spendInputs(data, false);
    _appendOutputs(Action.Unshield, data);
    totalShielded -= amount;
    uint256 beforeBalance = TOKEN.balanceOf(address(this));
    TOKEN.safeTransfer(recipient, amount);
    if (beforeBalance - TOKEN.balanceOf(address(this)) != amount) {
      revert UnexpectedTokenTransfer();
    }
  }

  function noteShard(
    uint256 shardId
  ) external view returns (uint256 size, uint256 depth, uint256 root) {
    Shard storage shard = _shards[shardId];
    return (shard.size, shard.depth, shard.root);
  }

  function isKnownNoteRoot(uint256 shardId, uint256 candidate) external view returns (bool) {
    return candidate != 0 && _shards[shardId].knownRoots[candidate];
  }

  /**
   * @notice Compact LeanIMT path. Calling this for an identifiable leaf at a third-party RPC can
   *         reveal interest in that leaf; clients should normally reconstruct from all events.
   */
  function getNoteMerkleProof(
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

  function _privateAction(Action action, ActionData calldata data, bytes calldata proof) private {
    _execute(action, data, proof, 0, address(0));
    _spendInputs(data, action == Action.Claim);
    _appendOutputs(action, data);
  }

  function _execute(
    Action action,
    ActionData calldata data,
    bytes calldata proof,
    uint256 amount,
    address recipient
  ) private view {
    bool isShield = action == Action.Shield;
    bool isClaim = action == Action.Claim;
    for (uint256 i = 0; i < 2; ++i) {
      if (isShield) {
        if (data.inputShardIds[i] != 0 || data.inputRoots[i] != 0 || data.inputNullifiers[i] != 0)
          revert InvalidActionData();
      } else {
        _requireField(data.inputShardIds[i]);
        _requireNonzeroField(data.inputRoots[i]);
        _requireNonzeroField(data.inputNullifiers[i]);
        if (!_shards[data.inputShardIds[i]].knownRoots[data.inputRoots[i]]) {
          revert UnknownNoteRoot();
        }
        // LeanIMT's one-leaf root equals that leaf commitment, so accepting
        // it would reveal exactly which note a private proof spends.
        if (_shards[data.inputShardIds[i]].rootSizes[data.inputRoots[i]] < 2) {
          revert SingleLeafNoteRoot();
        }
        if (nullifierSpent[data.inputNullifiers[i]]) revert NullifierAlreadySpent();
      }
      _requireNonzeroField(data.outputCommitments[i]);
      if (commitmentExists[data.outputCommitments[i]]) revert DuplicateCommitment();
      if (data.outputCiphertexts[i].length != CIPHERTEXT_BYTES) {
        revert InvalidCiphertext();
      }
    }
    if (data.outputCommitments[0] == data.outputCommitments[1]) {
      revert DuplicateCommitment();
    }
    if (!isShield && data.inputNullifiers[0] == data.inputNullifiers[1]) {
      revert NullifierAlreadySpent();
    }

    for (uint256 i = 0; i < data.periodNullifiers.length; ++i) {
      uint256 periodNullifier = data.periodNullifiers[i];
      if (isClaim) {
        _requireNonzeroField(periodNullifier);
        if (nullifierSpent[periodNullifier]) revert NullifierAlreadySpent();
      } else if (periodNullifier != 0) {
        revert InvalidActionData();
      }
    }
    if (isClaim) {
      _requireNonzeroField(data.relation0);
      _requireNonzeroField(data.relation1);
      if (data.relation0 != LINEAGE_INDEX.root(0) || data.relation1 != LINEAGE_INDEX.root(1))
        revert UnknownLineageRoot();
    } else if (action == Action.Allocate) {
      _requireNonzeroField(data.relation0);
      _requireNonzeroField(data.relation1);
      if (data.relation0 != LINEAGE_INDEX.root(0) || data.relation1 != LINEAGE_INDEX.root(1))
        revert UnknownLineageRoot();
    } else if (data.relation0 != 0 || data.relation1 != 0) {
      revert InvalidActionData();
    }
    if (action == Action.Allocate || action == Action.TopUp) {
      _requireNonzeroField(data.registryRoot);
      _requireField(data.registryShardId);
      if (!KEY_REGISTRY.isKnownRoot(data.registryShardId, data.registryRoot)) {
        revert UnknownKeyRegistryRoot();
      }
      if (KEY_REGISTRY.knownRootSize(data.registryShardId, data.registryRoot) < 2) {
        revert SingleLeafKeyRegistryRoot();
      }
    } else if (data.registryRoot != 0 || data.registryShardId != 0) {
      revert InvalidActionData();
    }
    if (isClaim || action == Action.Allocate) {
      if (data.asOf > block.timestamp || block.timestamp - data.asOf >= ACTION_PROOF_LIFETIME) {
        revert InvalidClaimTime();
      }
    } else if (data.asOf != 0) {
      revert InvalidActionData();
    }

    uint256[] memory signals = new uint256[](ProofConstants.SHIELDED_ACTION_PUBLIC_SIGNALS_LEN);
    signals[0] = uint256(action);
    signals[1] = block.chainid;
    signals[2] = uint256(uint160(address(this)));
    signals[3] = data.inputShardIds[0];
    signals[4] = data.inputRoots[0];
    signals[5] = data.inputShardIds[1];
    signals[6] = data.inputRoots[1];
    signals[7] = data.inputNullifiers[0];
    signals[8] = data.inputNullifiers[1];
    for (uint256 i = 0; i < 12; ++i) {
      signals[9 + i] = data.periodNullifiers[i];
    }
    signals[21] = data.outputCommitments[0];
    signals[22] = data.outputCommitments[1];
    signals[23] = uint256(keccak256(data.outputCiphertexts[0])) % SNARK_SCALAR_FIELD;
    signals[24] = uint256(keccak256(data.outputCiphertexts[1])) % SNARK_SCALAR_FIELD;
    signals[25] = amount;
    signals[26] = uint256(uint160(recipient));
    signals[27] = data.relation0;
    signals[28] = data.relation1;
    signals[29] = data.asOf;
    signals[30] = data.registryRoot;
    signals[31] = data.registryShardId;
    for (uint256 i = 0; i < signals.length; ++i) {
      _requireField(signals[i]);
    }
    if (
      !VERIFIER.verifyProof(
        ProofConstants.PROOF_PURPOSE_SHIELDED_ACTION_BASE + uint8(action),
        ProofConstants.PROOF_ENCODING_ID_ABI_GROTH16_ABC,
        proof,
        signals
      )
    ) revert InvalidZKProof();
  }

  function _spendInputs(ActionData calldata data, bool isClaim) private {
    _spendNullifier(data.inputNullifiers[0]);
    _spendNullifier(data.inputNullifiers[1]);
    if (isClaim) {
      for (uint256 i = 0; i < 12; ++i) {
        _spendNullifier(data.periodNullifiers[i]);
      }
    }
  }

  function _spendNullifier(uint256 nullifier) private {
    if (nullifierSpent[nullifier]) revert NullifierAlreadySpent();
    nullifierSpent[nullifier] = true;
    emit NullifierSpent(nullifier);
  }

  function _appendOutputs(Action action, ActionData calldata data) private {
    emit ActionExecuted(uint8(action), data.inputShardIds[0], data.inputShardIds[1]);
    for (uint256 i = 0; i < 2; ++i) {
      uint256 commitment = data.outputCommitments[i];
      commitmentExists[commitment] = true;
      _append(commitment, data.outputCiphertexts[i]);
    }
  }

  function _append(uint256 commitment, bytes calldata ciphertext) private {
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
    uint256 newRoot = _writePath(shard, leafIndex, commitment, newSize, treeDepth);
    if (newRoot == 0) revert InvalidFieldElement();
    shard.root = newRoot;
    shard.knownRoots[newRoot] = true;
    shard.rootSizes[newRoot] = newSize;
    emit NoteAppended(shardId, leafIndex, commitment, newRoot, ciphertext);
  }

  function _writePath(
    Shard storage shard,
    uint256 index,
    uint256 node,
    uint256 levelSize,
    uint256 treeDepth
  ) private returns (uint256) {
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
    return node;
  }

  function _requireField(uint256 value) private pure {
    if (value >= SNARK_SCALAR_FIELD) revert InvalidFieldElement();
  }

  function _requireNonzeroField(uint256 value) private pure {
    if (value == 0 || value >= SNARK_SCALAR_FIELD) revert InvalidFieldElement();
  }
}

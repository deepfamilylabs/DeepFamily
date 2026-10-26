// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
import {IProofVerifierAdapter} from "./interfaces/IProofVerifierAdapter.sol";
import {IReceiveRegistry} from "./interfaces/IReceiveRegistry.sol";
import {IFixedProofVerifier} from "./interfaces/IFixedProofVerifier.sol";
import {ProofConstants} from "./libraries/ProofConstants.sol";

/// @notice One canonical receive protocol and shielded ledger for one asset.
/// @dev All accepted actions bind their actual ciphertext bytes and consume one-time
///      note nullifiers. Budgets accept independent donor contributions without
///      requiring the recipient to spend an existing note or come online.
abstract contract ShieldedPoolCore is ReentrancyGuardTransient {
  error InvalidConstructorAddress();
  error InvalidAmount();
  error InvalidRecipient();
  error InvalidActionData();
  error InvalidFieldElement();
  error InvalidCiphertext();
  error DuplicateCommitment();
  error NullifierAlreadySpent();
  error UnknownNoteRoot();
  error InvalidClaimTime();
  error InvalidZKProof();
  error UnexpectedTokenTransfer();
  error InsufficientCollateral();
  error InvalidLeafIndex();
  error InvalidReceiveProof();
  error InvalidBudget();

  enum Action { Shield, Fund, Claim, Transfer, Unshield }

  /// @notice Shield has no inputs; actions use one, withdrawals one or four.
  /// @dev Qualification, budget terms and period nullifiers belong to their own
  ///      typed action arguments, not unused fields in every ledger operation.
  struct ActionData {
    uint256[] inputShardIds;
    uint256[] inputRoots;
    uint256[] inputNullifiers;
    uint256[2] outputCommitments;
    bytes[2] outputCiphertexts;
  }

  struct BudgetRecord {
    bool exists;
    uint256 commonBinding;
    uint256 policyCommitment;
    uint64 eligibleFrom;
    uint256 codeAlias;
    uint256 nonce;
    uint256 ownerCommitment;
    uint256 viewKeyLo;
    uint256 viewKeyHi;
  }

  struct Deposit {
    uint256 policyCommitment;
    uint256 budgetKey;
    uint64 eligibleFrom;
  }

  struct Claim {
    uint256 budgetKey;
    uint64 asOf;
    uint256 periodNullifier;
    uint256 issuanceRoot;
    uint256 childRoleIndex;
    uint256 endorsementRoleIndex;
    uint256 trustedRoleIndex;
  }

  struct Shard {
    uint256 size;
    uint256 depth;
    uint256 root;
    mapping(uint256 level => mapping(uint256 index => uint256 node)) nodes;
    mapping(uint256 root => bool known) knownRoots;
  }

  uint256 public constant NOTE_TREE_DEPTH = 32;
  uint256 public constant MAX_SHARD_LEAVES = uint256(1) << NOTE_TREE_DEPTH;
  uint256 public constant CIPHERTEXT_BYTES = 512;
  uint256 public constant ACTION_PROOF_LIFETIME = 2 hours;
  uint256 public constant SNARK_SCALAR_FIELD =
    21888242871839275222246405745257275088548364400416034343698204186575808495617;

  IProofVerifierAdapter public immutable VERIFIER;
  IReceiveRegistry public immutable RECEIVE_REGISTRY;
  IFixedProofVerifier public immutable FUND_VERIFIER;
  IFixedProofVerifier public immutable CLAIM_VERIFIER;
  IFixedProofVerifier public immutable TRANSFER_VERIFIER;

  uint256 public creationBlock;
  uint256 public currentShardId;
  uint256 public totalShielded;
  uint256 public nullifierCount;
  mapping(uint256 shardId => Shard shard) internal _shards;
  mapping(uint256 nullifier => bool spent) public nullifierSpent;
  mapping(uint256 commitment => bool exists) public commitmentExists;
  mapping(uint256 budgetKey => BudgetRecord record) public budgetRecords;

  event NoteAppended(uint256 indexed shardId, uint256 indexed leafIndex,
    uint256 commitment, uint256 root, bytes ciphertext);
  event NullifierSpent(uint256 nullifier);
  event ActionExecuted(uint8 action, uint256 inputShardId0, uint256 inputShardId1);
  event BudgetDeposited(uint256 indexed budgetKey, uint256 indexed codeBinding, bool created);

  constructor(address boundaryVerifier, address registry, address fundVerifier,
    address claimVerifier, address transferVerifier) {
    if (boundaryVerifier.code.length == 0 || registry.code.length == 0 ||
        fundVerifier.code.length == 0 || claimVerifier.code.length == 0 ||
        transferVerifier.code.length == 0) revert InvalidConstructorAddress();
    VERIFIER = IProofVerifierAdapter(boundaryVerifier);
    RECEIVE_REGISTRY = IReceiveRegistry(registry);
    FUND_VERIFIER = IFixedProofVerifier(fundVerifier);
    CLAIM_VERIFIER = IFixedProofVerifier(claimVerifier);
    TRANSFER_VERIFIER = IFixedProofVerifier(transferVerifier);
    creationBlock = block.number;
  }

  function assetKind() external pure virtual returns (uint8);
  function protocolVersion() external pure returns (uint256) { return 1; }
  function _assetBalance() internal view virtual returns (uint256);
  function _pay(address recipient, uint256 amount) internal virtual;

  function _validateAmount(uint256 amount) internal pure {
    if (amount == 0 || amount > type(uint128).max) revert InvalidAmount();
  }
  function _assertCollateral() internal view {
    if (_assetBalance() < totalShielded) revert InsufficientCollateral();
  }

  /// @notice Spend private VALUE notes and pay an ordinary publicly visible address.
  function unshield(address recipient, uint256 amount, ActionData calldata data, bytes calldata proof)
    external nonReentrant
  {
    if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
    _validateAmount(amount);
    _verifyBoundary(Action.Unshield, data, proof, amount, recipient);
    _spendInputs(data);
    _appendOutputs(Action.Unshield, data);
    totalShielded -= amount;
    _pay(recipient, amount);
    _assertCollateral();
  }

  function noteShard(
    uint256 shardId
  ) external view returns (uint256 size, uint256 depth, uint256 root) {
    Shard storage shard = _shards[shardId];
    return (shard.size, shard.depth, shard.root);
  }

  /// @notice Known roots follow complete actions; an action's first-output root is never known.
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

  function depositBudget(
    IReceiveRegistry.Code calldata code,
    IReceiveRegistry.Capability calldata capability,
    bytes calldata codeProof, bytes calldata capabilityProof,
    Deposit calldata deposit, ActionData calldata data, bytes calldata proof
  ) external nonReentrant {
    _validateSingleInputAction(data);
    if (!RECEIVE_REGISTRY.verifyBudgetCapability(code, capability, codeProof, capabilityProof)) {
      revert InvalidReceiveProof();
    }
    _nonzero(deposit.policyCommitment);
    _nonzero(deposit.budgetKey);
    BudgetRecord storage record = budgetRecords[deposit.budgetKey];
    bool created = !record.exists;
    if (created) {
      // Equivalent to eligibleFrom = asOf + the existing proof-lifetime grace,
      // with asOf in the last two hours. No future-dated qualification timestamp.
      if (deposit.eligibleFrom <= block.timestamp ||
          deposit.eligibleFrom > block.timestamp + ACTION_PROOF_LIFETIME) revert InvalidClaimTime();
    } else if (
      record.commonBinding != code.commonBinding || record.policyCommitment != deposit.policyCommitment ||
      record.eligibleFrom != deposit.eligibleFrom || record.codeAlias != code.codeAlias ||
      record.nonce != code.nonce || record.ownerCommitment != code.ownerCommitment ||
      record.viewKeyLo != code.viewKeyLo || record.viewKeyHi != code.viewKeyHi
    ) revert InvalidBudget();

    uint256[] memory signals = new uint256[](20);
    signals[0] = block.chainid; signals[1] = uint256(uint160(address(this)));
    signals[2] = code.commonBinding; signals[3] = code.codeAlias; signals[4] = code.nonce;
    signals[5] = code.ownerCommitment; signals[6] = code.viewKeyLo; signals[7] = code.viewKeyHi;
    signals[8] = capability.capabilityBinding; signals[9] = capability.familyTag;
    signals[10] = capability.parentVersion; signals[11] = deposit.policyCommitment;
    signals[12] = deposit.budgetKey; signals[13] = deposit.eligibleFrom;
    _actionSignals(signals, 14, data);
    if (!FUND_VERIFIER.verifyProof(proof, signals)) revert InvalidZKProof();
    if (created) {
      budgetRecords[deposit.budgetKey] = BudgetRecord(
        true, code.commonBinding, deposit.policyCommitment, deposit.eligibleFrom,
        code.codeAlias, code.nonce, code.ownerCommitment, code.viewKeyLo, code.viewKeyHi
      );
    }
    _spendInputs(data);
    _appendOutputs(Action.Fund, data);
    emit BudgetDeposited(deposit.budgetKey, code.commonBinding, created);
  }

  /// @notice Claim one matured policy period; all codes of the same subject share its nullifier.
  /// @dev Current qualification remains mandatory. Code expiry governs new acceptance;
  ///      spending authenticates current Q directly, without requiring a new generic code.
  function claimBudget(Claim calldata claimData, ActionData calldata data, bytes calldata proof)
    external nonReentrant
  {
    _validateSingleInputAction(data);
    BudgetRecord storage record = budgetRecords[claimData.budgetKey];
    if (!record.exists) revert InvalidBudget();
    if (claimData.asOf > block.timestamp || block.timestamp - claimData.asOf > ACTION_PROOF_LIFETIME) {
      revert InvalidClaimTime();
    }
    _nonzero(claimData.periodNullifier);
    if (nullifierSpent[claimData.periodNullifier] || claimData.periodNullifier == data.inputNullifiers[0]) {
      revert NullifierAlreadySpent();
    }
    if (!RECEIVE_REGISTRY.validateBudgetRoleStatus(claimData.issuanceRoot,
        claimData.childRoleIndex, claimData.endorsementRoleIndex, claimData.trustedRoleIndex)) revert InvalidReceiveProof();
    uint256[] memory signals = new uint256[](23);
    signals[0] = block.chainid; signals[1] = uint256(uint160(address(this)));
    signals[2] = record.codeAlias; signals[3] = record.nonce; signals[4] = record.ownerCommitment;
    signals[5] = record.viewKeyLo; signals[6] = record.viewKeyHi; signals[7] = record.policyCommitment;
    signals[8] = claimData.budgetKey; signals[9] = record.eligibleFrom;
    signals[10] = claimData.asOf; signals[11] = data.inputRoots[0];
    signals[12] = data.inputNullifiers[0]; signals[13] = claimData.periodNullifier;
    signals[14] = data.outputCommitments[0]; signals[15] = data.outputCommitments[1];
    signals[16] = _ciphertextHash(data.outputCiphertexts[0]);
    signals[17] = _ciphertextHash(data.outputCiphertexts[1]);
    signals[18] = uint256(uint160(address(RECEIVE_REGISTRY)));
    signals[19] = claimData.issuanceRoot;
    signals[20] = claimData.childRoleIndex;
    signals[21] = claimData.endorsementRoleIndex;
    signals[22] = claimData.trustedRoleIndex;
    if (!CLAIM_VERIFIER.verifyProof(proof, signals)) revert InvalidZKProof();
    _spendInputs(data);
    _spendNullifier(claimData.periodNullifier);
    _appendOutputs(Action.Claim, data);
  }

  function transfer(
    IReceiveRegistry.Code calldata code, bytes calldata codeProof,
    ActionData calldata data, bytes calldata proof
  ) external nonReentrant {
    _validateSingleInputAction(data);
    if (!RECEIVE_REGISTRY.verifyReceive(code, codeProof)) revert InvalidReceiveProof();
    uint256[] memory signals = new uint256[](12);
    signals[0] = block.chainid; signals[1] = uint256(uint160(address(this)));
    signals[2] = code.commonBinding; signals[3] = code.ownerCommitment;
    signals[4] = code.viewKeyLo; signals[5] = code.viewKeyHi;
    _actionSignals(signals, 6, data);
    if (!TRANSFER_VERIFIER.verifyProof(proof, signals)) revert InvalidZKProof();
    _spendInputs(data);
    _appendOutputs(Action.Transfer, data);
  }

  function _actionSignals(uint256[] memory signals, uint256 offset, ActionData calldata data) private pure {
    signals[offset] = data.inputRoots[0]; signals[offset + 1] = data.inputNullifiers[0];
    signals[offset + 2] = data.outputCommitments[0]; signals[offset + 3] = data.outputCommitments[1];
    signals[offset + 4] = _ciphertextHash(data.outputCiphertexts[0]);
    signals[offset + 5] = _ciphertextHash(data.outputCiphertexts[1]);
  }

  function _validateSingleInputAction(ActionData calldata data) private view {
    _validateAction(data, 1);
  }

  function _validateAction(ActionData calldata data, uint256 inputCount) private view {
    if (data.inputShardIds.length != inputCount || data.inputRoots.length != inputCount ||
        data.inputNullifiers.length != inputCount) revert InvalidActionData();
    for (uint256 i; i < inputCount; ++i) {
      if (data.inputShardIds[i] > type(uint128).max) revert InvalidFieldElement();
      _nonzero(data.inputRoots[i]);
      _nonzero(data.inputNullifiers[i]);
      if (!_shards[data.inputShardIds[i]].knownRoots[data.inputRoots[i]]) revert UnknownNoteRoot();
      if (nullifierSpent[data.inputNullifiers[i]]) revert NullifierAlreadySpent();
      for (uint256 j; j < i; ++j) {
        if (data.inputNullifiers[i] == data.inputNullifiers[j]) revert NullifierAlreadySpent();
      }
    }
    for (uint256 i; i < 2; ++i) {
      _nonzero(data.outputCommitments[i]);
      if (data.outputCiphertexts[i].length != CIPHERTEXT_BYTES) revert InvalidCiphertext();
      if (commitmentExists[data.outputCommitments[i]]) revert DuplicateCommitment();
    }
    if (data.outputCommitments[0] == data.outputCommitments[1]) revert DuplicateCommitment();
  }

  /// @dev VALUE boundary relations contain exactly 7, 11 or 20 public fields.
  ///      No receive authorization or qualification state participates in this route.
  function _verifyBoundary(Action action, ActionData calldata data, bytes calldata proof,
    uint256 amount, address recipient) internal view {
    bool isShield = action == Action.Shield;
    uint256 inputs = data.inputNullifiers.length;
    if (isShield) {
      _validateAction(data, 0);
    } else {
      if (action != Action.Unshield || (inputs != 1 && inputs != 4)) revert InvalidActionData();
      _validateAction(data, inputs);
    }
    uint256[] memory signals = new uint256[](isShield
      ? ProofConstants.SHIELDED_SHIELD_PUBLIC_SIGNALS_LEN
      : (inputs == 1 ? ProofConstants.SHIELDED_UNSHIELD_PUBLIC_SIGNALS_LEN
        : ProofConstants.SHIELDED_UNSHIELD_4_PUBLIC_SIGNALS_LEN));
    uint256 n;
    signals[n++] = block.chainid;
    signals[n++] = uint256(uint160(address(this)));
    if (!isShield) {
      for (uint256 i; i < inputs; ++i) signals[n++] = data.inputShardIds[i];
      for (uint256 i; i < inputs; ++i) signals[n++] = data.inputRoots[i];
      for (uint256 i; i < inputs; ++i) signals[n++] = data.inputNullifiers[i];
    }
    signals[n++] = data.outputCommitments[0];
    signals[n++] = data.outputCommitments[1];
    signals[n++] = _ciphertextHash(data.outputCiphertexts[0]);
    signals[n++] = _ciphertextHash(data.outputCiphertexts[1]);
    signals[n++] = amount;
    if (!isShield) signals[n] = uint256(uint160(recipient));
    if (!VERIFIER.verifyProof(isShield ? ProofConstants.PROOF_PURPOSE_SHIELDED_SHIELD
        : ProofConstants.PROOF_PURPOSE_SHIELDED_UNSHIELD,
        ProofConstants.PROOF_ENCODING_ID_ABI_GROTH16_ABC, proof, signals)) revert InvalidZKProof();
  }

  function _spendInputs(ActionData calldata data) private {
    for (uint256 i; i < data.inputNullifiers.length; ++i) _spendNullifier(data.inputNullifiers[i]);
  }

  function _spendNullifier(uint256 nullifier) private {
    if (nullifierSpent[nullifier]) revert NullifierAlreadySpent();
    nullifierSpent[nullifier] = true;
    ++nullifierCount;
    emit NullifierSpent(nullifier);
  }

  function _appendOutputs(Action action, ActionData calldata data) internal {
    emit ActionExecuted(
      uint8(action),
      data.inputShardIds.length == 0 ? 0 : data.inputShardIds[0],
      data.inputShardIds.length > 1 ? data.inputShardIds[1] : (data.inputShardIds.length == 0 ? 0 : data.inputShardIds[0])
    );
    commitmentExists[data.outputCommitments[0]] = true;
    _append(data.outputCommitments[0], data.outputCiphertexts[0]);
    commitmentExists[data.outputCommitments[1]] = true;
    _append(data.outputCommitments[1], data.outputCiphertexts[1]);
    // Both outputs land in one shard: shards start empty, every action appends two leaves and
    // MAX_SHARD_LEAVES is even. Accepting only this completed root keeps a new shard's one-leaf
    // root, which equals its first commitment, from revealing the note a proof spends.
    Shard storage shard = _shards[currentShardId];
    shard.knownRoots[shard.root] = true;
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

  function _ciphertextHash(bytes calldata ciphertext) private pure returns (uint256) {
    return uint256(keccak256(ciphertext)) % SNARK_SCALAR_FIELD;
  }
  function _nonzero(uint256 value) private pure {
    if (value == 0 || value >= SNARK_SCALAR_FIELD) revert InvalidFieldElement();
  }
}

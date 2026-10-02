// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
import {IDeepFamilyLineageIndex} from "./interfaces/IDeepFamilyLineageIndex.sol";
import {IDeepFamilyPublicInheritance} from "./interfaces/IDeepFamilyPublicInheritance.sol";
import {IProofVerifierAdapter} from "./interfaces/IProofVerifierAdapter.sol";
import {ProofConstants} from "./libraries/ProofConstants.sol";

/**
 * @title ShieldedDeepPool
 * @notice Append-only, sharded Poseidon note tree and one-time nullifier registry for DEEP.
 *         Private note actions keep inheritance identifiers and policy balances hidden.
 *         Public budgets expose their family identifiers, terms and remaining balances.
 * @dev One immutable shared adapter selects the matching circuit for each action. The circuits
 *      enforce input ownership, value conservation, permitted note transitions and binding of
 *      notes to ciphertext hashes. On-chain token conservation at shield/unshield boundaries
 *      relies on those private constraints for all internal transitions. Recipients share
 *      self-authenticating receive codes off-chain; the pool keeps no key registry.
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
  error InvalidClaimTime();
  error InvalidZKProof();
  error UnexpectedTokenTransfer();
  error InvalidLeafIndex();
  error UnknownPublicBudget();
  error InvalidPublicBudgetData();
  error IneligiblePublicBeneficiary();
  error PublicBudgetNotMature();
  error InsufficientPublicBudget();

  enum Action {
    Shield,
    Fund,
    Claim,
    PrivateTransfer,
    Unshield,
    ClaimPublic
  }

  /**
   * @notice All actions use two output slots and two input slots. Initial Fund and
   *         single-input Claim/PrivateTransfer repeat the first shard and root;
   *         Unshield has one proved input and repeats its shard and root.
   */
  struct ActionData {
    uint256[2] inputShardIds;
    uint256[2] inputRoots;
    uint256[2] inputNullifiers;
    uint256[12] periodNullifiers;
    uint256[2] outputCommitments;
    bytes[2] outputCiphertexts;
    // Initial Fund/Claim: current endorsement/trusted roots.
    uint256 relation0;
    uint256 relation1;
    uint256 asOf;
    // Fund only: 0 starts an enrollment; 1 continues a historical enrollment.
    uint256 fundMode;
  }

  struct Shard {
    uint256 size;
    uint256 depth;
    uint256 root;
    mapping(uint256 level => mapping(uint256 index => uint256 node)) nodes;
    mapping(uint256 root => bool known) knownRoots;
    mapping(uint256 root => uint256 size) rootSizes;
  }

  struct PublicFundingData {
    uint64 budgetId;
    bytes32 rootPersonHash;
    uint64 rootVersionIndex;
    bytes32 heirPersonHash;
    uint128 amountPerPeriod;
    uint64 budgetPeriods;
    uint64 heirVersionIndex;
    address endorser;
  }

  struct PublicClaimData {
    uint64 budgetId;
    uint64 firstPeriod;
    uint8 claimCount;
    uint64 heirVersionIndex;
    address endorser;
    uint256[2] outputCommitments;
    bytes[2] outputCiphertexts;
  }

  struct PublicBudget {
    address createdBy;
    bytes32 rootPersonHash;
    uint64 rootVersionIndex;
    bytes32 heirPersonHash;
    uint128 amountPerPeriod;
    uint64 eligibleFrom;
    uint128 remaining;
    uint64 nextPeriod;
  }

  uint256 public constant NOTE_TREE_DEPTH = 32;
  uint256 public constant MAX_SHARD_LEAVES = uint256(1) << NOTE_TREE_DEPTH;
  uint256 public constant CIPHERTEXT_BYTES = 512;
  uint256 public constant ACTION_PROOF_LIFETIME = 2 hours;
  uint256 public constant SNARK_SCALAR_FIELD =
    21888242871839275222246405745257275088548364400416034343698204186575808495617;

  IERC20 public immutable TOKEN;
  IDeepFamilyLineageIndex public immutable LINEAGE_INDEX;
  IProofVerifierAdapter public immutable VERIFIER;

  uint256 public currentShardId;
  uint256 public totalShielded;
  uint256 public totalPublicBudget;
  uint64 public publicBudgetCount;
  mapping(uint64 budgetId => PublicBudget budget) public publicBudgets;
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
  event PublicBudgetFunded(
    uint64 indexed budgetId,
    bytes32 indexed heirPersonHash,
    address indexed funder,
    bytes32 rootPersonHash,
    uint64 rootVersionIndex,
    uint128 amountPerPeriod,
    uint64 eligibleFrom,
    uint128 amount,
    uint128 remaining
  );
  event PublicBudgetClaimed(
    uint64 indexed budgetId,
    bytes32 indexed heirPersonHash,
    uint64 firstPeriod,
    uint8 claimCount,
    uint128 amount,
    uint128 remaining
  );

  /**
   * @param verifier The shared Groth16 adapter configured with all six pool action verifiers.
   */
  constructor(address token, address lineageIndex, address verifier) {
    if (token.code.length == 0 || lineageIndex.code.length == 0 || verifier.code.length == 0) {
      revert InvalidConstructorAddress();
    }
    TOKEN = IERC20(token);
    LINEAGE_INDEX = IDeepFamilyLineageIndex(lineageIndex);
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

  /** @dev Initial Fund enforces eligibleFrom == asOf + ACTION_PROOF_LIFETIME. */
  function fund(ActionData calldata data, bytes calldata proof) external nonReentrant {
    _privateAction(Action.Fund, data, proof);
  }

  /**
   * @notice Produces shielded output notes only; no ordinary wallet receives DEEP here.
   * @dev The Claim circuit uses complete 30-day periods from the per-heir eligibility start.
   *      The start is a private witness but is derivable from the initial fund's public asOf.
   *      The one-time initial enrollment tag prevents competing starts for a policy and heir.
   */
  function claim(ActionData calldata data, bytes calldata proof) external nonReentrant {
    _privateAction(Action.Claim, data, proof);
  }

  function privateTransfer(ActionData calldata data, bytes calldata proof) external nonReentrant {
    _privateAction(Action.PrivateTransfer, data, proof);
  }

  /** @notice Fund a public arrangement without asking the beneficiary for payment keys. */
  function fundPublic(PublicFundingData calldata funding) external nonReentrant {
    if (funding.amountPerPeriod == 0 || funding.budgetPeriods == 0) {
      revert InvalidPublicBudgetData();
    }
    uint256 amount = uint256(funding.amountPerPeriod) * funding.budgetPeriods;
    if (amount > type(uint128).max) revert InvalidPublicBudgetData();
    uint64 budgetId = funding.budgetId;
    if (budgetId == 0) {
      _requirePublicLineage(
        funding.rootPersonHash,
        funding.rootVersionIndex,
        funding.heirPersonHash,
        funding.heirVersionIndex,
        funding.endorser
      );
      uint256 eligibleFrom = block.timestamp + ACTION_PROOF_LIFETIME;
      if (eligibleFrom > type(uint64).max) revert InvalidPublicBudgetData();
      budgetId = ++publicBudgetCount;
      publicBudgets[budgetId] = PublicBudget({
        createdBy: msg.sender,
        rootPersonHash: funding.rootPersonHash,
        rootVersionIndex: funding.rootVersionIndex,
        heirPersonHash: funding.heirPersonHash,
        amountPerPeriod: funding.amountPerPeriod,
        eligibleFrom: uint64(eligibleFrom),
        remaining: 0,
        nextPeriod: 0
      });
    } else {
      PublicBudget storage existing = publicBudgets[budgetId];
      if (existing.createdBy == address(0)) revert UnknownPublicBudget();
      if (
        funding.rootPersonHash != existing.rootPersonHash ||
        funding.rootVersionIndex != existing.rootVersionIndex ||
        funding.heirPersonHash != existing.heirPersonHash ||
        funding.amountPerPeriod != existing.amountPerPeriod ||
        funding.heirVersionIndex != 0 ||
        funding.endorser != address(0)
      ) {
        revert InvalidPublicBudgetData();
      }
    }
    PublicBudget storage budget = publicBudgets[budgetId];
    uint256 remaining = uint256(budget.remaining) + amount;
    if (remaining > type(uint128).max) revert InvalidPublicBudgetData();
    uint256 beforeBalance = TOKEN.balanceOf(address(this));
    TOKEN.safeTransferFrom(msg.sender, address(this), amount);
    if (TOKEN.balanceOf(address(this)) - beforeBalance != amount) {
      revert UnexpectedTokenTransfer();
    }
    budget.remaining = uint128(remaining);
    totalPublicBudget += amount;
    emit PublicBudgetFunded(
      budgetId,
      budget.heirPersonHash,
      msg.sender,
      budget.rootPersonHash,
      budget.rootVersionIndex,
      budget.amountPerPeriod,
      budget.eligibleFrom,
      uint128(amount),
      budget.remaining
    );
  }

  /** @notice Claim sequential public periods into privately owned VALUE notes. */
  function claimPublic(PublicClaimData calldata data, bytes calldata proof) external nonReentrant {
    PublicBudget storage budget = publicBudgets[data.budgetId];
    if (budget.createdBy == address(0)) revert UnknownPublicBudget();
    uint256 nextPeriod = uint256(data.firstPeriod) + data.claimCount;
    if (
      data.firstPeriod != budget.nextPeriod ||
      data.claimCount == 0 ||
      data.claimCount > 12 ||
      nextPeriod > type(uint64).max
    ) {
      revert InvalidPublicBudgetData();
    }
    if (uint256(budget.eligibleFrom) + nextPeriod * 30 days > block.timestamp) {
      revert PublicBudgetNotMature();
    }
    uint256 amount = uint256(budget.amountPerPeriod) * data.claimCount;
    if (amount > budget.remaining) revert InsufficientPublicBudget();
    uint256 identityCommitment = _requirePublicLineage(
      budget.rootPersonHash,
      budget.rootVersionIndex,
      budget.heirPersonHash,
      data.heirVersionIndex,
      data.endorser
    );
    uint256[] memory signals = new uint256[](
      ProofConstants.SHIELDED_CLAIM_PUBLIC_PUBLIC_SIGNALS_LEN
    );
    signals[0] = block.chainid;
    signals[1] = uint256(uint160(address(this)));
    signals[2] = data.budgetId;
    signals[3] = identityCommitment;
    signals[4] = data.firstPeriod;
    signals[5] = data.claimCount;
    signals[6] = amount;
    for (uint256 i = 0; i < 2; ++i) {
      _requireNonzeroField(data.outputCommitments[i]);
      if (commitmentExists[data.outputCommitments[i]]) revert DuplicateCommitment();
      if (data.outputCiphertexts[i].length != CIPHERTEXT_BYTES) revert InvalidCiphertext();
      signals[7 + i] = data.outputCommitments[i];
      signals[9 + i] = uint256(keccak256(data.outputCiphertexts[i])) % SNARK_SCALAR_FIELD;
    }
    if (data.outputCommitments[0] == data.outputCommitments[1]) revert DuplicateCommitment();
    for (uint256 i = 0; i < signals.length; ++i) _requireField(signals[i]);
    if (
      !VERIFIER.verifyProof(
        ProofConstants.PROOF_PURPOSE_SHIELDED_CLAIM_PUBLIC,
        ProofConstants.PROOF_ENCODING_ID_ABI_GROTH16_ABC,
        proof,
        signals
      )
    ) revert InvalidZKProof();
    budget.remaining -= uint128(amount);
    budget.nextPeriod = uint64(nextPeriod);
    totalPublicBudget -= amount;
    totalShielded += amount;
    emit PublicBudgetClaimed(
      data.budgetId,
      budget.heirPersonHash,
      data.firstPeriod,
      data.claimCount,
      uint128(amount),
      budget.remaining
    );
    emit ActionExecuted(uint8(Action.ClaimPublic), 0, 0);
    for (uint256 i = 0; i < 2; ++i) {
      commitmentExists[data.outputCommitments[i]] = true;
      _append(data.outputCommitments[i], data.outputCiphertexts[i]);
    }
  }

  function _requirePublicLineage(
    bytes32 rootHash,
    uint64 rootVersion,
    bytes32 heirHash,
    uint64 heirVersion,
    address endorser
  ) private view returns (uint256 identity) {
    if (
      rootHash == bytes32(0) ||
      heirHash == bytes32(0) ||
      rootVersion == 0 ||
      heirVersion == 0 ||
      endorser == address(0)
    ) revert IneligiblePublicBeneficiary();
    IDeepFamilyPublicInheritance family = IDeepFamilyPublicInheritance(LINEAGE_INDEX.DEEP_FAMILY());
    if (
      rootVersion > family.personVersionsCount(rootHash) ||
      heirVersion > family.personVersionsCount(heirHash) ||
      family.endorsedVersionIndex(heirHash, endorser) != heirVersion ||
      !family.trustedEndorserOf(rootHash, rootVersion, endorser)
    ) revert IneligiblePublicBeneficiary();
    IDeepFamilyPublicInheritance.PersonVersion memory version = family.personVersionAt(
      heirHash,
      heirVersion - 1
    );
    if (
      version.personHash != heirHash ||
      (version.fatherHash != rootHash && version.motherHash != rootHash)
    ) {
      revert IneligiblePublicBeneficiary();
    }
    identity = LINEAGE_INDEX.identityCommitmentOf(heirHash);
    _requireNonzeroField(identity);
    if (keccak256(abi.encodePacked(bytes32(identity))) != heirHash)
      revert IneligiblePublicBeneficiary();
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
    bool isInitialFund = action == Action.Fund && data.fundMode == 0;
    if (action == Action.Fund) {
      if (data.fundMode > 1) revert InvalidActionData();
    } else if (data.fundMode != 0) revert InvalidActionData();
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
    if (
      (_inputCount(action) == 1 || isInitialFund) &&
      (data.inputShardIds[1] != data.inputShardIds[0] || data.inputRoots[1] != data.inputRoots[0])
    ) revert InvalidActionData();

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
    } else if (isInitialFund) {
      _requireNonzeroField(data.relation0);
      _requireNonzeroField(data.relation1);
      if (data.relation0 != LINEAGE_INDEX.root(0) || data.relation1 != LINEAGE_INDEX.root(1))
        revert UnknownLineageRoot();
    } else if (data.relation0 != 0 || data.relation1 != 0) {
      revert InvalidActionData();
    }
    if (isClaim || isInitialFund) {
      if (data.asOf > block.timestamp || block.timestamp - data.asOf >= ACTION_PROOF_LIFETIME) {
        revert InvalidClaimTime();
      }
    } else if (data.asOf != 0) {
      revert InvalidActionData();
    }

    uint256[] memory signals = _publicSignals(action, data, amount, recipient);
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

  /**
   * @dev Each circuit proves only the inputs its action uses, in this order. Mirrors
   *      SHIELDED_POOL_PUBLIC_INPUTS in packages/protocol-core/shielded-signals.js; the adapter
   *      rejects a length that differs from ProofConstants.
   */
  function _publicSignals(
    Action action,
    ActionData calldata data,
    uint256 amount,
    address recipient
  ) private view returns (uint256[] memory signals) {
    uint256 inputs = _inputCount(action);
    bool isClaim = action == Action.Claim;
    bool hasLineage = isClaim || action == Action.Fund;
    bool hasAmount = action == Action.Shield || action == Action.Unshield;
    bool hasRecipient = action == Action.Unshield;
    signals = new uint256[](
      6 +
        (inputs == 0 ? 0 : 2 * inputs + 2) +
        (isClaim ? 12 : 0) +
        (action == Action.Fund ? 1 : 0) +
        (hasAmount ? 1 : 0) +
        (hasRecipient ? 1 : 0) +
        (hasLineage ? 3 : 0)
    );
    uint256 n;
    signals[n++] = block.chainid;
    signals[n++] = uint256(uint160(address(this)));
    if (action == Action.Fund) signals[n++] = data.fundMode;
    for (uint256 i = 0; i < inputs; ++i) signals[n++] = data.inputShardIds[i];
    for (uint256 i = 0; i < inputs; ++i) signals[n++] = data.inputRoots[i];
    if (inputs != 0) {
      signals[n++] = data.inputNullifiers[0];
      signals[n++] = data.inputNullifiers[1];
    }
    if (isClaim) {
      for (uint256 i = 0; i < 12; ++i) signals[n++] = data.periodNullifiers[i];
    }
    signals[n++] = data.outputCommitments[0];
    signals[n++] = data.outputCommitments[1];
    signals[n++] = uint256(keccak256(data.outputCiphertexts[0])) % SNARK_SCALAR_FIELD;
    signals[n++] = uint256(keccak256(data.outputCiphertexts[1])) % SNARK_SCALAR_FIELD;
    if (hasAmount) signals[n++] = amount;
    if (hasRecipient) signals[n++] = uint256(uint160(recipient));
    if (hasLineage) {
      signals[n++] = data.relation0;
      signals[n++] = data.relation1;
      signals[n++] = data.asOf;
    }
  }

  /** @dev Fund/Claim prove two root slots; only Unshield has one public input root. */
  function _inputCount(Action action) private pure returns (uint256) {
    if (action == Action.Shield) return 0;
    if (action == Action.Unshield) {
      return 1;
    }
    return 2;
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

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IDeepFamilyLineageIndex} from "./interfaces/IDeepFamilyLineageIndex.sol";

/** @dev Groth16/BN254 verifier generated from `circuits/family_inheritance_claim.circom`. */
interface IGroth16InheritanceClaimVerifier {
  function verifyProof(
    uint256[2] calldata a,
    uint256[2][2] calldata b,
    uint256[2] calldata c,
    uint256[6] calldata publicSignals
  ) external view returns (bool);
}

/**
 * @title FamilyInheritance
 * @notice Holds DEEP set aside for a root ancestor's direct children. A deposit names only an
 *         opaque credential derived from the root's secret; every 30-day period a legit child
 *         proves in zero knowledge that a trusted endorser of the root version endorsed their
 *         version, without revealing which child they are.
 * @dev Nothing here has legal effect. There is no owner or administrator, and deposits can never
 *      be withdrawn by whoever made them. Legitimacy is read from DeepFamily's lineage index.
 */
contract FamilyInheritance is ReentrancyGuardTransient {
  using SafeERC20 for IERC20;

  error InvalidConstructorAddress();
  error InvalidCredential();
  error InvalidAmount();
  error InheritanceNotFound();
  error InvalidRecipient();
  error UnknownLineageRoot();
  error InvalidEligibility();
  error MalformedProofData();
  error InvalidZKProof();
  error NothingToClaim();

  struct Inheritance {
    uint256 credential;
    uint64 startTime;
    uint192 amountPerPeriod;
    uint256 balance;
  }

  /// @notice Values the claim proof binds, in the circuit's public-signal order after the roots.
  struct ClaimSignals {
    uint256 endorsementRoot;
    uint256 trustedRoot;
    uint256 claimTag;
    uint256 eligibleFrom;
    address recipient;
  }

  uint256 public constant PERIOD = 30 days;
  uint256 internal constant SNARK_SCALAR_FIELD =
    21888242871839275222246405745257275088548364400416034343698204186575808495617;
  // 256 bytes = 32 * (2 + 4 + 2) for abi.encode(uint256[2], uint256[2][2], uint256[2]).
  uint256 internal constant GROTH16_ABC_PAYLOAD_LENGTH = 256;
  uint8 internal constant ENDORSEMENT_TREE = 0;
  uint8 internal constant TRUSTED_TREE = 1;

  IERC20 public immutable TOKEN;
  IDeepFamilyLineageIndex public immutable LINEAGE_INDEX;
  IGroth16InheritanceClaimVerifier public immutable CLAIM_VERIFIER;

  uint256 public inheritanceCount;
  mapping(uint256 id => Inheritance) private _inheritances;
  /// @notice Amount already paid to one heir pseudonym (claim tag) from one inheritance.
  mapping(uint256 id => mapping(uint256 claimTag => uint256 amount)) public claimed;

  event InheritanceCreated(
    uint256 indexed id,
    uint256 indexed credential,
    address indexed creator,
    uint256 startTime,
    uint256 amountPerPeriod,
    uint256 amount
  );
  event InheritanceDeposited(uint256 indexed id, address indexed depositor, uint256 amount);
  event InheritanceClaimed(
    uint256 indexed id,
    uint256 indexed claimTag,
    address indexed recipient,
    uint256 amount
  );

  constructor(address token, address lineageIndex, address claimVerifier) {
    if (token.code.length == 0 || lineageIndex.code.length == 0 || claimVerifier.code.length == 0) {
      revert InvalidConstructorAddress();
    }
    TOKEN = IERC20(token);
    LINEAGE_INDEX = IDeepFamilyLineageIndex(lineageIndex);
    CLAIM_VERIFIER = IGroth16InheritanceClaimVerifier(claimVerifier);
  }

  /**
   * @notice Open an inheritance for the root named by `credential`. Ids are sequential, so copying
   *         a credential from the mempool only opens a separate inheritance funded by the copier.
   */
  function createInheritance(
    uint256 credential,
    uint256 amountPerPeriod,
    uint256 amount
  ) external nonReentrant returns (uint256 id) {
    if (credential == 0 || credential >= SNARK_SCALAR_FIELD) revert InvalidCredential();
    if (amountPerPeriod == 0 || amountPerPeriod > type(uint192).max || amount == 0) {
      revert InvalidAmount();
    }
    id = ++inheritanceCount;
    _inheritances[id] = Inheritance({
      credential: credential,
      startTime: uint64(block.timestamp),
      amountPerPeriod: uint192(amountPerPeriod),
      balance: amount
    });
    TOKEN.safeTransferFrom(msg.sender, address(this), amount);
    emit InheritanceCreated(id, credential, msg.sender, block.timestamp, amountPerPeriod, amount);
  }

  /// @notice Anyone may add to an existing inheritance; nobody can take a deposit back out.
  function deposit(uint256 id, uint256 amount) external nonReentrant {
    if (amount == 0) revert InvalidAmount();
    Inheritance storage inheritance = _existing(id);
    inheritance.balance += amount;
    TOKEN.safeTransferFrom(msg.sender, address(this), amount);
    emit InheritanceDeposited(id, msg.sender, amount);
  }

  /**
   * @notice Pay everything the heir behind `claimTag` has accrued and not yet received. When the
   *         balance falls short, the remainder stays owed and becomes claimable after a deposit.
   */
  function claim(
    uint256 id,
    ClaimSignals calldata signals,
    bytes calldata proof
  ) external nonReentrant returns (uint256 amount) {
    Inheritance storage inheritance = _existing(id);
    if (signals.recipient == address(0)) revert InvalidRecipient();
    if (
      !LINEAGE_INDEX.isKnownRoot(ENDORSEMENT_TREE, signals.endorsementRoot) ||
      !LINEAGE_INDEX.isKnownRoot(TRUSTED_TREE, signals.trustedRoot)
    ) {
      revert UnknownLineageRoot();
    }
    uint256 startTime = inheritance.startTime;
    if (
      signals.eligibleFrom < startTime ||
      (signals.eligibleFrom - startTime) % PERIOD != 0 ||
      signals.eligibleFrom > block.timestamp
    ) {
      revert InvalidEligibility();
    }
    _verifyClaimProof(inheritance.credential, signals, proof);

    uint256 entitlement = uint256(inheritance.amountPerPeriod) *
      ((block.timestamp - signals.eligibleFrom) / PERIOD + 1);
    uint256 alreadyClaimed = claimed[id][signals.claimTag];
    if (entitlement <= alreadyClaimed) revert NothingToClaim();
    amount = entitlement - alreadyClaimed;
    if (amount > inheritance.balance) amount = inheritance.balance;
    if (amount == 0) revert NothingToClaim();

    claimed[id][signals.claimTag] = alreadyClaimed + amount;
    inheritance.balance -= amount;
    TOKEN.safeTransfer(signals.recipient, amount);
    emit InheritanceClaimed(id, signals.claimTag, signals.recipient, amount);
  }

  function inheritanceOf(uint256 id) external view returns (Inheritance memory) {
    return _existing(id);
  }

  function _existing(uint256 id) private view returns (Inheritance storage inheritance) {
    inheritance = _inheritances[id];
    if (inheritance.startTime == 0) revert InheritanceNotFound();
  }

  function _verifyClaimProof(
    uint256 credential,
    ClaimSignals calldata signals,
    bytes calldata proof
  ) private view {
    if (proof.length != GROTH16_ABC_PAYLOAD_LENGTH) revert MalformedProofData();
    (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = abi.decode(
      proof,
      (uint256[2], uint256[2][2], uint256[2])
    );
    // Six signals: ProofConstants.INHERITANCE_CLAIM_PUBLIC_SIGNALS_LEN.
    uint256[6] memory publicSignals = [
      signals.endorsementRoot,
      signals.trustedRoot,
      credential,
      signals.claimTag,
      signals.eligibleFrom,
      uint256(uint160(signals.recipient))
    ];
    if (!CLAIM_VERIFIER.verifyProof(a, b, c, publicSignals)) revert InvalidZKProof();
  }
}

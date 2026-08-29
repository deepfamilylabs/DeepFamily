// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "poseidon-solidity/PoseidonT5.sol";
import {IMetadataArchiveV1} from "./interfaces/IMetadataArchiveV1.sol";
import {IProofVerifierAdapter} from "./interfaces/IProofVerifierAdapter.sol";
import {IStoryArchiveV1} from "./interfaces/IStoryArchiveV1.sol";
import {AdultAgeGate} from "./libraries/AdultAgeGate.sol";
import {ProofConstants} from "./libraries/ProofConstants.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/**
 * @dev DeepFamily Token Contract Interface
 */
interface IDeepFamilyToken {
  function mint(address to) external returns (uint256 reward);
  function recentReward() external view returns (uint256);
  function transferFrom(address from, address to, uint256 amount) external returns (bool);
  function burnFrom(address account, uint256 amount) external;
}

/**
 * @title DeepFamily — Zero-Knowledge Decentralized Family Tree Protocol
 * @notice Verifiable global family lineages through ZK proofs, multi-version management, community endorsement, and NFT assets
 * @dev Architecture:
 *      - Privacy Layer: Groth16 proofs + Poseidon/keccak256 dual-hash for private submissions
 *      - Incentive Layer: DEEP token mining for complete families, endorsement fees route to NFT holders/contributors
 *      - Asset Layer: Endorsed versions mint to NFTs with on-chain bio data + unlimited story sharding
 */
contract DeepFamily is
  Initializable,
  ERC721EnumerableUpgradeable,
  OwnableUpgradeable,
  ReentrancyGuardTransient,
  UUPSUpgradeable
{
  // ========== Custom Errors (Unified Error Handling) ==========

  // Input validation errors
  error InvalidPersonHash();
  error InvalidFatherVersionIndex();
  error InvalidMotherVersionIndex();
  error InvalidVersionIndex();
  error InvalidFullName();
  error InvalidBirthPlace();
  error InvalidDeathPlace();
  error InvalidDeathMonth();
  error InvalidDeathDay();
  error InvalidBirthMonth();
  error InvalidBirthDay();
  error InvalidBirthYear();
  error InvalidStory();
  error InvalidTokenURI();
  error InvalidZKProof();
  error InvalidVerifierAddress();
  error InvalidCircuitId();
  error VerifierRouteAlreadySet();
  error VerifierRouteNotSet();
  error UnsupportedProofEncoding();
  error MalformedProofData();

  // Business logic errors
  error DuplicateVersionCommitment();
  error MustEndorseVersionFirst();
  error VersionAlreadyMinted();
  error BasicInfoMismatch();
  error CallerMismatch();
  error CallerOrIdentitySuiteMismatch();
  error InvalidParentHash();
  error MustBeAdult();
  error InvalidMetadataArchive();
  error MetadataArchiveAlreadySet();
  error MetadataArchiveNotSet();
  error InvalidMetadataEnvelope();
  error InvalidEnvelopePrefix();
  error InvalidIdentitySuite();
  error InvalidStoryArchive();
  error StoryArchiveAlreadySet();

  // Token-related errors
  error TokenContractNotSet();
  error EndorsementFeeTransferFailed();
  error ProtocolFeeTooHigh();
  error AlreadyEndorsed();
  error NotEndorsed();
  error InvalidTrustedEndorser();
  error TrustedEndorserAlreadyAdded();
  error TrustedEndorserNotFound();
  error MustBeTrustedEndorserManager();

  // Query-related errors
  error PageSizeExceedsLimit();
  error DirectNativeCurrencyNotAccepted();

  error MustBeNFTHolder();

  /**
   * @dev Basic identity information structure.
   * `identityCommitment` stores the bytes32 representation of IdentityCommitment.
   */
  struct PersonBasicInfo {
    bytes32 identityCommitment;
    bool isBirthBC;
    uint16 birthYear;
    uint8 birthMonth;
    uint8 birthDay;
    uint8 gender;
  }

  struct PersonVersion {
    bytes32 personHash;
    bytes32 fatherHash;
    bytes32 motherHash;
    uint256 versionIndex;
    uint256 fatherVersionIndex;
    uint256 motherVersionIndex;
    uint256 versionCommitment;
    address addedBy;
    uint96 timestamp;
  }

  struct PersonSupplementInfo {
    string fullName;
    string birthPlace;
    bool isDeathBC;
    uint16 deathYear;
    uint8 deathMonth;
    uint8 deathDay;
    string deathPlace;
    string story;
  }

  struct PersonCoreInfo {
    PersonBasicInfo basicInfo;
    PersonSupplementInfo supplementInfo;
  }

  enum ProofPurpose {
    PersonRelation,
    DisclosureBinding
  }

  struct ProofEnvelope {
    uint32 circuitId;
    uint8 proofEncodingId;
    bytes proofData;
  }

  struct PersonProofPublicSignals {
    uint256 identityCommitment;
    uint256 fatherIdentityCommitment;
    uint256 motherIdentityCommitment;
    uint256 submitterAndSelfSuiteId;
    uint256 versionCommitment;
  }

  struct DisclosureBindingPublicSignals {
    uint256 identityCommitment;
    uint256 disclosureBinding;
    uint256 minter;
    uint256 suiteCommitment;
  }

  struct ChildRef {
    bytes32 childHash;
    uint256 childVersionIndex;
  }

  // ========== Core Storage Mappings ==========

  mapping(bytes32 => PersonVersion[]) public personVersions;
  uint256 public totalPersonsCount;
  mapping(bytes32 => mapping(bytes32 => bool)) public versionExists;
  mapping(bytes32 => mapping(address => uint256)) public endorsedVersionIndex;

  // ========== NFT Related ==========

  uint256 public tokenCounter;
  mapping(uint256 => bytes32) public tokenIdToPerson;
  mapping(uint256 => uint256) public tokenIdToVersionIndex;
  mapping(uint256 => PersonCoreInfo) public nftCoreInfo;
  mapping(uint256 => string) private _tokenURIs;
  mapping(uint256 => string[]) public tokenURIHistory;
  mapping(bytes32 => mapping(uint256 => uint256)) public versionToTokenId;

  // ========== Story Archive Binding ==========

  address public storyArchive;

  // ========== Statistics Mappings ==========

  mapping(bytes32 => mapping(uint256 => uint256)) public versionEndorsementCount;
  uint256 public protocolEndorsementFeeBps;
  mapping(bytes32 => mapping(uint256 => ChildRef[])) public childrenOf;
  mapping(address => bytes32[]) private userEndorsedPersons;
  mapping(address => mapping(bytes32 => uint256)) private userEndorsementIndex;

  // ========== System Constants ==========

  uint256 public constant MAX_LONG_TEXT_LENGTH = 256;
  uint256 public constant MAX_QUERY_PAGE_SIZE = 200;
  uint256 public constant PROTOCOL_FEE_BPS_MAX = 2000;
  uint256 public constant FEE_BPS_DENOMINATOR = 10_000;
  uint256 private constant DOMAIN_DISCLOSURE = 1003;
  string private constant DOMAIN_NAME_PREHASH = "deepfamily:name-prehash:v2";
  bytes32 internal constant VERSION_HASH_DOMAIN = keccak256("DeepFamily:VersionHash:v1");

  address public DEEP_FAMILY_TOKEN_CONTRACT;
  address public metadataArchive;
  mapping(uint8 purpose => mapping(uint32 circuitId => address adapter)) public verifierRegistry;
  mapping(bytes32 => mapping(uint256 => mapping(address => bool))) public trustedEndorserOf;
  mapping(bytes32 => mapping(uint256 => address[])) private trustedEndorsers;
  mapping(bytes32 => mapping(uint256 => mapping(address => uint256))) private trustedEndorserIndex;
  mapping(bytes32 => bool) public rewardClaimedByPerson;

  // NOTE: No storage gap. This is the most-derived (leaf) upgradeable contract and every
  // inherited base uses ERC-7201 namespaced storage, so a new implementation adds state simply
  // by declaring variables AFTER the ones above (append-only). scripts/check-storage-layout.mjs
  // enforces that each new layout is an append-only extension of the committed baseline.

  // ========== Event Definitions ==========

  event PersonVersionAdded(
    bytes32 indexed personHash,
    uint256 indexed versionIndex,
    address indexed addedBy,
    uint256 timestamp,
    bytes32 fatherHash,
    uint256 fatherVersionIndex,
    bytes32 motherHash,
    uint256 motherVersionIndex,
    uint256 versionCommitment
  );

  event PersonVersionEndorsed(
    bytes32 indexed personHash,
    address indexed endorser,
    uint256 versionIndex,
    address recipient,
    uint256 recipientShare,
    address protocolRecipient,
    uint256 protocolShare,
    uint256 endorsementFee,
    uint256 timestamp
  );

  event EndorsementCancelled(
    bytes32 indexed personHash,
    address indexed user,
    uint256 versionIndex,
    uint256 timestamp
  );

  event PersonHashZKVerified(bytes32 indexed personHash, address indexed prover);

  event PersonNFTMinted(
    bytes32 indexed personHash,
    uint256 indexed tokenId,
    address indexed owner,
    uint256 versionIndex,
    string tokenURI,
    uint256 timestamp
  );

  event TokenURIUpdated(
    uint256 indexed tokenId,
    address indexed owner,
    string oldURI,
    string newURI
  );

  event TokenRewardDistributed(
    address indexed miner,
    bytes32 indexed personHash,
    uint256 indexed versionIndex,
    uint256 reward
  );

  event EndorsementFeeUpdated(uint256 previousBps, uint256 newBps);

  event CircuitVerifierSet(
    uint8 indexed purpose,
    uint32 indexed circuitId,
    address indexed adapter
  );
  event MetadataArchiveSet(address indexed archive);
  event StoryArchiveSet(address indexed archive);

  event TrustedEndorserAdded(
    bytes32 indexed personHash,
    uint256 indexed versionIndex,
    address indexed account
  );

  event TrustedEndorserRemoved(
    bytes32 indexed personHash,
    uint256 indexed versionIndex,
    address indexed account
  );

  // ========== Function Modifiers ==========

  modifier validPersonAndVersion(bytes32 personHash, uint256 versionIndex) {
    if (personHash == bytes32(0)) revert InvalidPersonHash();
    if (versionIndex == 0 || versionIndex > personVersions[personHash].length) {
      revert InvalidVersionIndex();
    }
    _;
  }

  // ========== Internal Functions ==========

  /**
   * @dev Wrap raw Poseidon digest with keccak256 for domain separation and collision resistance.
   * Returns zero if input is zero (preserves semantics for non-existent parent hashes).
   */
  function _wrapPoseidonHash(bytes32 poseidonDigest) internal pure returns (bytes32) {
    if (poseidonDigest == bytes32(0)) return bytes32(0);
    return keccak256(abi.encodePacked(poseidonDigest));
  }

  function _hashString(string memory value) internal pure returns (bytes32) {
    return keccak256(abi.encodePacked(value));
  }

  function _getVerifier(uint32 circuitId, ProofPurpose purpose) internal view returns (address) {
    if (circuitId == 0) revert InvalidCircuitId();
    address verifier = verifierRegistry[uint8(purpose)][circuitId];
    if (verifier == address(0)) revert VerifierRouteNotSet();
    return verifier;
  }

  function _wrapIdentityCommitmentAsPersonHash(
    uint256 identityCommitment
  ) internal pure returns (bytes32) {
    return _wrapPoseidonHash(bytes32(identityCommitment));
  }

  function _packBirthGenderField(
    PersonBasicInfo calldata basicInfo
  ) internal pure returns (uint256) {
    return
      (uint256(basicInfo.birthYear) << 25) |
      (uint256(basicInfo.birthMonth) << 17) |
      (uint256(basicInfo.birthDay) << 9) |
      (uint256(basicInfo.gender) << 1) |
      (basicInfo.isBirthBC ? 1 : 0);
  }

  function _computeNamePrehash(string memory fullName) internal pure returns (bytes32) {
    if (bytes(fullName).length == 0) revert InvalidFullName();
    return keccak256(abi.encodePacked(DOMAIN_NAME_PREHASH, bytes(fullName)));
  }

  function _computeNameField(string memory fullName) internal pure returns (uint256) {
    uint256 fieldModulus = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    return uint256(_computeNamePrehash(fullName)) % fieldModulus;
  }

  function _computeDisclosureBinding(
    string memory fullName,
    PersonBasicInfo calldata basicInfo,
    uint256 suiteCommitment
  ) internal pure returns (bytes32) {
    uint256[4] memory inputs;
    inputs[0] = DOMAIN_DISCLOSURE;
    inputs[1] = _computeNameField(fullName);
    inputs[2] = _packBirthGenderField(basicInfo);
    inputs[3] = suiteCommitment;

    uint256 disclosurePoseidon = PoseidonT5.hash(inputs);
    return bytes32(disclosurePoseidon);
  }

  function _validateMintInput(
    bytes32 personHash,
    uint256 versionIndex,
    string calldata _tokenURI,
    PersonCoreInfo calldata coreInfo
  ) internal view {
    if (versionToTokenId[personHash][versionIndex] != 0) revert VersionAlreadyMinted();
    if (endorsedVersionIndex[personHash][msg.sender] != versionIndex) {
      revert MustEndorseVersionFirst();
    }

    if (bytes(_tokenURI).length > MAX_LONG_TEXT_LENGTH) revert InvalidTokenURI();
    if (bytes(coreInfo.supplementInfo.fullName).length == 0) revert InvalidFullName();
    if (bytes(coreInfo.supplementInfo.fullName).length > MAX_LONG_TEXT_LENGTH) {
      revert InvalidFullName();
    }
    if (bytes(coreInfo.supplementInfo.story).length > MAX_LONG_TEXT_LENGTH) revert InvalidStory();
    if (bytes(coreInfo.supplementInfo.birthPlace).length > MAX_LONG_TEXT_LENGTH) {
      revert InvalidBirthPlace();
    }
    if (bytes(coreInfo.supplementInfo.deathPlace).length > MAX_LONG_TEXT_LENGTH) {
      revert InvalidDeathPlace();
    }
    if (coreInfo.basicInfo.birthMonth > 12) revert InvalidBirthMonth();
    if (coreInfo.basicInfo.birthDay > 31) revert InvalidBirthDay();
    if (coreInfo.supplementInfo.deathMonth > 12) revert InvalidDeathMonth();
    if (coreInfo.supplementInfo.deathDay > 31) revert InvalidDeathDay();
  }

  function _verifyMintProof(
    ProofEnvelope calldata proof,
    DisclosureBindingPublicSignals calldata publicSignals
  ) internal view {
    address adapter = _getVerifier(proof.circuitId, ProofPurpose.DisclosureBinding);
    uint256[] memory ps = new uint256[](ProofConstants.DISCLOSURE_BINDING_PUBLIC_SIGNALS_LEN);
    ps[0] = publicSignals.identityCommitment;
    ps[1] = publicSignals.disclosureBinding;
    ps[2] = publicSignals.minter;
    ps[3] = publicSignals.suiteCommitment;

    if (
      !IProofVerifierAdapter(adapter).verifyProof(
        uint8(ProofPurpose.DisclosureBinding),
        proof.proofEncodingId,
        proof.proofData,
        ps
      )
    ) {
      revert InvalidZKProof();
    }
  }

  /**
   * @dev Validate mint proof-to-calldata binding consistency.
   * @notice String comparison is byte-exact; callers MUST submit the exact
   * canonicalized `coreInfo.supplementInfo.fullName` that was used to build the proof.
   * The contract does NOT perform Unicode normalization.
   */
  function _validateMintBindings(
    DisclosureBindingPublicSignals calldata publicSignals,
    PersonCoreInfo calldata coreInfo
  ) internal pure {
    if (bytes32(publicSignals.identityCommitment) != coreInfo.basicInfo.identityCommitment) {
      revert BasicInfoMismatch();
    }

    bytes32 computedDisclosureBinding = _computeDisclosureBinding(
      coreInfo.supplementInfo.fullName,
      coreInfo.basicInfo,
      publicSignals.suiteCommitment
    );
    if (bytes32(publicSignals.disclosureBinding) != computedDisclosureBinding) {
      revert BasicInfoMismatch();
    }
  }

  function _mintInternal(
    bytes32 personHash,
    uint256 versionIndex,
    string calldata _tokenURI,
    PersonCoreInfo calldata coreInfo
  ) internal returns (uint256 newTokenId) {
    newTokenId = ++tokenCounter;

    tokenIdToPerson[newTokenId] = personHash;
    tokenIdToVersionIndex[newTokenId] = versionIndex;
    versionToTokenId[personHash][versionIndex] = newTokenId;
    nftCoreInfo[newTokenId] = coreInfo;
    _setTokenURI(newTokenId, _tokenURI);

    _safeMint(msg.sender, newTokenId);
  }

  function _setTokenURI(uint256 tokenId, string memory _tokenURI) internal {
    _tokenURIs[tokenId] = _tokenURI;
  }

  // ========== Constructor / Initializer ==========

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  /**
   * @dev Initializer (replaces the constructor for the upgradeable proxy pattern).
   *      Sets up ERC721 metadata, ownership, and the immutable-by-convention wiring
   *      to the token contract.
   * @param _deepFamilyTokenContract DeepFamily token contract address
   * @param initialOwner Initial owner of the proxy, expected to become timelock/multisig governance.
   */
  function initialize(address _deepFamilyTokenContract, address initialOwner) public initializer {
    if (_deepFamilyTokenContract == address(0) || _deepFamilyTokenContract.code.length == 0)
      revert TokenContractNotSet();

    __ERC721_init("DeepFamily", "Family");
    __ERC721Enumerable_init();
    __Ownable_init(initialOwner);
    // ReentrancyGuardTransient keeps its state in transient storage (EIP-1153), which resets to
    // the unentered value at the start of every transaction, so it needs no initializer.

    DEEP_FAMILY_TOKEN_CONTRACT = _deepFamilyTokenContract;
    protocolEndorsementFeeBps = 500;
  }

  /// @dev UUPS upgrade authorization. Restricted to the owner (intended: timelock + multisig).
  // solhint-disable-next-line no-empty-blocks
  function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

  // ========== Public Functions ==========

  /**
   * @notice Permanently register one verifier-adapter route.
   * @dev Existing routes cannot be replaced or cleared.
   */
  function setCircuitVerifier(
    ProofPurpose purpose,
    uint32 circuitId,
    address adapter
  ) external onlyOwner {
    if (circuitId == 0) revert InvalidCircuitId();
    if (adapter == address(0) || adapter.code.length == 0) revert InvalidVerifierAddress();
    if (verifierRegistry[uint8(purpose)][circuitId] != address(0)) {
      revert VerifierRouteAlreadySet();
    }
    verifierRegistry[uint8(purpose)][circuitId] = adapter;
    emit CircuitVerifierSet(uint8(purpose), circuitId, adapter);
  }

  /**
   * @notice Permanently bind the one metadata archive used by this protocol deployment.
   * @dev `onlyProxy` intentionally runs before `onlyOwner`, so direct implementation calls
   *      fail on the proxy-context invariant regardless of implementation ownership state.
   */
  function setMetadataArchive(address archive) external onlyProxy onlyOwner {
    if (metadataArchive != address(0)) revert MetadataArchiveAlreadySet();
    if (archive == address(0) || archive.code.length == 0) revert InvalidMetadataArchive();

    address boundDeepFamily;
    try IMetadataArchiveV1(archive).DEEP_FAMILY() returns (address bound) {
      boundDeepFamily = bound;
    } catch {
      revert InvalidMetadataArchive();
    }
    if (boundDeepFamily != address(this)) revert InvalidMetadataArchive();

    metadataArchive = archive;
    emit MetadataArchiveSet(archive);
  }

  /**
   * @notice Permanently bind the archive that owns all public-story state.
   * @dev The proxy retains only this binding; chunks, metadata, sealing state, and content
   *      references all live in StoryArchiveV1.
   */
  function setStoryArchive(address archive) external onlyProxy onlyOwner {
    if (storyArchive != address(0)) revert StoryArchiveAlreadySet();
    if (archive == address(0) || archive.code.length == 0) revert InvalidStoryArchive();

    address boundDeepFamily;
    try IStoryArchiveV1(archive).DEEP_FAMILY() returns (address bound) {
      boundDeepFamily = bound;
    } catch {
      revert InvalidStoryArchive();
    }
    if (boundDeepFamily != address(this)) revert InvalidStoryArchive();

    storyArchive = archive;
    emit StoryArchiveSet(archive);
  }

  function _requireTrustedEndorserManager(bytes32 personHash, uint256 versionIndex) internal view {
    uint256 tokenId = versionToTokenId[personHash][versionIndex];
    if (tokenId == 0) {
      if (personVersions[personHash][versionIndex - 1].addedBy != msg.sender) {
        revert MustBeTrustedEndorserManager();
      }
      return;
    }

    if (_ownerOf(tokenId) != msg.sender) {
      revert MustBeTrustedEndorserManager();
    }
  }

  function _addTrustedEndorserInternal(
    bytes32 personHash,
    uint256 versionIndex,
    address account
  ) internal {
    if (account == address(0)) revert InvalidTrustedEndorser();
    if (trustedEndorserOf[personHash][versionIndex][account]) {
      revert TrustedEndorserAlreadyAdded();
    }

    trustedEndorserOf[personHash][versionIndex][account] = true;
    trustedEndorserIndex[personHash][versionIndex][account] =
      trustedEndorsers[personHash][versionIndex].length +
      1;
    trustedEndorsers[personHash][versionIndex].push(account);

    emit TrustedEndorserAdded(personHash, versionIndex, account);
  }

  function _removeTrustedEndorserInternal(
    bytes32 personHash,
    uint256 versionIndex,
    address account
  ) internal {
    if (account == address(0)) revert InvalidTrustedEndorser();
    uint256 index = trustedEndorserIndex[personHash][versionIndex][account];
    if (index == 0) revert TrustedEndorserNotFound();

    uint256 arrayIdx = index - 1;
    uint256 lastIdx = trustedEndorsers[personHash][versionIndex].length - 1;

    if (arrayIdx != lastIdx) {
      address lastAccount = trustedEndorsers[personHash][versionIndex][lastIdx];
      trustedEndorsers[personHash][versionIndex][arrayIdx] = lastAccount;
      trustedEndorserIndex[personHash][versionIndex][lastAccount] = index;
    }

    trustedEndorsers[personHash][versionIndex].pop();
    delete trustedEndorserIndex[personHash][versionIndex][account];
    delete trustedEndorserOf[personHash][versionIndex][account];

    emit TrustedEndorserRemoved(personHash, versionIndex, account);
  }

  function _validateMetadataEnvelope(
    bytes calldata metadataEnvelope,
    uint256 submitterAndSelfSuiteId
  ) internal view {
    if (metadataEnvelope.length < 0x14) revert InvalidMetadataEnvelope();

    uint32 containerMagic;
    uint8 formatVersion;
    uint32 headerSelfSuiteId;
    assembly ("memory-safe") {
      let firstWord := calldataload(metadataEnvelope.offset)
      containerMagic := shr(224, firstWord)
      formatVersion := byte(4, firstWord)
      headerSelfSuiteId := shr(224, calldataload(add(metadataEnvelope.offset, 0x10)))
    }

    if (containerMagic != 0x44464d31 || formatVersion == 0) {
      revert InvalidEnvelopePrefix();
    }
    if (headerSelfSuiteId == 0) revert InvalidIdentitySuite();

    uint256 expectedSubmitterAndSelfSuiteId = uint256(uint160(msg.sender)) |
      (uint256(headerSelfSuiteId) << 160);
    if (submitterAndSelfSuiteId != expectedSubmitterAndSelfSuiteId) {
      revert CallerOrIdentitySuiteMismatch();
    }
  }

  function _addPersonInternal(
    bytes32 personHash,
    bytes32 fatherHash,
    bytes32 motherHash,
    uint256 fatherVersionIndex,
    uint256 motherVersionIndex,
    uint256 versionCommitment,
    bytes calldata metadataEnvelope
  ) internal {
    if (personHash == bytes32(0)) revert InvalidPersonHash();
    if (fatherHash == personHash || motherHash == personHash) revert InvalidParentHash();
    if (fatherHash != bytes32(0) && fatherHash == motherHash) revert InvalidParentHash();
    if (fatherHash == bytes32(0) && fatherVersionIndex != 0) revert InvalidFatherVersionIndex();
    if (motherHash == bytes32(0) && motherVersionIndex != 0) revert InvalidMotherVersionIndex();
    if (fatherVersionIndex > personVersions[fatherHash].length) revert InvalidFatherVersionIndex();
    if (motherVersionIndex > personVersions[motherHash].length) revert InvalidMotherVersionIndex();
    bytes32 versionHash = keccak256(
      abi.encode(
        VERSION_HASH_DOMAIN,
        personHash,
        fatherHash,
        fatherVersionIndex,
        motherHash,
        motherVersionIndex,
        versionCommitment
      )
    );
    if (versionExists[personHash][versionHash]) revert DuplicateVersionCommitment();
    versionExists[personHash][versionHash] = true;

    uint256 versionIndex = personVersions[personHash].length + 1;
    personVersions[personHash].push(
      PersonVersion({
        personHash: personHash,
        fatherHash: fatherHash,
        motherHash: motherHash,
        versionIndex: versionIndex,
        fatherVersionIndex: fatherVersionIndex,
        motherVersionIndex: motherVersionIndex,
        versionCommitment: versionCommitment,
        addedBy: msg.sender,
        timestamp: uint96(block.timestamp)
      })
    );

    IMetadataArchiveV1(metadataArchive).store(personHash, versionIndex, metadataEnvelope);

    _addTrustedEndorserInternal(personHash, versionIndex, msg.sender);
    if (fatherHash != bytes32(0)) {
      childrenOf[fatherHash][fatherVersionIndex].push(
        ChildRef({childHash: personHash, childVersionIndex: versionIndex})
      );
    }
    if (motherHash != bytes32(0)) {
      childrenOf[motherHash][motherVersionIndex].push(
        ChildRef({childHash: personHash, childVersionIndex: versionIndex})
      );
    }
    if (versionIndex == 1) {
      totalPersonsCount++;
    }
    emit PersonVersionAdded(
      personHash,
      versionIndex,
      msg.sender,
      block.timestamp,
      fatherHash,
      fatherVersionIndex,
      motherHash,
      motherVersionIndex,
      versionCommitment
    );
    // Reward the first complete-parent claim for a person. Parent versions may remain unspecified
    // (index 0) and the parent records do not need to exist on-chain yet.
    if (
      !rewardClaimedByPerson[personHash] && fatherHash != bytes32(0) && motherHash != bytes32(0)
    ) {
      rewardClaimedByPerson[personHash] = true;
      uint256 reward = IDeepFamilyToken(DEEP_FAMILY_TOKEN_CONTRACT).mint(msg.sender);
      if (reward > 0) {
        emit TokenRewardDistributed(msg.sender, personHash, versionIndex, reward);
      }
    }
  }

  /**
   * @notice Add a person version via a ZK relation proof and archive its encrypted envelope.
   * @dev Public signals order: identityCommitment, fatherIdentityCommitment,
   *      motherIdentityCommitment, submitterAndSelfSuiteId, versionCommitment.
   */
  function addPersonVersion(
    ProofEnvelope calldata proof,
    PersonProofPublicSignals calldata publicSignals,
    uint256 fatherVersionIndex,
    uint256 motherVersionIndex,
    bytes calldata metadataEnvelope
  ) external nonReentrant {
    if (metadataArchive == address(0)) revert MetadataArchiveNotSet();
    _validateMetadataEnvelope(metadataEnvelope, publicSignals.submitterAndSelfSuiteId);

    address adapter = _getVerifier(proof.circuitId, ProofPurpose.PersonRelation);
    uint256[] memory ps = new uint256[](ProofConstants.PERSON_RELATION_PUBLIC_SIGNALS_LEN);
    ps[0] = publicSignals.identityCommitment;
    ps[1] = publicSignals.fatherIdentityCommitment;
    ps[2] = publicSignals.motherIdentityCommitment;
    ps[3] = publicSignals.submitterAndSelfSuiteId;
    ps[4] = publicSignals.versionCommitment;

    if (
      !IProofVerifierAdapter(adapter).verifyProof(
        uint8(ProofPurpose.PersonRelation),
        proof.proofEncodingId,
        proof.proofData,
        ps
      )
    ) {
      revert InvalidZKProof();
    }

    bytes32 personHash_ = _wrapIdentityCommitmentAsPersonHash(publicSignals.identityCommitment);
    bytes32 fatherHash_ = publicSignals.fatherIdentityCommitment == 0
      ? bytes32(0)
      : _wrapIdentityCommitmentAsPersonHash(publicSignals.fatherIdentityCommitment);
    bytes32 motherHash_ = publicSignals.motherIdentityCommitment == 0
      ? bytes32(0)
      : _wrapIdentityCommitmentAsPersonHash(publicSignals.motherIdentityCommitment);

    if (publicSignals.fatherIdentityCommitment == 0) {
      if (fatherVersionIndex != 0) revert InvalidParentHash();
    }

    if (publicSignals.motherIdentityCommitment == 0) {
      if (motherVersionIndex != 0) revert InvalidParentHash();
    }

    emit PersonHashZKVerified(personHash_, msg.sender);

    _addPersonInternal(
      personHash_,
      fatherHash_,
      motherHash_,
      fatherVersionIndex,
      motherVersionIndex,
      publicSignals.versionCommitment,
      metadataEnvelope
    );
  }

  function endorseVersion(
    bytes32 personHash,
    uint256 versionIndex
  ) external nonReentrant validPersonAndVersion(personHash, versionIndex) {
    uint256 prev = endorsedVersionIndex[personHash][msg.sender];
    if (prev == versionIndex) revert AlreadyEndorsed();

    uint256 arrayIndex = versionIndex - 1;
    uint256 fee = IDeepFamilyToken(DEEP_FAMILY_TOKEN_CONTRACT).recentReward();
    address recipientAddress = address(0);
    address protocolRecipientAddress = address(0);
    uint256 recipientShareAmount = 0;

    if (prev > 0) {
      uint256 prevIdx = prev - 1;
      uint256 count = versionEndorsementCount[personHash][prevIdx];
      if (count > 0) {
        versionEndorsementCount[personHash][prevIdx] = count - 1;
      }
    } else {
      userEndorsementIndex[msg.sender][personHash] = userEndorsedPersons[msg.sender].length + 1;
      userEndorsedPersons[msg.sender].push(personHash);
    }

    versionEndorsementCount[personHash][arrayIndex] += 1;
    endorsedVersionIndex[personHash][msg.sender] = versionIndex;

    if (fee > 0) {
      IDeepFamilyToken tokenContract = IDeepFamilyToken(DEEP_FAMILY_TOKEN_CONTRACT);
      PersonVersion storage v = personVersions[personHash][arrayIndex];
      uint256 tokenId = versionToTokenId[personHash][versionIndex];
      if (tokenId != 0) {
        address holder = _ownerOf(tokenId);
        if (holder != address(0)) {
          recipientAddress = holder;
        } else {
          recipientAddress = v.addedBy;
        }
      } else {
        recipientAddress = v.addedBy;
      }
      uint256 protocolShare = (fee * protocolEndorsementFeeBps) / FEE_BPS_DENOMINATOR;
      recipientShareAmount = fee - protocolShare;
      if (recipientShareAmount > 0) {
        bool okRecipient = tokenContract.transferFrom(
          msg.sender,
          recipientAddress,
          recipientShareAmount
        );
        if (!okRecipient) revert EndorsementFeeTransferFailed();
      }
      if (protocolShare > 0) {
        protocolRecipientAddress = owner();
        if (protocolRecipientAddress == address(0)) {
          tokenContract.burnFrom(msg.sender, protocolShare);
        } else {
          bool okOwner = tokenContract.transferFrom(
            msg.sender,
            protocolRecipientAddress,
            protocolShare
          );
          if (!okOwner) revert EndorsementFeeTransferFailed();
        }
      }
    }

    emit PersonVersionEndorsed(
      personHash,
      msg.sender,
      versionIndex,
      recipientAddress,
      recipientShareAmount,
      protocolRecipientAddress,
      fee - recipientShareAmount,
      fee,
      block.timestamp
    );
  }

  function cancelEndorsement(bytes32 personHash) external nonReentrant {
    if (personHash == bytes32(0)) revert InvalidPersonHash();

    uint256 versionIndex = endorsedVersionIndex[personHash][msg.sender];
    if (versionIndex == 0) revert NotEndorsed();

    uint256 arrayIndex = versionIndex - 1;
    uint256 count = versionEndorsementCount[personHash][arrayIndex];
    if (count > 0) {
      versionEndorsementCount[personHash][arrayIndex] = count - 1;
    }

    uint256 index = userEndorsementIndex[msg.sender][personHash];
    if (index > 0) {
      uint256 arrayIdx = index - 1;
      uint256 lastIdx = userEndorsedPersons[msg.sender].length - 1;

      if (arrayIdx != lastIdx) {
        bytes32 lastPersonHash = userEndorsedPersons[msg.sender][lastIdx];
        userEndorsedPersons[msg.sender][arrayIdx] = lastPersonHash;
        userEndorsementIndex[msg.sender][lastPersonHash] = index;
      }

      userEndorsedPersons[msg.sender].pop();
      delete userEndorsementIndex[msg.sender][personHash];
    }

    delete endorsedVersionIndex[personHash][msg.sender];

    emit EndorsementCancelled(personHash, msg.sender, versionIndex, block.timestamp);
  }

  function addTrustedEndorser(
    bytes32 personHash,
    uint256 versionIndex,
    address account
  ) external validPersonAndVersion(personHash, versionIndex) {
    _requireTrustedEndorserManager(personHash, versionIndex);
    _addTrustedEndorserInternal(personHash, versionIndex, account);
  }

  function removeTrustedEndorser(
    bytes32 personHash,
    uint256 versionIndex,
    address account
  ) external validPersonAndVersion(personHash, versionIndex) {
    _requireTrustedEndorserManager(personHash, versionIndex);
    _removeTrustedEndorserInternal(personHash, versionIndex, account);
  }

  /**
   * @notice Mint family tree NFT for a specific person version with a ZK binding proof.
   */
  function mintPersonVersionNFT(
    ProofEnvelope calldata proof,
    DisclosureBindingPublicSignals calldata publicSignals,
    uint256 versionIndex,
    string calldata _tokenURI,
    PersonCoreInfo calldata coreInfo
  ) external nonReentrant {
    bytes32 personHash = _wrapIdentityCommitmentAsPersonHash(publicSignals.identityCommitment);
    if (personHash == bytes32(0)) revert InvalidPersonHash();
    if (versionIndex == 0 || versionIndex > personVersions[personHash].length) {
      revert InvalidVersionIndex();
    }
    if (publicSignals.minter != uint256(uint160(msg.sender))) revert CallerMismatch();

    _validateMintInput(personHash, versionIndex, _tokenURI, coreInfo);
    _verifyMintProof(proof, publicSignals);
    _validateMintBindings(publicSignals, coreInfo);
    AdultAgeGate.enforceAdult(
      coreInfo.basicInfo.isBirthBC,
      coreInfo.basicInfo.birthYear,
      coreInfo.basicInfo.birthMonth,
      coreInfo.basicInfo.birthDay
    );

    uint256 newTokenId = _mintInternal(personHash, versionIndex, _tokenURI, coreInfo);

    emit PersonNFTMinted(
      personHash,
      newTokenId,
      msg.sender,
      versionIndex,
      _tokenURI,
      block.timestamp
    );
  }

  function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
    _requireOwned(tokenId);
    return _tokenURIs[tokenId];
  }

  function updateTokenURI(uint256 tokenId, string calldata newURI) external {
    if (_ownerOf(tokenId) != msg.sender) revert MustBeNFTHolder();
    if (bytes(newURI).length > MAX_LONG_TEXT_LENGTH) revert InvalidTokenURI();

    string memory oldURI = _tokenURIs[tokenId];
    if (bytes(oldURI).length > 0) {
      tokenURIHistory[tokenId].push(oldURI);
    }
    _setTokenURI(tokenId, newURI);
    emit TokenURIUpdated(tokenId, msg.sender, oldURI, newURI);
  }

  function updateEndorsementFee(uint256 newBps) external onlyOwner {
    if (newBps > PROTOCOL_FEE_BPS_MAX) revert ProtocolFeeTooHigh();
    uint256 previous = protocolEndorsementFeeBps;
    if (previous == newBps) {
      return;
    }
    protocolEndorsementFeeBps = newBps;
    emit EndorsementFeeUpdated(previous, newBps);
  }

  // ========== Reader Primitive Getters ==========

  function personVersionsCount(bytes32 personHash) external view returns (uint256) {
    return personVersions[personHash].length;
  }

  function personVersionAt(
    bytes32 personHash,
    uint256 arrayIndex
  ) external view returns (PersonVersion memory) {
    return personVersions[personHash][arrayIndex];
  }

  function childrenCount(
    bytes32 parentHash,
    uint256 parentVersionIndex
  ) external view returns (uint256) {
    return childrenOf[parentHash][parentVersionIndex].length;
  }

  function tokenURIHistoryCount(uint256 tokenId) external view returns (uint256) {
    _requireOwned(tokenId);
    return tokenURIHistory[tokenId].length;
  }

  function userEndorsedPersonsCount(address user) external view returns (uint256) {
    return userEndorsedPersons[user].length;
  }

  function userEndorsedPersonAt(address user, uint256 index) external view returns (bytes32) {
    return userEndorsedPersons[user][index];
  }

  function trustedEndorsersCount(
    bytes32 personHash,
    uint256 versionIndex
  ) external view returns (uint256) {
    return trustedEndorsers[personHash][versionIndex].length;
  }

  function trustedEndorserAt(
    bytes32 personHash,
    uint256 versionIndex,
    uint256 index
  ) external view returns (address) {
    return trustedEndorsers[personHash][versionIndex][index];
  }

  // ===== Native Currency Reception Protection: Reject Direct Transfers =====
  receive() external payable {
    revert DirectNativeCurrencyNotAccepted();
  }

  fallback() external payable {
    revert DirectNativeCurrencyNotAccepted();
  }
}

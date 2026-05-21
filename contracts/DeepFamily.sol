// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "poseidon-solidity/PoseidonT5.sol";
import {IProofVerifierAdapter} from "./interfaces/IProofVerifierAdapter.sol";
import {ProofConstants} from "./libraries/ProofConstants.sol";

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
contract DeepFamily is ERC721Enumerable, Ownable, ReentrancyGuard {
  // ========== Custom Errors (Unified Error Handling) ==========

  // Input validation errors
  error InvalidPersonHash();
  error InvalidFatherVersionIndex();
  error InvalidMotherVersionIndex();
  error InvalidVersionIndex();
  error InvalidFullName();
  error InvalidTagLength();
  error InvalidCIDLength();
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
  error VerifierRouteNotSet();
  error UnsupportedProofEncoding();
  error MalformedProofData();
  error InvalidAttestationRefVersion();
  error InvalidAttestationSubject();
  error InvalidAttestationAction();
  error InvalidAttestationPayloadDigest();
  error InvalidAttestationSignatureSuite();
  error InvalidAttestationSignerKey();
  error InvalidAttestationURI();
  error InvalidAttestationIssuedAt();
  error InvalidAttestationExpiresAt();
  error InvalidAttestationRevocation();
  error DuplicateAttestationReference();

  // Business logic errors
  error DuplicateVersion();
  error MustEndorseVersionFirst();
  error VersionAlreadyMinted();
  error BasicInfoMismatch();
  error CallerMismatch();
  error InvalidParentHash();
  error MustBeAdult();

  // Token-related errors
  error TokenContractNotSet();
  error EndorsementFeeTransferFailed();
  error ProtocolFeeTooHigh();
  error AlreadyEndorsed();
  error NotEndorsed();

  // Query-related errors
  error PageSizeExceedsLimit();
  error DirectETHNotAccepted();

  // Story sharding related errors
  error StoryAlreadySealed();
  error ChunkIndexOutOfRange();
  error InvalidChunkContent();
  error ChunkHashMismatch();
  error StoryNotFound();
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
    address addedBy;
    uint96 timestamp;
    string tag;
    string metadataCID;
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
    PersonCommitment,
    DisclosureBinding
  }

  struct ProofEnvelope {
    uint16 proofSystemId;
    uint8 proofEncodingId;
    bytes proofData;
  }

  struct PersonProofPublicSignals {
    uint256 identityCommitment;
    uint256 fatherIdentityCommitment;
    uint256 motherIdentityCommitment;
    uint256 submitter;
    uint256 schemaVersion;
    uint256 cryptoSuiteVersion;
    uint256 hashAlgoId;
  }

  struct DisclosureBindingPublicSignals {
    uint256 identityCommitment;
    uint256 disclosureBinding;
    uint256 minter;
    uint256 schemaVersion;
    uint256 cryptoSuiteVersion;
    uint256 hashAlgoId;
  }

  struct AttestationRef {
    uint16 attestationRefVersion;
    uint16 subjectType;
    bytes32 subjectHash;
    uint16 actionType;
    bytes32 actionDigest;
    bytes32 attestationPayloadDigest;
    uint16 signatureSuiteId;
    bytes32 signerKeyId;
    string uri;
    uint64 issuedAt;
    uint64 expiresAt;
    uint8 revocationType;
    bytes32 revocationRef;
  }

  struct ChildRef {
    bytes32 childHash;
    uint256 childVersionIndex;
  }

  struct StoryChunk {
    uint256 chunkIndex;
    bytes32 chunkHash;
    string content;
    uint256 timestamp;
    address editor;
    uint8 chunkType;
    string attachmentCID;
  }

  struct StoryMetadata {
    uint256 totalChunks;
    bytes32 fullStoryHash;
    uint256 lastUpdateTime;
    bool isSealed;
    uint256 totalLength;
  }

  struct PaginationResult {
    uint256 startIndex;
    uint256 endIndex;
    uint256 resultLength;
    uint256 nextOffset;
    bool hasMore;
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

  // ========== Story Sharding Storage Mappings ==========

  mapping(uint256 => StoryMetadata) public storyMetadata;
  mapping(uint256 => mapping(uint256 => StoryChunk)) public storyChunks;

  // ========== Statistics Mappings ==========

  mapping(bytes32 => mapping(uint256 => uint256)) public versionEndorsementCount;
  uint256 public protocolEndorsementFeeBps = 500;
  mapping(bytes32 => mapping(uint256 => ChildRef[])) public childrenOf;
  mapping(address => bytes32[]) private userEndorsedPersons;
  mapping(address => mapping(bytes32 => uint256)) private userEndorsementIndex;

  // ========== Attestation Storage ==========

  mapping(bytes32 => AttestationRef) public attestationRefs;
  mapping(bytes32 => bool) public attestationRefExists;

  // ========== System Constants ==========

  uint256 public constant MAX_LONG_TEXT_LENGTH = 256;
  uint256 public constant MAX_QUERY_PAGE_SIZE = 200;
  uint256 public constant MAX_CHUNK_CONTENT_LENGTH = 2048;
  uint256 public constant PROTOCOL_FEE_BPS_MAX = 2000;
  uint256 public constant FEE_BPS_DENOMINATOR = 10_000;
  uint256 public constant MINIMUM_MINT_AGE = 18;
  uint16 public constant ATTESTATION_REF_VERSION_V1 = 1;
  uint16 public constant SUBJECT_TYPE_PERSON = 1;
  uint16 public constant SUBJECT_TYPE_VERSION = 2;
  uint16 public constant SUBJECT_TYPE_TOKEN = 3;
  uint16 public constant SUBJECT_TYPE_STORY = 4;
  uint16 public constant SUBJECT_TYPE_ACTION = 6;
  uint16 public constant ACTION_TYPE_AUTHORITATIVE_MINT = 1;
  uint16 public constant ACTION_TYPE_HIGH_TRUST_ENDORSEMENT = 2;
  uint16 public constant ACTION_TYPE_STORY_SEAL = 3;
  uint16 public constant ACTION_TYPE_VERIFIER_UPDATE = 4;
  uint16 public constant ACTION_TYPE_PROTOCOL_FEE_UPDATE = 5;
  uint16 public constant SIG_SUITE_ECDSA_SECP256K1_V1 = 1;
  uint16 public constant SIG_SUITE_HYBRID_ECDSA_ML_DSA_V1 = 2;
  uint16 public constant SIG_SUITE_PQ_ML_DSA_V1 = 3;
  uint8 public constant REVOCATION_TYPE_NONE = 0;
  uint8 public constant REVOCATION_TYPE_ONCHAIN_REGISTRY = 1;
  uint8 public constant REVOCATION_TYPE_EXTERNAL_LIST_DIGEST = 2;
  uint8 public constant REVOCATION_TYPE_EXTERNAL_STATUS_URI = 3;
  uint64 public constant ATTESTATION_CLOCK_SKEW_SECONDS = 300;
  uint64 public constant ATTESTATION_MAX_BACKDATE_SECONDS = 365 days;
  uint16 public constant ATTESTATION_URI_MAX_LENGTH = 256;
  uint256 private constant DOMAIN_SUITE = 1000;
  uint256 private constant DOMAIN_NAME_SECRET = 1001;
  uint256 private constant DOMAIN_IDENTITY = 1002;
  uint256 private constant DOMAIN_DISCLOSURE = 1003;
  string private constant DOMAIN_NAME_PREHASH = "deepfamily:name-prehash:v2";
  string private constant DOMAIN_ATTESTATION_ACTION = "DeepFamily.AttestationAction.V1";
  string private constant DOMAIN_ATTESTATION_SUBJECT_VERSION = "DeepFamily.Subject.Version.V1";
  string private constant DOMAIN_ATTESTATION_SUBJECT_TOKEN = "DeepFamily.Subject.Token.V1";

  uint256 private constant SECONDS_PER_DAY = 24 * 60 * 60;
  int256 private constant OFFSET19700101 = 2440588;

  address public immutable DEEP_FAMILY_TOKEN_CONTRACT;
  mapping(uint16 => mapping(uint8 => address)) public verifierRegistry;

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
    string tag
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

  event StoryChunkAdded(
    uint256 indexed tokenId,
    uint256 indexed chunkIndex,
    bytes32 chunkHash,
    address indexed editor,
    uint256 contentLength,
    uint8 chunkType,
    string attachmentCID
  );

  event StorySealed(
    uint256 indexed tokenId,
    uint256 totalChunks,
    bytes32 fullStoryHash,
    address indexed sealer
  );

  event EndorsementFeeUpdated(uint256 previousBps, uint256 newBps);

  event VerifierUpdated(uint16 indexed proofSystemId, uint8 indexed purpose, address verifier);

  event AttestationReferenceAnchored(
    bytes32 indexed attestationKey,
    uint16 indexed actionType,
    bytes32 indexed subjectHash,
    uint16 subjectType,
    bytes32 actionDigest,
    bytes32 attestationPayloadDigest,
    uint16 signatureSuiteId,
    bytes32 signerKeyId,
    string uri,
    uint64 issuedAt,
    uint64 expiresAt,
    uint8 revocationType,
    bytes32 revocationRef
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

  function _getPaginationParams(
    uint256 totalCount,
    uint256 offset,
    uint256 limit
  ) internal pure returns (PaginationResult memory result) {
    if (limit > MAX_QUERY_PAGE_SIZE) revert PageSizeExceedsLimit();

    if (limit == 0 || offset >= totalCount) {
      return
        PaginationResult({
          startIndex: offset,
          endIndex: offset,
          resultLength: 0,
          nextOffset: offset >= totalCount ? totalCount : offset,
          hasMore: false
        });
    }

    uint256 endIndex = offset + limit;
    if (endIndex > totalCount) endIndex = totalCount;

    return
      PaginationResult({
        startIndex: offset,
        endIndex: endIndex,
        resultLength: endIndex - offset,
        nextOffset: endIndex,
        hasMore: endIndex < totalCount
      });
  }

  // ========== Date & Age Utilities ==========

  function _daysToDate(
    uint256 _days
  ) internal pure returns (uint256 year, uint256 month, uint256 day) {
    int256 __days = int256(_days);

    int256 L = __days + 68569 + OFFSET19700101;
    int256 N = (4 * L) / 146097;
    L = L - (146097 * N + 3) / 4;
    int256 _year = (4000 * (L + 1)) / 1461001;
    L = L - (1461 * _year) / 4 + 31;
    int256 _month = (80 * L) / 2447;
    int256 _day = L - (2447 * _month) / 80;
    L = _month / 11;
    _month = _month + 2 - 12 * L;
    _year = 100 * (N - 49) + _year + L;

    year = uint256(_year);
    month = uint256(_month);
    day = uint256(_day);
  }

  function _timestampToDate(
    uint256 timestamp
  ) internal pure returns (uint256 year, uint256 month, uint256 day) {
    uint256 _days = timestamp / SECONDS_PER_DAY;
    (year, month, day) = _daysToDate(_days);
  }

  function _enforceAdult(PersonBasicInfo memory basicInfo) internal view {
    if (basicInfo.isBirthBC) return;
    if (basicInfo.birthYear == 0) return;

    (uint256 currentYear, uint256 currentMonth, uint256 currentDay) = _timestampToDate(
      block.timestamp
    );

    if (basicInfo.birthYear > currentYear) revert InvalidBirthYear();

    uint256 ageYears = currentYear - uint256(basicInfo.birthYear);
    if (ageYears > MINIMUM_MINT_AGE) return;
    if (ageYears < MINIMUM_MINT_AGE) revert MustBeAdult();

    if (basicInfo.birthMonth == 0) return;
    if (currentMonth < basicInfo.birthMonth) revert MustBeAdult();
    if (currentMonth > basicInfo.birthMonth) return;

    if (basicInfo.birthDay == 0) return;
    if (currentDay < uint256(basicInfo.birthDay)) revert MustBeAdult();
  }

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

  function _getVerifier(uint16 proofSystemId, ProofPurpose purpose) internal view returns (address) {
    address verifier = verifierRegistry[proofSystemId][uint8(purpose)];
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
    return (uint256(basicInfo.birthYear) << 24) |
      (uint256(basicInfo.birthMonth) << 16) |
      (uint256(basicInfo.birthDay) << 8) |
      (uint256(basicInfo.gender) << 1) |
      (basicInfo.isBirthBC ? 1 : 0);
  }

  function _computeNamePrehash(string memory fullName) internal pure returns (bytes32) {
    if (bytes(fullName).length == 0) revert InvalidFullName();
    return keccak256(abi.encodePacked(DOMAIN_NAME_PREHASH, bytes(fullName)));
  }

  function _computeNameField(string memory fullName) internal pure returns (uint256) {
    uint256 fieldModulus =
      21888242871839275222246405745257275088548364400416034343698204186575808495617;
    return uint256(_computeNamePrehash(fullName)) % fieldModulus;
  }

  function _computeSuiteCommitment(
    uint256 schemaVersion,
    uint256 cryptoSuiteVersion,
    uint256 hashAlgoId
  ) internal pure returns (uint256) {
    uint256[4] memory inputs;
    inputs[0] = DOMAIN_SUITE;
    inputs[1] = schemaVersion;
    inputs[2] = cryptoSuiteVersion;
    inputs[3] = hashAlgoId;
    return PoseidonT5.hash(inputs);
  }

  function _computeDisclosureBinding(
    string memory fullName,
    PersonBasicInfo calldata basicInfo,
    uint256 schemaVersion,
    uint256 cryptoSuiteVersion,
    uint256 hashAlgoId
  ) internal pure returns (bytes32) {
    uint256[4] memory inputs;
    inputs[0] = DOMAIN_DISCLOSURE;
    inputs[1] = _computeNameField(fullName);
    inputs[2] = _packBirthGenderField(basicInfo);
    inputs[3] = _computeSuiteCommitment(schemaVersion, cryptoSuiteVersion, hashAlgoId);

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
    if (coreInfo.supplementInfo.deathMonth > 12) revert InvalidDeathMonth();
    if (coreInfo.supplementInfo.deathDay > 31) revert InvalidDeathDay();
  }

  function _verifyMintProof(
    ProofEnvelope calldata proof,
    DisclosureBindingPublicSignals calldata publicSignals
  ) internal view {
    address adapter = _getVerifier(proof.proofSystemId, ProofPurpose.DisclosureBinding);
    uint256[] memory ps = new uint256[](ProofConstants.DISCLOSURE_BINDING_PUBLIC_SIGNALS_LEN);
    ps[0] = publicSignals.identityCommitment;
    ps[1] = publicSignals.disclosureBinding;
    ps[2] = publicSignals.minter;
    ps[3] = publicSignals.schemaVersion;
    ps[4] = publicSignals.cryptoSuiteVersion;
    ps[5] = publicSignals.hashAlgoId;

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
      publicSignals.schemaVersion,
      publicSignals.cryptoSuiteVersion,
      publicSignals.hashAlgoId
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

  function _computeVersionSubjectHash(
    bytes32 personHash,
    uint256 versionIndex
  ) internal pure returns (bytes32) {
    return keccak256(abi.encode(DOMAIN_ATTESTATION_SUBJECT_VERSION, personHash, versionIndex));
  }

  function _computeTokenSubjectHash(uint256 tokenId) internal pure returns (bytes32) {
    return keccak256(abi.encode(DOMAIN_ATTESTATION_SUBJECT_TOKEN, tokenId));
  }

  function _computeCoreInfoDigest(
    PersonCoreInfo calldata coreInfo
  ) internal pure returns (bytes32) {
    return
      keccak256(
        abi.encode(
          coreInfo.basicInfo.identityCommitment,
          coreInfo.basicInfo.isBirthBC,
          coreInfo.basicInfo.birthYear,
          coreInfo.basicInfo.birthMonth,
          coreInfo.basicInfo.birthDay,
          coreInfo.basicInfo.gender,
          _hashString(coreInfo.supplementInfo.fullName),
          _hashString(coreInfo.supplementInfo.birthPlace),
          coreInfo.supplementInfo.isDeathBC,
          coreInfo.supplementInfo.deathYear,
          coreInfo.supplementInfo.deathMonth,
          coreInfo.supplementInfo.deathDay,
          _hashString(coreInfo.supplementInfo.deathPlace),
          _hashString(coreInfo.supplementInfo.story)
        )
      );
  }

  function _computeAuthoritativeMintActionDigest(
    address actor,
    bytes32 personHash,
    uint256 versionIndex,
    string calldata tokenURI_,
    PersonCoreInfo calldata coreInfo
  ) internal view returns (bytes32) {
    return
      keccak256(
        abi.encode(
          DOMAIN_ATTESTATION_ACTION,
          block.chainid,
          address(this),
          ACTION_TYPE_AUTHORITATIVE_MINT,
          actor,
          personHash,
          versionIndex,
          _hashString(tokenURI_),
          _computeCoreInfoDigest(coreInfo)
        )
      );
  }

  function _computeHighTrustEndorsementActionDigest(
    address actor,
    bytes32 personHash,
    uint256 versionIndex
  ) internal view returns (bytes32) {
    return
      keccak256(
        abi.encode(
          DOMAIN_ATTESTATION_ACTION,
          block.chainid,
          address(this),
          ACTION_TYPE_HIGH_TRUST_ENDORSEMENT,
          actor,
          personHash,
          versionIndex
        )
      );
  }

  function _computeStorySealActionDigest(
    address actor,
    uint256 tokenId
  ) internal view returns (bytes32) {
    StoryMetadata storage metadata = storyMetadata[tokenId];
    return
      keccak256(
        abi.encode(
          DOMAIN_ATTESTATION_ACTION,
          block.chainid,
          address(this),
          ACTION_TYPE_STORY_SEAL,
          actor,
          tokenId,
          metadata.totalChunks,
          metadata.fullStoryHash
        )
      );
  }

  function _computeVerifierUpdateActionDigest(
    address actor,
    uint16 proofSystemId,
    ProofPurpose purpose,
    address verifier
  ) internal view returns (bytes32) {
    return
      keccak256(
        abi.encode(
          DOMAIN_ATTESTATION_ACTION,
          block.chainid,
          address(this),
          ACTION_TYPE_VERIFIER_UPDATE,
          actor,
          proofSystemId,
          purpose,
          verifier
        )
      );
  }

  function _computeProtocolFeeUpdateActionDigest(
    address actor,
    uint256 newBps
  ) internal view returns (bytes32) {
    return
      keccak256(
        abi.encode(
          DOMAIN_ATTESTATION_ACTION,
          block.chainid,
          address(this),
          ACTION_TYPE_PROTOCOL_FEE_UPDATE,
          actor,
          newBps
        )
      );
  }

  function _computeAttestationKey(
    AttestationRef calldata ref
  ) internal pure returns (bytes32) {
    return
      keccak256(
        abi.encode(
          ref.attestationRefVersion,
          ref.subjectType,
          ref.subjectHash,
          ref.actionType,
          ref.actionDigest,
          ref.attestationPayloadDigest
        )
      );
  }

  function _isSupportedSignatureSuite(uint16 signatureSuiteId) internal pure returns (bool) {
    return
      signatureSuiteId == SIG_SUITE_ECDSA_SECP256K1_V1 ||
      signatureSuiteId == SIG_SUITE_HYBRID_ECDSA_ML_DSA_V1 ||
      signatureSuiteId == SIG_SUITE_PQ_ML_DSA_V1;
  }

  function _isSupportedRevocationType(uint8 revocationType) internal pure returns (bool) {
    return
      revocationType == REVOCATION_TYPE_NONE ||
      revocationType == REVOCATION_TYPE_ONCHAIN_REGISTRY ||
      revocationType == REVOCATION_TYPE_EXTERNAL_LIST_DIGEST ||
      revocationType == REVOCATION_TYPE_EXTERNAL_STATUS_URI;
  }

  function _isValidAttestationUri(string calldata uri) internal pure returns (bool) {
    bytes calldata uriBytes = bytes(uri);
    if (uriBytes.length == 0 || uriBytes.length > ATTESTATION_URI_MAX_LENGTH) return false;
    if (uriBytes.length >= 7) {
      if (
        uriBytes[0] == bytes1("i") &&
        uriBytes[1] == bytes1("p") &&
        uriBytes[2] == bytes1("f") &&
        uriBytes[3] == bytes1("s") &&
        uriBytes[4] == bytes1(":") &&
        uriBytes[5] == bytes1("/") &&
        uriBytes[6] == bytes1("/")
      ) {
        return true;
      }
    }
    if (uriBytes.length >= 4) {
      return
        uriBytes[0] == bytes1("b") &&
        uriBytes[1] == bytes1("a") &&
        uriBytes[2] == bytes1("f") &&
        uriBytes[3] == bytes1("y");
    }
    return false;
  }

  function _validateAttestationRef(
    AttestationRef calldata ref,
    uint16 expectedSubjectType,
    bytes32 expectedSubjectHash,
    uint16 expectedActionType,
    bytes32 expectedActionDigest
  ) internal view {
    if (ref.attestationRefVersion != ATTESTATION_REF_VERSION_V1) {
      revert InvalidAttestationRefVersion();
    }
    if (ref.subjectType != expectedSubjectType || ref.subjectHash != expectedSubjectHash) {
      revert InvalidAttestationSubject();
    }
    if (ref.actionType != expectedActionType || ref.actionDigest != expectedActionDigest) {
      revert InvalidAttestationAction();
    }
    if (ref.attestationPayloadDigest == bytes32(0)) revert InvalidAttestationPayloadDigest();
    if (!_isSupportedSignatureSuite(ref.signatureSuiteId)) revert InvalidAttestationSignatureSuite();
    if (ref.signerKeyId == bytes32(0)) revert InvalidAttestationSignerKey();
    if (!_isValidAttestationUri(ref.uri)) revert InvalidAttestationURI();

    uint256 now_ = block.timestamp;
    uint256 issuedAt_ = uint256(ref.issuedAt);
    if (issuedAt_ > now_ + uint256(ATTESTATION_CLOCK_SKEW_SECONDS)) {
      revert InvalidAttestationIssuedAt();
    }
    if (issuedAt_ + uint256(ATTESTATION_MAX_BACKDATE_SECONDS) < now_) {
      revert InvalidAttestationIssuedAt();
    }
    if (ref.expiresAt != 0) {
      if (ref.expiresAt <= ref.issuedAt) revert InvalidAttestationExpiresAt();
      if (uint256(ref.expiresAt) < now_) revert InvalidAttestationExpiresAt();
    }
    if (!_isSupportedRevocationType(ref.revocationType)) revert InvalidAttestationRevocation();
    if (ref.revocationType == REVOCATION_TYPE_NONE) {
      if (ref.revocationRef != bytes32(0)) revert InvalidAttestationRevocation();
    } else if (ref.revocationRef == bytes32(0)) {
      revert InvalidAttestationRevocation();
    }
  }

  function _anchorAttestationRef(
    AttestationRef calldata ref
  ) internal returns (bytes32 attestationKey) {
    attestationKey = _computeAttestationKey(ref);
    if (attestationRefExists[attestationKey]) revert DuplicateAttestationReference();

    AttestationRef storage stored = attestationRefs[attestationKey];
    stored.attestationRefVersion = ref.attestationRefVersion;
    stored.subjectType = ref.subjectType;
    stored.subjectHash = ref.subjectHash;
    stored.actionType = ref.actionType;
    stored.actionDigest = ref.actionDigest;
    stored.attestationPayloadDigest = ref.attestationPayloadDigest;
    stored.signatureSuiteId = ref.signatureSuiteId;
    stored.signerKeyId = ref.signerKeyId;
    stored.uri = ref.uri;
    stored.issuedAt = ref.issuedAt;
    stored.expiresAt = ref.expiresAt;
    stored.revocationType = ref.revocationType;
    stored.revocationRef = ref.revocationRef;
    attestationRefExists[attestationKey] = true;

    _emitAttestationReferenceAnchored(attestationKey, ref);
  }

  function _emitAttestationReferenceAnchored(
    bytes32 attestationKey,
    AttestationRef calldata ref
  ) internal {
    emit AttestationReferenceAnchored(
      attestationKey,
      ref.actionType,
      ref.subjectHash,
      ref.subjectType,
      ref.actionDigest,
      ref.attestationPayloadDigest,
      ref.signatureSuiteId,
      ref.signerKeyId,
      ref.uri,
      ref.issuedAt,
      ref.expiresAt,
      ref.revocationType,
      ref.revocationRef
    );
  }

  // ========== Constructor ==========

  /**
   * @dev Constructor, initializes ERC721 contract and token contract address
   * @param _deepFamilyTokenContract DeepFamily token contract address
   */
  constructor(
    address _deepFamilyTokenContract
  ) ERC721("DeepFamily", "Family") Ownable(msg.sender) {
    if (_deepFamilyTokenContract == address(0)) revert TokenContractNotSet();
    DEEP_FAMILY_TOKEN_CONTRACT = _deepFamilyTokenContract;
  }

  // ========== Public Functions ==========

  /**
   * @notice Register or update a proof verifier address for a given proof system and purpose.
   */
  function setVerifier(
    uint16 proofSystemId,
    ProofPurpose purpose,
    address verifier,
    AttestationRef calldata attestationRef
  ) external onlyOwner {
    bytes32 actionDigest = _computeVerifierUpdateActionDigest(
      msg.sender,
      proofSystemId,
      purpose,
      verifier
    );
    _validateAttestationRef(
      attestationRef,
      SUBJECT_TYPE_ACTION,
      actionDigest,
      ACTION_TYPE_VERIFIER_UPDATE,
      actionDigest
    );
    _anchorAttestationRef(attestationRef);
    _setVerifierInternal(proofSystemId, purpose, verifier);
  }

  function _setVerifierInternal(
    uint16 proofSystemId,
    ProofPurpose purpose,
    address verifier
  ) internal {
    if (verifier == address(0)) revert InvalidVerifierAddress();
    verifierRegistry[proofSystemId][uint8(purpose)] = verifier;
    emit VerifierUpdated(proofSystemId, uint8(purpose), verifier);
  }

  function _addPersonInternal(
    bytes32 personHash,
    bytes32 fatherHash,
    bytes32 motherHash,
    uint256 fatherVersionIndex,
    uint256 motherVersionIndex,
    string calldata tag,
    string calldata metadataCID
  ) internal {
    if (personHash == bytes32(0)) revert InvalidPersonHash();
    if (fatherHash == personHash || motherHash == personHash) revert InvalidParentHash();
    if (fatherHash != bytes32(0) && fatherHash == motherHash) revert InvalidParentHash();
    if (fatherHash == bytes32(0) && fatherVersionIndex != 0) revert InvalidFatherVersionIndex();
    if (motherHash == bytes32(0) && motherVersionIndex != 0) revert InvalidMotherVersionIndex();
    if (fatherVersionIndex > personVersions[fatherHash].length) revert InvalidFatherVersionIndex();
    if (motherVersionIndex > personVersions[motherHash].length) revert InvalidMotherVersionIndex();
    if (bytes(tag).length > MAX_LONG_TEXT_LENGTH) revert InvalidTagLength();
    if (bytes(metadataCID).length > MAX_LONG_TEXT_LENGTH) revert InvalidCIDLength();
    bytes32 versionHash = keccak256(
      abi.encode(personHash, fatherHash, motherHash, fatherVersionIndex, motherVersionIndex, tag)
    );
    if (versionExists[personHash][versionHash]) revert DuplicateVersion();
    versionExists[personHash][versionHash] = true;
    personVersions[personHash].push(
      PersonVersion({
        personHash: personHash,
        fatherHash: fatherHash,
        motherHash: motherHash,
        versionIndex: 0,
        fatherVersionIndex: fatherVersionIndex,
        motherVersionIndex: motherVersionIndex,
        tag: tag,
        metadataCID: metadataCID,
        addedBy: msg.sender,
        timestamp: uint96(block.timestamp)
      })
    );
    uint256 versionIndex = personVersions[personHash].length;
    personVersions[personHash][versionIndex - 1].versionIndex = versionIndex;
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
      tag
    );
    if (fatherHash != bytes32(0) && motherHash != bytes32(0)) {
      uint256 reward = IDeepFamilyToken(DEEP_FAMILY_TOKEN_CONTRACT).mint(msg.sender);
      if (reward > 0) {
        emit TokenRewardDistributed(msg.sender, personHash, versionIndex, reward);
      }
    }
  }

  /**
   * @notice Add a person via ZK proof of identity commitment.
   * @dev Public signals order: identityCommitment, fatherIdentityCommitment,
   *      motherIdentityCommitment, submitter, schemaVersion, cryptoSuiteVersion, hashAlgoId
   */
  function addPersonVersion(
    ProofEnvelope calldata proof,
    PersonProofPublicSignals calldata publicSignals,
    uint256 fatherVersionIndex,
    uint256 motherVersionIndex,
    string calldata tag,
    string calldata metadataCID
  ) external nonReentrant {
    if (publicSignals.submitter != uint256(uint160(msg.sender))) revert CallerMismatch();

    address adapter = _getVerifier(proof.proofSystemId, ProofPurpose.PersonCommitment);
    uint256[] memory ps = new uint256[](ProofConstants.PERSON_PUBLIC_SIGNALS_LEN);
    ps[0] = publicSignals.identityCommitment;
    ps[1] = publicSignals.fatherIdentityCommitment;
    ps[2] = publicSignals.motherIdentityCommitment;
    ps[3] = publicSignals.submitter;
    ps[4] = publicSignals.schemaVersion;
    ps[5] = publicSignals.cryptoSuiteVersion;
    ps[6] = publicSignals.hashAlgoId;

    if (
      !IProofVerifierAdapter(adapter).verifyProof(
        uint8(ProofPurpose.PersonCommitment),
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
      tag,
      metadataCID
    );
  }

  function endorseVersion(
    bytes32 personHash,
    uint256 versionIndex,
    AttestationRef calldata attestationRef
  ) external nonReentrant validPersonAndVersion(personHash, versionIndex) {
    bytes32 subjectHash = _computeVersionSubjectHash(personHash, versionIndex);
    bytes32 actionDigest = _computeHighTrustEndorsementActionDigest(
      msg.sender,
      personHash,
      versionIndex
    );
    _validateAttestationRef(
      attestationRef,
      SUBJECT_TYPE_VERSION,
      subjectHash,
      ACTION_TYPE_HIGH_TRUST_ENDORSEMENT,
      actionDigest
    );
    _anchorAttestationRef(attestationRef);
    _endorseVersionInternal(personHash, versionIndex);
  }

  function _endorseVersionInternal(bytes32 personHash, uint256 versionIndex) internal {
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

  /**
   * @notice Mint family tree NFT for a specific person version with a ZK binding proof.
   */
  function mintPersonVersionNFT(
    ProofEnvelope calldata proof,
    DisclosureBindingPublicSignals calldata publicSignals,
    uint256 versionIndex,
    string calldata _tokenURI,
    PersonCoreInfo calldata coreInfo,
    AttestationRef calldata attestationRef
  ) external nonReentrant {
    bytes32 personHash = _wrapIdentityCommitmentAsPersonHash(publicSignals.identityCommitment);
    bytes32 subjectHash = _computeVersionSubjectHash(personHash, versionIndex);
    bytes32 actionDigest = _computeAuthoritativeMintActionDigest(
      msg.sender,
      personHash,
      versionIndex,
      _tokenURI,
      coreInfo
    );
    _validateAttestationRef(
      attestationRef,
      SUBJECT_TYPE_VERSION,
      subjectHash,
      ACTION_TYPE_AUTHORITATIVE_MINT,
      actionDigest
    );
    _anchorAttestationRef(attestationRef);
    _mintPersonVersionNFTInternal(proof, publicSignals, versionIndex, _tokenURI, coreInfo);
  }

  function _mintPersonVersionNFTInternal(
    ProofEnvelope calldata proof,
    DisclosureBindingPublicSignals calldata publicSignals,
    uint256 versionIndex,
    string calldata _tokenURI,
    PersonCoreInfo calldata coreInfo
  ) internal {
    bytes32 personHash = _wrapIdentityCommitmentAsPersonHash(publicSignals.identityCommitment);
    if (personHash == bytes32(0)) revert InvalidPersonHash();
    if (versionIndex == 0 || versionIndex > personVersions[personHash].length) {
      revert InvalidVersionIndex();
    }
    if (publicSignals.minter != uint256(uint160(msg.sender))) revert CallerMismatch();

    _validateMintInput(personHash, versionIndex, _tokenURI, coreInfo);
    _verifyMintProof(proof, publicSignals);
    _validateMintBindings(publicSignals, coreInfo);
    _enforceAdult(coreInfo.basicInfo);

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

  function updateEndorsementFee(
    uint256 newBps,
    AttestationRef calldata attestationRef
  ) external onlyOwner {
    bytes32 actionDigest = _computeProtocolFeeUpdateActionDigest(msg.sender, newBps);
    _validateAttestationRef(
      attestationRef,
      SUBJECT_TYPE_ACTION,
      actionDigest,
      ACTION_TYPE_PROTOCOL_FEE_UPDATE,
      actionDigest
    );
    _anchorAttestationRef(attestationRef);
    _updateEndorsementFeeInternal(newBps);
  }

  function _updateEndorsementFeeInternal(uint256 newBps) internal {
    if (newBps > PROTOCOL_FEE_BPS_MAX) revert ProtocolFeeTooHigh();
    uint256 previous = protocolEndorsementFeeBps;
    if (previous == newBps) {
      return;
    }
    protocolEndorsementFeeBps = newBps;
    emit EndorsementFeeUpdated(previous, newBps);
  }

  function addStoryChunk(
    uint256 tokenId,
    uint256 chunkIndex,
    uint8 chunkType,
    string calldata content,
    string calldata attachmentCID,
    bytes32 expectedHash
  ) external nonReentrant {
    if (_ownerOf(tokenId) != msg.sender) revert MustBeNFTHolder();

    if (bytes(content).length == 0 || bytes(content).length > MAX_CHUNK_CONTENT_LENGTH) {
      revert InvalidChunkContent();
    }

    StoryMetadata storage metadata = storyMetadata[tokenId];

    if (metadata.isSealed) revert StoryAlreadySealed();
    if (chunkIndex != metadata.totalChunks) revert ChunkIndexOutOfRange();

    bytes32 contentHash = _hashString(content);
    if (expectedHash != bytes32(0) && contentHash != expectedHash) {
      revert ChunkHashMismatch();
    }

    if (bytes(attachmentCID).length > MAX_LONG_TEXT_LENGTH) revert InvalidCIDLength();

    StoryChunk storage chunk = storyChunks[tokenId][chunkIndex];
    chunk.chunkIndex = chunkIndex;
    chunk.chunkHash = contentHash;
    chunk.content = content;
    chunk.timestamp = block.timestamp;
    chunk.editor = msg.sender;
    chunk.chunkType = chunkType;
    chunk.attachmentCID = attachmentCID;

    metadata.totalChunks = metadata.totalChunks + 1;
    metadata.lastUpdateTime = block.timestamp;
    metadata.totalLength = metadata.totalLength + bytes(content).length;

    metadata.fullStoryHash = keccak256(
      abi.encodePacked(metadata.fullStoryHash, chunkIndex, contentHash)
    );

    emit StoryChunkAdded(
      tokenId,
      chunkIndex,
      contentHash,
      msg.sender,
      bytes(content).length,
      chunkType,
      attachmentCID
    );
  }

  function sealStory(uint256 tokenId, AttestationRef calldata attestationRef) external {
    bytes32 subjectHash = _computeTokenSubjectHash(tokenId);
    bytes32 actionDigest = _computeStorySealActionDigest(msg.sender, tokenId);
    _validateAttestationRef(
      attestationRef,
      SUBJECT_TYPE_TOKEN,
      subjectHash,
      ACTION_TYPE_STORY_SEAL,
      actionDigest
    );
    _anchorAttestationRef(attestationRef);
    _sealStoryInternal(tokenId);
  }

  function _sealStoryInternal(uint256 tokenId) internal {
    if (_ownerOf(tokenId) != msg.sender) revert MustBeNFTHolder();

    StoryMetadata storage metadata = storyMetadata[tokenId];

    if (metadata.isSealed) revert StoryAlreadySealed();
    if (metadata.totalChunks == 0) revert StoryNotFound();

    metadata.isSealed = true;
    metadata.lastUpdateTime = block.timestamp;

    emit StorySealed(tokenId, metadata.totalChunks, metadata.fullStoryHash, msg.sender);
  }

  // ========== Query Functions ==========

  function getVersionDetails(
    bytes32 personHash,
    uint256 versionIndex
  )
    external
    view
    validPersonAndVersion(personHash, versionIndex)
    returns (PersonVersion memory version, uint256 endorsementCount, uint256 tokenId)
  {
    uint256 arrayIndex = versionIndex - 1;
    version = personVersions[personHash][arrayIndex];
    endorsementCount = versionEndorsementCount[personHash][arrayIndex];
    tokenId = versionToTokenId[personHash][versionIndex];
  }

  function getNFTDetails(
    uint256 tokenId
  )
    external
    view
    returns (
      bytes32 personHash,
      uint256 versionIndex,
      PersonVersion memory version,
      PersonCoreInfo memory coreInfo,
      uint256 endorsementCount,
      string memory nftTokenURI
    )
  {
    _requireOwned(tokenId);
    personHash = tokenIdToPerson[tokenId];

    versionIndex = tokenIdToVersionIndex[tokenId];
    uint256 arrayIndex = versionIndex - 1;

    version = personVersions[personHash][arrayIndex];
    coreInfo = nftCoreInfo[tokenId];
    endorsementCount = versionEndorsementCount[personHash][arrayIndex];
    nftTokenURI = tokenURI(tokenId);
  }

  function getStoryMetadata(uint256 tokenId) external view returns (StoryMetadata memory metadata) {
    _requireOwned(tokenId);
    metadata = storyMetadata[tokenId];
  }

  function getStoryChunk(
    uint256 tokenId,
    uint256 chunkIndex
  ) external view returns (StoryChunk memory chunk) {
    _requireOwned(tokenId);
    StoryMetadata storage metadata = storyMetadata[tokenId];
    if (chunkIndex >= metadata.totalChunks) revert ChunkIndexOutOfRange();
    chunk = storyChunks[tokenId][chunkIndex];
  }

  function listChildren(
    bytes32 parentHash,
    uint256 parentVersionIndex,
    uint256 offset,
    uint256 limit
  )
    external
    view
    returns (
      bytes32[] memory childHashes,
      uint256[] memory childVersionIndices,
      uint256 totalCount,
      bool hasMore,
      uint256 nextOffset
    )
  {
    if (parentHash == bytes32(0)) revert InvalidPersonHash();
    if (parentVersionIndex > personVersions[parentHash].length) {
      revert InvalidVersionIndex();
    }

    ChildRef[] storage allChildren = childrenOf[parentHash][parentVersionIndex];
    totalCount = allChildren.length;

    PaginationResult memory page = _getPaginationParams(totalCount, offset, limit);

    if (page.resultLength == 0) {
      return (new bytes32[](0), new uint256[](0), totalCount, page.hasMore, page.nextOffset);
    }

    childHashes = new bytes32[](page.resultLength);
    childVersionIndices = new uint256[](page.resultLength);

    for (uint256 i = 0; i < page.resultLength; i++) {
      ChildRef storage c = allChildren[page.startIndex + i];
      childHashes[i] = c.childHash;
      childVersionIndices[i] = c.childVersionIndex;
    }

    return (childHashes, childVersionIndices, totalCount, page.hasMore, page.nextOffset);
  }

  function listPersonVersions(
    bytes32 personHash,
    uint256 offset,
    uint256 limit
  )
    external
    view
    returns (
      PersonVersion[] memory versions,
      uint256 totalVersions,
      bool hasMore,
      uint256 nextOffset
    )
  {
    if (personHash == bytes32(0)) revert InvalidPersonHash();
    PersonVersion[] storage allVersions = personVersions[personHash];
    totalVersions = allVersions.length;

    PaginationResult memory page = _getPaginationParams(totalVersions, offset, limit);

    if (page.resultLength == 0) {
      return (new PersonVersion[](0), totalVersions, page.hasMore, page.nextOffset);
    }

    versions = new PersonVersion[](page.resultLength);

    for (uint256 i = 0; i < page.resultLength; i++) {
      versions[i] = allVersions[page.startIndex + i];
    }

    return (versions, totalVersions, page.hasMore, page.nextOffset);
  }

  function listVersionEndorsements(
    bytes32 personHash,
    uint256 offset,
    uint256 limit
  )
    external
    view
    returns (
      uint256[] memory versionIndices,
      uint256[] memory endorsementCounts,
      uint256[] memory tokenIds,
      uint256 totalVersions,
      bool hasMore,
      uint256 nextOffset
    )
  {
    if (personHash == bytes32(0)) revert InvalidPersonHash();
    totalVersions = personVersions[personHash].length;

    PaginationResult memory page = _getPaginationParams(totalVersions, offset, limit);

    if (page.resultLength == 0) {
      return (
        new uint256[](0),
        new uint256[](0),
        new uint256[](0),
        totalVersions,
        page.hasMore,
        page.nextOffset
      );
    }

    versionIndices = new uint256[](page.resultLength);
    endorsementCounts = new uint256[](page.resultLength);
    tokenIds = new uint256[](page.resultLength);

    for (uint256 i = 0; i < page.resultLength; i++) {
      uint256 versionIndex = page.startIndex + i;
      versionIndices[i] = versionIndex + 1;
      endorsementCounts[i] = versionEndorsementCount[personHash][versionIndex];
      tokenIds[i] = versionToTokenId[personHash][versionIndex + 1];
    }

    return (
      versionIndices,
      endorsementCounts,
      tokenIds,
      totalVersions,
      page.hasMore,
      page.nextOffset
    );
  }

  function listUserEndorsements(
    address user,
    uint256 offset,
    uint256 limit
  )
    external
    view
    returns (
      bytes32[] memory personHashes,
      uint256[] memory versionIndices,
      uint256[] memory endorsementCounts,
      uint256[] memory tokenIds,
      uint256 totalCount,
      bool hasMore,
      uint256 nextOffset
    )
  {
    totalCount = userEndorsedPersons[user].length;

    PaginationResult memory page = _getPaginationParams(totalCount, offset, limit);

    if (page.resultLength == 0) {
      return (
        new bytes32[](0),
        new uint256[](0),
        new uint256[](0),
        new uint256[](0),
        totalCount,
        page.hasMore,
        page.nextOffset
      );
    }

    personHashes = new bytes32[](page.resultLength);
    versionIndices = new uint256[](page.resultLength);
    endorsementCounts = new uint256[](page.resultLength);
    tokenIds = new uint256[](page.resultLength);

    for (uint256 i = 0; i < page.resultLength; i++) {
      bytes32 pHash = userEndorsedPersons[user][page.startIndex + i];
      personHashes[i] = pHash;
      versionIndices[i] = endorsedVersionIndex[pHash][user];

      if (versionIndices[i] > 0) {
        endorsementCounts[i] = versionEndorsementCount[pHash][versionIndices[i] - 1];
        tokenIds[i] = versionToTokenId[pHash][versionIndices[i]];
      }
    }

    return (
      personHashes,
      versionIndices,
      endorsementCounts,
      tokenIds,
      totalCount,
      page.hasMore,
      page.nextOffset
    );
  }

  function listTokenURIHistory(
    uint256 tokenId,
    uint256 offset,
    uint256 limit
  )
    external
    view
    returns (string[] memory uris, uint256 totalCount, bool hasMore, uint256 nextOffset)
  {
    _requireOwned(tokenId);
    string[] storage all = tokenURIHistory[tokenId];
    totalCount = all.length;

    PaginationResult memory page = _getPaginationParams(totalCount, offset, limit);

    if (page.resultLength == 0) {
      return (new string[](0), totalCount, page.hasMore, page.nextOffset);
    }

    uris = new string[](page.resultLength);
    for (uint256 i = 0; i < page.resultLength; i++) {
      uris[i] = all[page.startIndex + i];
    }
    return (uris, totalCount, page.hasMore, page.nextOffset);
  }

  function listStoryChunks(
    uint256 tokenId,
    uint256 offset,
    uint256 limit
  )
    external
    view
    returns (StoryChunk[] memory chunks, uint256 totalChunks, bool hasMore, uint256 nextOffset)
  {
    _requireOwned(tokenId);
    StoryMetadata storage metadata = storyMetadata[tokenId];
    totalChunks = metadata.totalChunks;

    PaginationResult memory page = _getPaginationParams(totalChunks, offset, limit);

    if (page.resultLength == 0) {
      return (new StoryChunk[](0), totalChunks, page.hasMore, page.nextOffset);
    }

    chunks = new StoryChunk[](page.resultLength);

    for (uint256 i = 0; i < page.resultLength; i++) {
      chunks[i] = storyChunks[tokenId][page.startIndex + i];
    }

    return (chunks, totalChunks, page.hasMore, page.nextOffset);
  }

  // ===== ETH Reception Path Protection: Reject Direct Transfers =====
  receive() external payable {
    revert DirectETHNotAccepted();
  }

  fallback() external payable {
    revert DirectETHNotAccepted();
  }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import {AttestationTypes} from "./libraries/AttestationTypes.sol";
import {IDeepFamilyAttestationRegistry} from "./interfaces/IDeepFamilyAttestationRegistry.sol";

contract DeepFamilyAttestationRegistry is Ownable, IDeepFamilyAttestationRegistry {
  error InvalidDeepFamilyAddress();
  error DeepFamilyAlreadyBound();
  error OnlyDeepFamily();
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

  uint16 public constant ATTESTATION_REF_VERSION_V1 = 1;
  uint16 public constant SUBJECT_TYPE_VERSION = 2;
  uint16 public constant SUBJECT_TYPE_TOKEN = 3;
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
  string private constant DOMAIN_ATTESTATION_ACTION = "DeepFamily.AttestationAction.V1";
  string private constant DOMAIN_ATTESTATION_SUBJECT_VERSION = "DeepFamily.Subject.Version.V1";
  string private constant DOMAIN_ATTESTATION_SUBJECT_TOKEN = "DeepFamily.Subject.Token.V1";

  address public deepFamily;
  mapping(bytes32 => AttestationTypes.AttestationRef) public attestationRefs;
  mapping(bytes32 => bool) public attestationRefExists;

  event DeepFamilyBound(address indexed deepFamily);

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

  constructor() Ownable(msg.sender) {}

  modifier onlyDeepFamily() {
    if (msg.sender != deepFamily) revert OnlyDeepFamily();
    _;
  }

  function bindDeepFamily(address deepFamily_) external onlyOwner {
    if (deepFamily_ == address(0)) revert InvalidDeepFamilyAddress();
    if (deepFamily != address(0)) revert DeepFamilyAlreadyBound();
    if (deepFamily_.code.length == 0) revert InvalidDeepFamilyAddress();
    (bool ok, bytes memory data) = deepFamily_.staticcall(
      abi.encodeWithSignature("ATTESTATION_REGISTRY()")
    );
    if (!ok || data.length < 32 || abi.decode(data, (address)) != address(this)) {
      revert InvalidDeepFamilyAddress();
    }
    deepFamily = deepFamily_;
    emit DeepFamilyBound(deepFamily_);
  }

  function anchorVerifierUpdateRef(
    AttestationTypes.AttestationRef calldata ref,
    address actor,
    uint16 proofSystemId,
    uint8 purpose,
    address verifier
  ) external onlyDeepFamily returns (bytes32 attestationKey) {
    bytes32 actionDigest = _computeVerifierUpdateActionDigest(
      actor,
      proofSystemId,
      purpose,
      verifier
    );
    return
      _anchorAttestationRef(
        ref,
        SUBJECT_TYPE_ACTION,
        actionDigest,
        ACTION_TYPE_VERIFIER_UPDATE,
        actionDigest
      );
  }

  function anchorEndorsementRef(
    AttestationTypes.AttestationRef calldata ref,
    address actor,
    bytes32 personHash,
    uint256 versionIndex
  ) external onlyDeepFamily returns (bytes32 attestationKey) {
    return
      _anchorAttestationRef(
        ref,
        SUBJECT_TYPE_VERSION,
        _computeVersionSubjectHash(personHash, versionIndex),
        ACTION_TYPE_HIGH_TRUST_ENDORSEMENT,
        _computeEndorsementActionDigest(actor, personHash, versionIndex)
      );
  }

  function anchorMintRef(
    AttestationTypes.AttestationRef calldata ref,
    address actor,
    bytes32 personHash,
    uint256 versionIndex,
    bytes32 tokenURIHash,
    bytes32 coreInfoDigest
  ) external onlyDeepFamily returns (bytes32 attestationKey) {
    return
      _anchorAttestationRef(
        ref,
        SUBJECT_TYPE_VERSION,
        _computeVersionSubjectHash(personHash, versionIndex),
        ACTION_TYPE_AUTHORITATIVE_MINT,
        _computeMintActionDigest(
          actor,
          personHash,
          versionIndex,
          tokenURIHash,
          coreInfoDigest
        )
      );
  }

  function anchorProtocolFeeRef(
    AttestationTypes.AttestationRef calldata ref,
    address actor,
    uint256 newBps
  ) external onlyDeepFamily returns (bytes32 attestationKey) {
    bytes32 actionDigest = _computeProtocolFeeActionDigest(actor, newBps);
    return
      _anchorAttestationRef(
        ref,
        SUBJECT_TYPE_ACTION,
        actionDigest,
        ACTION_TYPE_PROTOCOL_FEE_UPDATE,
        actionDigest
      );
  }

  function anchorStorySealRef(
    AttestationTypes.AttestationRef calldata ref,
    address actor,
    uint256 tokenId,
    uint256 totalChunks,
    bytes32 fullStoryHash
  ) external onlyDeepFamily returns (bytes32 attestationKey) {
    return
      _anchorAttestationRef(
        ref,
        SUBJECT_TYPE_TOKEN,
        _computeTokenSubjectHash(tokenId),
        ACTION_TYPE_STORY_SEAL,
        _computeStorySealActionDigest(actor, tokenId, totalChunks, fullStoryHash)
      );
  }

  function _anchorAttestationRef(
    AttestationTypes.AttestationRef calldata ref,
    uint16 expectedSubjectType,
    bytes32 expectedSubjectHash,
    uint16 expectedActionType,
    bytes32 expectedActionDigest
  ) internal returns (bytes32 attestationKey) {
    _validateAttestationRef(
      ref,
      expectedSubjectType,
      expectedSubjectHash,
      expectedActionType,
      expectedActionDigest
    );
    attestationKey = _computeAttestationKey(ref);
    if (attestationRefExists[attestationKey]) revert DuplicateAttestationReference();

    _storeAttestationRef(attestationKey, ref);
    _emitAttestationReferenceAnchored(attestationKey, ref);
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

  function _computeMintActionDigest(
    address actor,
    bytes32 personHash,
    uint256 versionIndex,
    bytes32 tokenURIHash,
    bytes32 coreInfoDigest
  ) internal view returns (bytes32) {
    return
      keccak256(
        abi.encode(
          DOMAIN_ATTESTATION_ACTION,
          block.chainid,
          deepFamily,
          ACTION_TYPE_AUTHORITATIVE_MINT,
          actor,
          personHash,
          versionIndex,
          tokenURIHash,
          coreInfoDigest
        )
      );
  }

  function _computeEndorsementActionDigest(
    address actor,
    bytes32 personHash,
    uint256 versionIndex
  ) internal view returns (bytes32) {
    return
      keccak256(
        abi.encode(
          DOMAIN_ATTESTATION_ACTION,
          block.chainid,
          deepFamily,
          ACTION_TYPE_HIGH_TRUST_ENDORSEMENT,
          actor,
          personHash,
          versionIndex
        )
      );
  }

  function _computeStorySealActionDigest(
    address actor,
    uint256 tokenId,
    uint256 totalChunks,
    bytes32 fullStoryHash
  ) internal view returns (bytes32) {
    return
      keccak256(
        abi.encode(
          DOMAIN_ATTESTATION_ACTION,
          block.chainid,
          deepFamily,
          ACTION_TYPE_STORY_SEAL,
          actor,
          tokenId,
          totalChunks,
          fullStoryHash
        )
      );
  }

  function _computeVerifierUpdateActionDigest(
    address actor,
    uint16 proofSystemId,
    uint8 purpose,
    address verifier
  ) internal view returns (bytes32) {
    return
      keccak256(
        abi.encode(
          DOMAIN_ATTESTATION_ACTION,
          block.chainid,
          deepFamily,
          ACTION_TYPE_VERIFIER_UPDATE,
          actor,
          proofSystemId,
          purpose,
          verifier
        )
      );
  }

  function _computeProtocolFeeActionDigest(
    address actor,
    uint256 newBps
  ) internal view returns (bytes32) {
    return
      keccak256(
        abi.encode(
          DOMAIN_ATTESTATION_ACTION,
          block.chainid,
          deepFamily,
          ACTION_TYPE_PROTOCOL_FEE_UPDATE,
          actor,
          newBps
        )
      );
  }

  function _storeAttestationRef(
    bytes32 attestationKey,
    AttestationTypes.AttestationRef calldata ref
  ) internal {
    attestationRefs[attestationKey] = ref;
    attestationRefExists[attestationKey] = true;
  }

  function _emitAttestationReferenceAnchored(
    bytes32 attestationKey,
    AttestationTypes.AttestationRef calldata ref
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

  function computeAttestationKey(
    AttestationTypes.AttestationRef calldata ref
  ) external pure returns (bytes32) {
    return _computeAttestationKey(ref);
  }

  function _computeAttestationKey(
    AttestationTypes.AttestationRef calldata ref
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

  function _validateAttestationRef(
    AttestationTypes.AttestationRef calldata ref,
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
    return
      uriBytes.length >= 4 &&
      uriBytes[0] == bytes1("b") &&
      uriBytes[1] == bytes1("a") &&
      uriBytes[2] == bytes1("f") &&
      uriBytes[3] == bytes1("y");
  }
}

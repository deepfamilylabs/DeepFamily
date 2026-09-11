// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IDeepFamilyArchive} from "./interfaces/IDeepFamilyArchive.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface IArchiveDeepFamily {
  function archive() external view returns (address);
  function ownerOf(uint256 tokenId) external view returns (address);
}

/** @dev Constructor-only data contract shared by segments and manifest pages. */
contract ArchiveData {
  constructor(bytes memory data) {
    bytes memory runtime = bytes.concat(hex"00", data);
    assembly ("memory-safe") {
      return(add(runtime, 0x20), mload(runtime))
    }
  }
}

/** @notice Immutable archive. Each logical blob and all its pages are created atomically. */
contract DeepFamilyArchive is IDeepFamilyArchive, ERC165 {
  error InvalidDeepFamilyAddress();
  error UnauthorizedCaller();
  error ArchiveNotActive();
  error InvalidPayloadLength();
  error MetadataAlreadyStored();
  error MustBeNFTHolder();
  error InvalidSchemaId();
  error PayloadHashMismatch();
  error StoryIndexMismatch();
  error StoryHeadMismatch();
  error StoryAlreadySealed();
  error StoryNotFound();
  error StoryAlreadyInitialized();
  error InvalidStoryAuthor();

  uint256 public constant MAX_SEGMENT_PAYLOAD_LENGTH = 16_384;
  uint256 public constant MAX_MANIFEST_ENTRIES = 1_024;
  bytes32 public constant STORY_RECORD_DOMAIN = keccak256("deepfamily.archive.story-record.v1");
  bytes32 public constant STORY_HEAD_DOMAIN = keccak256("deepfamily.archive.story-head.v1");
  bytes32 public constant BIOGRAPHY_SCHEMA_ID =
    keccak256("deepfamily/story-biography-envelope@1.0");
  address public immutable override DEEP_FAMILY;

  mapping(bytes32 personHash => mapping(uint256 versionIndex => BlobRef blob))
    private _metadataRefs;
  mapping(uint256 tokenId => mapping(uint64 index => StoryRecordRef record)) private _storyRecords;
  mapping(uint256 tokenId => StoryState state) private _storyStates;
  mapping(uint256 tokenId => bool initialized) private _storyInitialized;

  constructor(address deepFamily) {
    if (deepFamily == address(0) || deepFamily.code.length == 0) revert InvalidDeepFamilyAddress();
    DEEP_FAMILY = deepFamily;
  }

  function archiveKind() external pure override returns (bytes32) {
    return keccak256("deepfamily.archive.v1");
  }

  function apiVersion() external pure override returns (uint256) {
    return 1;
  }

  function supportsInterface(
    bytes4 interfaceId
  ) public view override(ERC165, IERC165) returns (bool) {
    return
      interfaceId == type(IDeepFamilyArchive).interfaceId || super.supportsInterface(interfaceId);
  }

  function storeMetadata(
    bytes32 personHash,
    uint256 versionIndex,
    bytes calldata envelope
  ) external override returns (BlobRef memory blob) {
    if (msg.sender != DEEP_FAMILY) revert UnauthorizedCaller();
    _requireActive();
    if (_metadataRefs[personHash][versionIndex].pointer != address(0))
      revert MetadataAlreadyStored();
    blob = _storeBlob(envelope);
    _metadataRefs[personHash][versionIndex] = blob;
    emit MetadataStored(personHash, versionIndex, blob);
  }

  function metadataRef(
    bytes32 personHash,
    uint256 versionIndex
  ) external view override returns (BlobRef memory blob) {
    return _metadataRefs[personHash][versionIndex];
  }

  /** @notice Seed a mint's immutable biography before its ERC721 receiver callback. */
  function initializeStory(
    uint256 tokenId,
    address author,
    bytes calldata payload,
    bytes32 expectedPayloadHash
  ) external override {
    if (msg.sender != DEEP_FAMILY) revert UnauthorizedCaller();
    _requireActive();
    StoryState storage state = _storyStates[tokenId];
    if (_storyInitialized[tokenId] || state.totalRecords != 0 || state.isSealed)
      revert StoryAlreadyInitialized();
    if (author == address(0)) revert InvalidStoryAuthor();
    if (keccak256(payload) != expectedPayloadHash) revert PayloadHashMismatch();
    _storyInitialized[tokenId] = true;
    if (payload.length != 0) _appendRecord(tokenId, BIOGRAPHY_SCHEMA_ID, payload, author);
  }

  function appendStoryRecord(
    uint256 tokenId,
    uint64 expectedIndex,
    bytes32 expectedHead,
    bytes32 schemaId,
    bytes calldata payload,
    bytes32 expectedPayloadHash
  ) external override returns (StoryRecordRef memory record) {
    _requireActive();
    _requireNFTHolder(tokenId);
    StoryState storage state = _storyStates[tokenId];
    if (state.isSealed) revert StoryAlreadySealed();
    if (expectedIndex != state.totalRecords) revert StoryIndexMismatch();
    if (expectedHead != state.recordsHead) revert StoryHeadMismatch();
    if (schemaId == bytes32(0) || schemaId == BIOGRAPHY_SCHEMA_ID) revert InvalidSchemaId();
    if (keccak256(payload) != expectedPayloadHash) revert PayloadHashMismatch();
    return _appendRecord(tokenId, schemaId, payload, msg.sender);
  }

  function _appendRecord(
    uint256 tokenId,
    bytes32 schemaId,
    bytes calldata payload,
    address author
  ) internal returns (StoryRecordRef memory record) {
    StoryState storage state = _storyStates[tokenId];
    uint64 index = state.totalRecords;
    record = StoryRecordRef({
      blob: _storeBlob(payload),
      schemaId: schemaId,
      author: author,
      timestamp: uint64(block.timestamp)
    });
    bytes32 recordHash = _recordHash(block.chainid, address(this), tokenId, index, record);
    bytes32 newHead = _nextHead(state.recordsHead, recordHash);
    _storyRecords[tokenId][index] = record;
    state.recordsHead = newHead;
    state.totalRecords += 1;
    state.totalPayloadLength += record.blob.payloadLength;
    state.lastUpdateTime = record.timestamp;
    emit StoryRecordAppended(
      tokenId,
      index,
      record.blob,
      schemaId,
      record.author,
      record.timestamp,
      recordHash,
      newHead
    );
  }

  function sealStory(
    uint256 tokenId,
    uint64 expectedCount,
    bytes32 expectedHead
  ) external override returns (StoryState memory state) {
    _requireActive();
    _requireNFTHolder(tokenId);
    StoryState storage stored = _storyStates[tokenId];
    if (stored.isSealed) revert StoryAlreadySealed();
    if (expectedCount != stored.totalRecords) revert StoryIndexMismatch();
    if (expectedHead != stored.recordsHead) revert StoryHeadMismatch();
    if (stored.totalRecords == 0) revert StoryNotFound();
    stored.isSealed = true;
    stored.lastUpdateTime = uint64(block.timestamp);
    state = stored;
    emit StorySealed(
      tokenId,
      state.totalRecords,
      state.recordsHead,
      state.totalPayloadLength,
      msg.sender,
      state.lastUpdateTime
    );
  }

  function storyRecordRef(
    uint256 tokenId,
    uint64 index
  ) external view override returns (StoryRecordRef memory record) {
    return _storyRecords[tokenId][index];
  }

  function storyState(uint256 tokenId) external view override returns (StoryState memory state) {
    return _storyStates[tokenId];
  }

  function _recordHash(
    uint256 chainId,
    address archiveAddress,
    uint256 tokenId,
    uint64 index,
    StoryRecordRef memory record
  ) internal pure returns (bytes32) {
    return
      keccak256(
        abi.encode(
          STORY_RECORD_DOMAIN,
          chainId,
          archiveAddress,
          tokenId,
          index,
          record.schemaId,
          record.blob.payloadHash,
          record.blob.payloadLength,
          record.author,
          record.timestamp
        )
      );
  }

  function _nextHead(bytes32 previousHead, bytes32 recordHash) internal pure returns (bytes32) {
    return keccak256(abi.encode(STORY_HEAD_DOMAIN, previousHead, recordHash));
  }

  function _storeBlob(bytes calldata payload) internal returns (BlobRef memory blob) {
    uint256 length = payload.length;
    if (length == 0 || length > type(uint64).max) revert InvalidPayloadLength();
    uint256 count = (length - 1) / MAX_SEGMENT_PAYLOAD_LENGTH + 1;
    if (count > type(uint32).max) revert InvalidPayloadLength();
    blob.payloadHash = keccak256(payload);
    blob.payloadLength = uint64(length);
    blob.segmentCount = uint32(count);
    address[] memory segments = new address[](count);
    for (uint256 i; i < count; i++) {
      uint256 start = i * MAX_SEGMENT_PAYLOAD_LENGTH;
      uint256 end = start + MAX_SEGMENT_PAYLOAD_LENGTH;
      if (end > length) end = length;
      segments[i] = _deployData(payload[start:end]);
    }
    blob.pointer = count == 1 ? segments[0] : _storeManifest(segments, blob);
  }

  function _storeManifest(
    address[] memory segments,
    BlobRef memory blob
  ) internal returns (address nextPage) {
    uint256 pageCount = (segments.length - 1) / MAX_MANIFEST_ENTRIES + 1;
    for (uint256 remaining = pageCount; remaining > 0; remaining--) {
      uint256 pageIndex = remaining - 1;
      uint256 firstIndex = pageIndex * MAX_MANIFEST_ENTRIES;
      uint256 entries = segments.length - firstIndex;
      if (entries > MAX_MANIFEST_ENTRIES) entries = MAX_MANIFEST_ENTRIES;
      // Twelve spare bytes keep the final 32-byte address store inside allocated memory.
      bytes memory packedAddresses = new bytes(entries * 20 + 12);
      for (uint256 i; i < entries; i++) {
        address segment = segments[firstIndex + i];
        assembly ("memory-safe") {
          mstore(add(add(packedAddresses, 0x20), mul(i, 20)), shl(96, segment))
        }
      }
      assembly ("memory-safe") {
        mstore(packedAddresses, mul(entries, 20))
      }
      nextPage = _deployData(
        abi.encodePacked(
          bytes4("DFBP"),
          uint8(1),
          uint32(pageIndex),
          uint32(pageCount),
          uint32(firstIndex),
          uint32(entries),
          nextPage,
          blob.payloadLength,
          blob.segmentCount,
          blob.payloadHash,
          packedAddresses
        )
      );
    }
  }

  function _deployData(bytes memory data) internal virtual returns (address) {
    return address(new ArchiveData(data));
  }

  function _requireActive() private view {
    try IArchiveDeepFamily(DEEP_FAMILY).archive() returns (address configured) {
      if (configured != address(this)) revert ArchiveNotActive();
    } catch {
      revert ArchiveNotActive();
    }
  }

  function _requireNFTHolder(uint256 tokenId) private view {
    try IArchiveDeepFamily(DEEP_FAMILY).ownerOf(tokenId) returns (address owner) {
      if (owner != msg.sender) revert MustBeNFTHolder();
    } catch {
      revert MustBeNFTHolder();
    }
  }
}

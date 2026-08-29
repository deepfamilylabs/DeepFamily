// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IStoryArchiveV1} from "./interfaces/IStoryArchiveV1.sol";

interface IStoryNFTOwner {
  function ownerOf(uint256 tokenId) external view returns (address owner);
}

/**
 * @dev Constructor-only data contract. Its deployed runtime is exactly
 *      `0x00 || content`, where the leading STOP byte is not part of the content.
 */
contract StoryBlobV1 {
  constructor(bytes memory content) {
    bytes memory runtime = bytes.concat(hex"00", content);
    assembly ("memory-safe") {
      return(add(runtime, 0x20), mload(runtime))
    }
  }
}

/**
 * @title StoryArchiveV1
 * @notice Immutable owner and public API for all story chunks, aggregate metadata, sealing state,
 *         and content references.
 * @dev NFT-holder authorization is resolved against DeepFamily. Content bytes live in
 *      STOP-prefixed data contracts; all headers, validation, and aggregate story state live here.
 */
contract StoryArchiveV1 is IStoryArchiveV1 {
  error InvalidDeepFamilyAddress();
  error MustBeNFTHolder();
  error InvalidChunkContent();
  error ChunkHashMismatch();
  error InvalidCIDLength();
  error StoryAlreadyStored();
  error StoryAlreadySealed();
  error ChunkIndexOutOfRange();
  error StoryNotFound();
  error InvalidStoryContent();

  uint256 public constant MAX_CONTENT_LENGTH = 16_384;
  uint256 public constant MAX_ATTACHMENT_CID_LENGTH = 256;

  address public immutable override DEEP_FAMILY;

  struct StoryChunkHeader {
    bytes32 chunkHash;
    uint64 timestamp;
    address editor;
    uint8 chunkType;
    string attachmentCID;
  }

  mapping(uint256 tokenId => mapping(uint256 chunkIndex => StoryRef story)) private _storyRefs;
  mapping(uint256 tokenId => StoryMetadata metadata) private _storyMetadata;
  mapping(uint256 tokenId => mapping(uint256 chunkIndex => StoryChunkHeader header))
    private _storyChunkHeaders;

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

  constructor(address deepFamily) {
    if (deepFamily == address(0) || deepFamily.code.length == 0) {
      revert InvalidDeepFamilyAddress();
    }
    DEEP_FAMILY = deepFamily;
  }

  function addStoryChunk(
    uint256 tokenId,
    uint256 chunkIndex,
    uint8 chunkType,
    string calldata content,
    string calldata attachmentCID,
    bytes32 expectedHash
  ) external override returns (StoryRef memory story) {
    _requireNFTHolder(tokenId);

    bytes memory contentBytes = bytes(content);
    uint256 contentLength = contentBytes.length;
    if (contentLength == 0 || contentLength > MAX_CONTENT_LENGTH) {
      revert InvalidChunkContent();
    }
    bytes32 contentHash = keccak256(contentBytes);
    if (expectedHash != bytes32(0) && expectedHash != contentHash) revert ChunkHashMismatch();
    if (bytes(attachmentCID).length > MAX_ATTACHMENT_CID_LENGTH) revert InvalidCIDLength();

    StoryMetadata storage metadata = _storyMetadata[tokenId];
    if (metadata.isSealed) revert StoryAlreadySealed();
    if (_storyRefs[tokenId][chunkIndex].pointer != address(0)) revert StoryAlreadyStored();
    if (chunkIndex != metadata.totalChunks) revert ChunkIndexOutOfRange();

    address pointer = address(new StoryBlobV1(contentBytes));
    story = StoryRef({
      pointer: pointer,
      contentHash: contentHash,
      contentLength: uint32(contentLength)
    });
    _storyRefs[tokenId][chunkIndex] = story;

    StoryChunkHeader storage header = _storyChunkHeaders[tokenId][chunkIndex];
    header.chunkHash = story.contentHash;
    header.timestamp = uint64(block.timestamp);
    header.editor = msg.sender;
    header.chunkType = chunkType;
    header.attachmentCID = attachmentCID;

    metadata.totalChunks += 1;
    metadata.fullStoryHash = keccak256(
      abi.encodePacked(metadata.fullStoryHash, chunkIndex, story.contentHash)
    );
    metadata.lastUpdateTime = uint64(block.timestamp);
    metadata.totalLength += uint64(contentLength);

    emit StoryChunkAdded(
      tokenId,
      chunkIndex,
      story.contentHash,
      msg.sender,
      contentLength,
      chunkType,
      attachmentCID
    );
  }

  function sealStory(uint256 tokenId) external override returns (StoryMetadata memory metadata) {
    _requireNFTHolder(tokenId);

    StoryMetadata storage stored = _storyMetadata[tokenId];
    if (stored.isSealed) revert StoryAlreadySealed();
    if (stored.totalChunks == 0) revert StoryNotFound();

    stored.isSealed = true;
    stored.lastUpdateTime = uint64(block.timestamp);
    metadata = stored;
    emit StorySealed(tokenId, metadata.totalChunks, metadata.fullStoryHash, msg.sender);
  }

  function storyRef(
    uint256 tokenId,
    uint256 chunkIndex
  ) external view override returns (StoryRef memory story) {
    return _storyRefs[tokenId][chunkIndex];
  }

  function getStoryMetadata(
    uint256 tokenId
  ) external view override returns (StoryMetadata memory metadata) {
    return _storyMetadata[tokenId];
  }

  function getStoryChunk(
    uint256 tokenId,
    uint256 chunkIndex
  ) external view override returns (StoryChunk memory chunk) {
    if (chunkIndex >= _storyMetadata[tokenId].totalChunks) revert ChunkIndexOutOfRange();

    StoryRef memory archived = _storyRefs[tokenId][chunkIndex];
    StoryChunkHeader storage header = _storyChunkHeaders[tokenId][chunkIndex];
    if (archived.pointer == address(0) || header.chunkHash != archived.contentHash) {
      revert InvalidStoryContent();
    }

    chunk = StoryChunk({
      chunkIndex: chunkIndex,
      chunkHash: header.chunkHash,
      content: _readStoryContent(archived),
      timestamp: header.timestamp,
      editor: header.editor,
      chunkType: header.chunkType,
      attachmentCID: header.attachmentCID
    });
  }

  function _readStoryContent(
    StoryRef memory archived
  ) private view returns (string memory content) {
    uint256 contentLength = archived.contentLength;
    if (contentLength == 0) revert InvalidStoryContent();

    bytes memory runtime = archived.pointer.code;
    if (runtime.length != contentLength + 1 || runtime[0] != bytes1(0)) {
      revert InvalidStoryContent();
    }

    bytes memory contentBytes = new bytes(contentLength);
    assembly ("memory-safe") {
      mcopy(add(contentBytes, 0x20), add(runtime, 0x21), contentLength)
    }
    if (keccak256(contentBytes) != archived.contentHash) revert InvalidStoryContent();
    return string(contentBytes);
  }

  function _requireNFTHolder(uint256 tokenId) private view {
    address tokenOwner;
    try IStoryNFTOwner(DEEP_FAMILY).ownerOf(tokenId) returns (address owner) {
      tokenOwner = owner;
    } catch {
      revert MustBeNFTHolder();
    }
    if (tokenOwner != msg.sender) revert MustBeNFTHolder();
  }
}

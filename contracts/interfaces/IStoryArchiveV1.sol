// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IStoryArchiveV1
 * @notice Immutable owner, write API, and read API for all public-story state.
 */
interface IStoryArchiveV1 {
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
    uint64 totalChunks;
    bytes32 fullStoryHash;
    uint64 lastUpdateTime;
    bool isSealed;
    uint64 totalLength;
  }

  struct StoryRef {
    address pointer;
    bytes32 contentHash;
    uint32 contentLength;
  }

  function DEEP_FAMILY() external view returns (address);

  function addStoryChunk(
    uint256 tokenId,
    uint256 chunkIndex,
    uint8 chunkType,
    string calldata content,
    string calldata attachmentCID,
    bytes32 expectedHash
  ) external returns (StoryRef memory story);

  function sealStory(uint256 tokenId) external returns (StoryMetadata memory metadata);

  function storyRef(
    uint256 tokenId,
    uint256 chunkIndex
  ) external view returns (StoryRef memory story);

  function getStoryMetadata(uint256 tokenId) external view returns (StoryMetadata memory metadata);

  function getStoryChunk(
    uint256 tokenId,
    uint256 chunkIndex
  ) external view returns (StoryChunk memory chunk);
}

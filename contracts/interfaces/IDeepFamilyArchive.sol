// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/** @notice Immutable metadata and append-only story archive protocol. */
interface IDeepFamilyArchive is IERC165 {
  struct BlobRef {
    bytes32 payloadHash;
    address pointer;
    uint64 payloadLength;
    uint32 segmentCount;
  }

  struct StoryRecordRef {
    BlobRef blob;
    bytes32 schemaId;
    address author;
    uint64 timestamp;
  }

  struct StoryState {
    bytes32 recordsHead;
    uint64 totalRecords;
    uint64 totalPayloadLength;
    uint64 lastUpdateTime;
    bool isSealed;
  }

  event MetadataStored(bytes32 indexed personHash, uint256 indexed versionIndex, BlobRef blob);
  event StoryRecordAppended(
    uint256 indexed tokenId,
    uint64 indexed index,
    BlobRef blob,
    bytes32 schemaId,
    address indexed author,
    uint64 timestamp,
    bytes32 recordHash,
    bytes32 newHead
  );
  event StorySealed(
    uint256 indexed tokenId,
    uint64 totalRecords,
    bytes32 recordsHead,
    uint64 totalPayloadLength,
    address indexed sealer,
    uint64 timestamp
  );

  function DEEP_FAMILY() external view returns (address);
  function archiveKind() external pure returns (bytes32);
  function apiVersion() external pure returns (uint256);
  function storeMetadata(
    bytes32 personHash,
    uint256 versionIndex,
    bytes calldata envelope
  ) external returns (BlobRef memory blob);
  function metadataRef(
    bytes32 personHash,
    uint256 versionIndex
  ) external view returns (BlobRef memory blob);
  function initializeStory(
    uint256 tokenId,
    address author,
    bytes calldata payload,
    bytes32 expectedPayloadHash
  ) external;
  function appendStoryRecord(
    uint256 tokenId,
    uint64 expectedIndex,
    bytes32 expectedHead,
    bytes32 schemaId,
    bytes calldata payload,
    bytes32 expectedPayloadHash
  ) external returns (StoryRecordRef memory record);
  function sealStory(
    uint256 tokenId,
    uint64 expectedCount,
    bytes32 expectedHead
  ) external returns (StoryState memory state);
  function storyRecordRef(
    uint256 tokenId,
    uint64 index
  ) external view returns (StoryRecordRef memory record);
  function storyState(uint256 tokenId) external view returns (StoryState memory state);
}

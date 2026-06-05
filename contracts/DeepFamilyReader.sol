// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {DeepFamily} from "./DeepFamily.sol";

contract DeepFamilyReader {
  error InvalidDeepFamilyAddress();
  error InvalidPersonHash();
  error InvalidVersionIndex();
  error ChunkIndexOutOfRange();
  error PageSizeExceedsLimit();

  struct PaginationResult {
    uint256 startIndex;
    uint256 resultLength;
    uint256 nextOffset;
    bool hasMore;
  }

  struct UserEndorsementItem {
    bytes32 personHash;
    uint256 versionIndex;
    uint256 endorsementCount;
    uint256 tokenId;
  }

  uint256 public constant MAX_QUERY_PAGE_SIZE = 200;
  DeepFamily public immutable DEEP_FAMILY;

  constructor(address deepFamily) {
    if (deepFamily == address(0)) revert InvalidDeepFamilyAddress();
    DEEP_FAMILY = DeepFamily(payable(deepFamily));
  }

  function getVersionDetails(
    bytes32 personHash,
    uint256 versionIndex
  )
    external
    view
    returns (DeepFamily.PersonVersion memory version, uint256 endorsementCount, uint256 tokenId)
  {
    _validateVersion(personHash, versionIndex);
    uint256 arrayIndex = versionIndex - 1;
    version = _readPersonVersion(personHash, arrayIndex);
    endorsementCount = DEEP_FAMILY.versionEndorsementCount(personHash, arrayIndex);
    tokenId = DEEP_FAMILY.versionToTokenId(personHash, versionIndex);
  }

  function getNFTDetails(
    uint256 tokenId
  )
    external
    view
    returns (
      bytes32 personHash,
      uint256 versionIndex,
      DeepFamily.PersonVersion memory version,
      DeepFamily.PersonCoreInfo memory coreInfo,
      uint256 endorsementCount,
      string memory nftTokenURI
    )
  {
    _requireOwned(tokenId);
    personHash = DEEP_FAMILY.tokenIdToPerson(tokenId);
    versionIndex = DEEP_FAMILY.tokenIdToVersionIndex(tokenId);
    uint256 arrayIndex = versionIndex - 1;
    version = _readPersonVersion(personHash, arrayIndex);
    coreInfo = _readCoreInfo(tokenId);
    endorsementCount = DEEP_FAMILY.versionEndorsementCount(personHash, arrayIndex);
    nftTokenURI = DEEP_FAMILY.tokenURI(tokenId);
  }

  function getStoryMetadata(
    uint256 tokenId
  ) external view returns (DeepFamily.StoryMetadata memory metadata) {
    _requireOwned(tokenId);
    return _readStoryMetadata(tokenId);
  }

  function getStoryChunk(
    uint256 tokenId,
    uint256 chunkIndex
  ) external view returns (DeepFamily.StoryChunk memory chunk) {
    _requireOwned(tokenId);
    DeepFamily.StoryMetadata memory metadata = _readStoryMetadata(tokenId);
    if (chunkIndex >= metadata.totalChunks) revert ChunkIndexOutOfRange();
    return _readStoryChunk(tokenId, chunkIndex);
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
    if (parentVersionIndex > DEEP_FAMILY.personVersionsCount(parentHash)) {
      revert InvalidVersionIndex();
    }

    totalCount = DEEP_FAMILY.childrenCount(parentHash, parentVersionIndex);
    PaginationResult memory page = _getPaginationParams(totalCount, offset, limit);
    if (page.resultLength == 0) {
      return (new bytes32[](0), new uint256[](0), totalCount, page.hasMore, page.nextOffset);
    }

    childHashes = new bytes32[](page.resultLength);
    childVersionIndices = new uint256[](page.resultLength);
    for (uint256 i = 0; i < page.resultLength; i++) {
      (bytes32 childHash, uint256 childVersionIndex) = DEEP_FAMILY.childrenOf(
        parentHash,
        parentVersionIndex,
        page.startIndex + i
      );
      childHashes[i] = childHash;
      childVersionIndices[i] = childVersionIndex;
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
      DeepFamily.PersonVersion[] memory versions,
      uint256 totalVersions,
      bool hasMore,
      uint256 nextOffset
    )
  {
    if (personHash == bytes32(0)) revert InvalidPersonHash();
    totalVersions = DEEP_FAMILY.personVersionsCount(personHash);
    PaginationResult memory page = _getPaginationParams(totalVersions, offset, limit);
    if (page.resultLength == 0) {
      return (new DeepFamily.PersonVersion[](0), totalVersions, page.hasMore, page.nextOffset);
    }

    versions = new DeepFamily.PersonVersion[](page.resultLength);
    for (uint256 i = 0; i < page.resultLength; i++) {
      versions[i] = _readPersonVersion(personHash, page.startIndex + i);
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
    totalVersions = DEEP_FAMILY.personVersionsCount(personHash);
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
      uint256 arrayIndex = page.startIndex + i;
      versionIndices[i] = arrayIndex + 1;
      endorsementCounts[i] = DEEP_FAMILY.versionEndorsementCount(personHash, arrayIndex);
      tokenIds[i] = DEEP_FAMILY.versionToTokenId(personHash, arrayIndex + 1);
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
    totalCount = DEEP_FAMILY.userEndorsedPersonsCount(user);
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
      UserEndorsementItem memory item = _readUserEndorsement(user, page.startIndex + i);
      personHashes[i] = item.personHash;
      versionIndices[i] = item.versionIndex;
      endorsementCounts[i] = item.endorsementCount;
      tokenIds[i] = item.tokenId;
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

  function listTrustedEndorsers(
    bytes32 personHash,
    uint256 versionIndex,
    uint256 offset,
    uint256 limit
  )
    external
    view
    returns (address[] memory accounts, uint256 totalCount, bool hasMore, uint256 nextOffset)
  {
    _validateVersion(personHash, versionIndex);
    totalCount = DEEP_FAMILY.trustedEndorsersCount(personHash, versionIndex);
    PaginationResult memory page = _getPaginationParams(totalCount, offset, limit);
    if (page.resultLength == 0) {
      return (new address[](0), totalCount, page.hasMore, page.nextOffset);
    }

    accounts = new address[](page.resultLength);
    for (uint256 i = 0; i < page.resultLength; i++) {
      accounts[i] = DEEP_FAMILY.trustedEndorserAt(personHash, versionIndex, page.startIndex + i);
    }
    return (accounts, totalCount, page.hasMore, page.nextOffset);
  }

  function isVersionEndorsedByAny(
    bytes32 personHash,
    uint256 versionIndex,
    address[] calldata accounts
  ) external view returns (bool) {
    _validateVersion(personHash, versionIndex);
    for (uint256 i = 0; i < accounts.length; i++) {
      if (DEEP_FAMILY.endorsedVersionIndex(personHash, accounts[i]) == versionIndex) {
        return true;
      }
    }
    return false;
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
    totalCount = DEEP_FAMILY.tokenURIHistoryCount(tokenId);
    PaginationResult memory page = _getPaginationParams(totalCount, offset, limit);
    if (page.resultLength == 0) {
      return (new string[](0), totalCount, page.hasMore, page.nextOffset);
    }

    uris = new string[](page.resultLength);
    for (uint256 i = 0; i < page.resultLength; i++) {
      uris[i] = DEEP_FAMILY.tokenURIHistory(tokenId, page.startIndex + i);
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
    returns (
      DeepFamily.StoryChunk[] memory chunks,
      uint256 totalChunks,
      bool hasMore,
      uint256 nextOffset
    )
  {
    _requireOwned(tokenId);
    totalChunks = _readStoryMetadata(tokenId).totalChunks;
    PaginationResult memory page = _getPaginationParams(totalChunks, offset, limit);
    if (page.resultLength == 0) {
      return (new DeepFamily.StoryChunk[](0), totalChunks, page.hasMore, page.nextOffset);
    }

    chunks = new DeepFamily.StoryChunk[](page.resultLength);
    for (uint256 i = 0; i < page.resultLength; i++) {
      chunks[i] = _readStoryChunk(tokenId, page.startIndex + i);
    }
    return (chunks, totalChunks, page.hasMore, page.nextOffset);
  }

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
        resultLength: endIndex - offset,
        nextOffset: endIndex,
        hasMore: endIndex < totalCount
      });
  }

  function _validateVersion(bytes32 personHash, uint256 versionIndex) internal view {
    if (personHash == bytes32(0)) revert InvalidPersonHash();
    if (versionIndex == 0 || versionIndex > DEEP_FAMILY.personVersionsCount(personHash)) {
      revert InvalidVersionIndex();
    }
  }

  function _requireOwned(uint256 tokenId) internal view {
    DEEP_FAMILY.ownerOf(tokenId);
  }

  function _readPersonVersion(
    bytes32 personHash,
    uint256 arrayIndex
  ) internal view returns (DeepFamily.PersonVersion memory version) {
    return DEEP_FAMILY.personVersionAt(personHash, arrayIndex);
  }

  function _readCoreInfo(
    uint256 tokenId
  ) internal view returns (DeepFamily.PersonCoreInfo memory coreInfo) {
    (coreInfo.basicInfo, coreInfo.supplementInfo) = DEEP_FAMILY.nftCoreInfo(tokenId);
  }

  function _readStoryMetadata(
    uint256 tokenId
  ) internal view returns (DeepFamily.StoryMetadata memory metadata) {
    (
      metadata.totalChunks,
      metadata.fullStoryHash,
      metadata.lastUpdateTime,
      metadata.isSealed,
      metadata.totalLength
    ) = DEEP_FAMILY.storyMetadata(tokenId);
  }

  function _readStoryChunk(
    uint256 tokenId,
    uint256 chunkIndex
  ) internal view returns (DeepFamily.StoryChunk memory chunk) {
    (
      chunk.chunkIndex,
      chunk.chunkHash,
      chunk.content,
      chunk.timestamp,
      chunk.editor,
      chunk.chunkType,
      chunk.attachmentCID
    ) = DEEP_FAMILY.storyChunks(tokenId, chunkIndex);
  }

  function _readUserEndorsement(
    address user,
    uint256 index
  ) internal view returns (UserEndorsementItem memory item) {
    item.personHash = DEEP_FAMILY.userEndorsedPersonAt(user, index);
    item.versionIndex = DEEP_FAMILY.endorsedVersionIndex(item.personHash, user);
    if (item.versionIndex > 0) {
      item.endorsementCount = DEEP_FAMILY.versionEndorsementCount(
        item.personHash,
        item.versionIndex - 1
      );
      item.tokenId = DEEP_FAMILY.versionToTokenId(item.personHash, item.versionIndex);
    }
  }
}

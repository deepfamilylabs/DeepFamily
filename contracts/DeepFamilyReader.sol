// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {DeepFamily} from "./DeepFamily.sol";
import {IDeepFamilyArchive} from "./interfaces/IDeepFamilyArchive.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

contract DeepFamilyReader {
  error InvalidDeepFamilyAddress();
  error InvalidArchiveAddress();
  error ArchiveBindingMismatch();
  error InvalidPersonHash();
  error InvalidVersionIndex();
  error RecordIndexOutOfRange();
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
  uint256 public constant MAX_STORY_PAGE_SIZE = 100;
  IDeepFamilyArchive public immutable ARCHIVE;

  constructor(address deepFamily) {
    if (deepFamily == address(0) || deepFamily.code.length == 0) {
      revert InvalidDeepFamilyAddress();
    }

    DeepFamily boundDeepFamily = DeepFamily(payable(deepFamily));
    address archive;
    try boundDeepFamily.archive() returns (address configuredArchive) {
      archive = configuredArchive;
    } catch {
      revert InvalidDeepFamilyAddress();
    }
    if (
      archive == address(0) ||
      archive.code.length == 0 ||
      !ERC165Checker.supportsInterface(archive, type(IDeepFamilyArchive).interfaceId)
    ) {
      revert InvalidArchiveAddress();
    }
    IDeepFamilyArchive boundArchive = IDeepFamilyArchive(archive);
    try boundArchive.DEEP_FAMILY() returns (address bound) {
      if (bound != deepFamily) revert ArchiveBindingMismatch();
    } catch {
      revert InvalidArchiveAddress();
    }
    try boundArchive.archiveKind() returns (bytes32 kind) {
      if (kind != keccak256("deepfamily.archive.v1")) revert InvalidArchiveAddress();
    } catch {
      revert InvalidArchiveAddress();
    }
    try boundArchive.apiVersion() returns (uint256 version) {
      if (version != 1) revert InvalidArchiveAddress();
    } catch {
      revert InvalidArchiveAddress();
    }
    DEEP_FAMILY = boundDeepFamily;
    ARCHIVE = boundArchive;
  }

  function getVersionDetails(
    bytes32 personHash,
    uint256 versionIndex
  )
    external
    view
    returns (
      DeepFamily.PersonVersion memory version,
      IDeepFamilyArchive.BlobRef memory metadata,
      uint256 endorsementCount,
      uint256 tokenId
    )
  {
    _validateVersion(personHash, versionIndex);
    uint256 arrayIndex = versionIndex - 1;
    version = _readPersonVersion(personHash, arrayIndex);
    metadata = _readMetadataRef(personHash, versionIndex);
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
      IDeepFamilyArchive.BlobRef memory metadata,
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
    metadata = _readMetadataRef(personHash, versionIndex);
    coreInfo = _readCoreInfo(tokenId);
    endorsementCount = DEEP_FAMILY.versionEndorsementCount(personHash, arrayIndex);
    nftTokenURI = DEEP_FAMILY.tokenURI(tokenId);
  }

  function getVersionMetadataRef(
    bytes32 personHash,
    uint256 versionIndex
  ) external view returns (IDeepFamilyArchive.BlobRef memory metadata) {
    _validateVersion(personHash, versionIndex);
    return _readMetadataRef(personHash, versionIndex);
  }

  function getStoryState(
    uint256 tokenId
  ) external view returns (IDeepFamilyArchive.StoryState memory state) {
    _requireOwned(tokenId);
    return ARCHIVE.storyState(tokenId);
  }

  function getStoryRecordRef(
    uint256 tokenId,
    uint64 index
  ) external view returns (IDeepFamilyArchive.StoryRecordRef memory record) {
    _requireOwned(tokenId);
    if (index >= ARCHIVE.storyState(tokenId).totalRecords) revert RecordIndexOutOfRange();
    return ARCHIVE.storyRecordRef(tokenId, index);
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

  function listStoryRecords(
    uint256 tokenId,
    uint256 offset,
    uint256 limit
  )
    external
    view
    returns (
      IDeepFamilyArchive.StoryRecordRef[] memory records,
      uint256 totalRecords,
      bool hasMore,
      uint256 nextOffset
    )
  {
    _requireOwned(tokenId);
    if (limit > MAX_STORY_PAGE_SIZE) revert PageSizeExceedsLimit();
    totalRecords = ARCHIVE.storyState(tokenId).totalRecords;
    PaginationResult memory page = _getPaginationParams(totalRecords, offset, limit);
    records = new IDeepFamilyArchive.StoryRecordRef[](page.resultLength);
    for (uint256 i; i < page.resultLength; i++) {
      records[i] = ARCHIVE.storyRecordRef(tokenId, uint64(page.startIndex + i));
    }
    return (records, totalRecords, page.hasMore, page.nextOffset);
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

  function _readMetadataRef(
    bytes32 personHash,
    uint256 versionIndex
  ) internal view returns (IDeepFamilyArchive.BlobRef memory metadata) {
    return ARCHIVE.metadataRef(personHash, versionIndex);
  }

  function _readCoreInfo(
    uint256 tokenId
  ) internal view returns (DeepFamily.PersonCoreInfo memory coreInfo) {
    (coreInfo.basicInfo, coreInfo.supplementInfo) = DEEP_FAMILY.nftCoreInfo(tokenId);
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

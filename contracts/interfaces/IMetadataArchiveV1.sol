// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IMetadataArchiveV1
 * @notice Format-agnostic, immutable metadata blob archive used by DeepFamily.
 */
interface IMetadataArchiveV1 {
  struct MetadataRef {
    address pointer;
    bytes32 payloadHash;
    uint32 payloadLength;
  }

  function DEEP_FAMILY() external view returns (address);

  function store(
    bytes32 personHash,
    uint256 versionIndex,
    bytes calldata envelope
  ) external returns (MetadataRef memory metadata);

  function metadataRef(
    bytes32 personHash,
    uint256 versionIndex
  ) external view returns (MetadataRef memory metadata);
}

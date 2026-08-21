// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMetadataArchiveV1} from "../interfaces/IMetadataArchiveV1.sol";

contract StubMetadataArchive is IMetadataArchiveV1 {
  error StoreFailed();

  address public immutable override DEEP_FAMILY;
  bool public immutable shouldRevert;

  constructor(address deepFamily, bool _shouldRevert) {
    DEEP_FAMILY = deepFamily;
    shouldRevert = _shouldRevert;
  }

  function store(
    bytes32,
    uint256,
    bytes calldata
  ) external view override returns (MetadataRef memory metadata) {
    if (shouldRevert) revert StoreFailed();
    return metadata;
  }

  function metadataRef(
    bytes32,
    uint256
  ) external pure override returns (MetadataRef memory metadata) {
    return metadata;
  }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMetadataArchiveV1} from "../interfaces/IMetadataArchiveV1.sol";

contract MetadataArchiveCallerHarness {
  function store(
    address archive,
    bytes32 personHash,
    uint256 versionIndex,
    bytes calldata envelope
  ) external returns (IMetadataArchiveV1.MetadataRef memory metadata) {
    return IMetadataArchiveV1(archive).store(personHash, versionIndex, envelope);
  }
}

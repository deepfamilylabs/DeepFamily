// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IDeepFamilyArchiveV1} from "../interfaces/IDeepFamilyArchiveV1.sol";

contract ArchiveCallerHarness {
  address public archive;

  function setArchive(address candidate) external {
    archive = candidate;
  }

  function store(
    address target,
    bytes32 personHash,
    uint256 versionIndex,
    bytes calldata envelope
  ) external returns (IDeepFamilyArchiveV1.BlobRef memory blob) {
    return IDeepFamilyArchiveV1(target).storeMetadata(personHash, versionIndex, envelope);
  }
}

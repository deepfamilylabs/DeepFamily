// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IDeepFamilyArchive} from "../interfaces/IDeepFamilyArchive.sol";

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
  ) external returns (IDeepFamilyArchive.BlobRef memory blob) {
    return IDeepFamilyArchive(target).storeMetadata(personHash, versionIndex, envelope);
  }
}

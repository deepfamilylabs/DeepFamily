// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DeepFamilyArchiveV1} from "../DeepFamilyArchiveV1.sol";

contract ArchiveManifestHarness is DeepFamilyArchiveV1 {
  error DeploymentFailed();
  uint256 public deploymentCount;
  uint256 public failOnDeployment;
  address public manifest;

  constructor(address deepFamily) DeepFamilyArchiveV1(deepFamily) {}

  function setFailOnDeployment(uint256 count) external {
    failOnDeployment = count;
  }

  function storeManifest(
    address[] memory segments,
    bytes32 payloadHash,
    uint64 payloadLength
  ) external returns (address) {
    BlobRef memory blob = BlobRef(payloadHash, address(0), payloadLength, uint32(segments.length));
    manifest = _storeManifest(segments, blob);
    return manifest;
  }

  function recordHash(
    uint256 chainId,
    address archiveAddress,
    uint256 tokenId,
    uint64 index,
    StoryRecordRef memory record
  ) external pure returns (bytes32) {
    return _recordHash(chainId, archiveAddress, tokenId, index, record);
  }

  function nextHead(bytes32 previousHead, bytes32 hash) external pure returns (bytes32) {
    return _nextHead(previousHead, hash);
  }

  function _deployData(bytes memory data) internal override returns (address) {
    deploymentCount += 1;
    if (deploymentCount == failOnDeployment) revert DeploymentFailed();
    return super._deployData(data);
  }
}

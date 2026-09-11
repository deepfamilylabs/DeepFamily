// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IDeepFamilyArchive} from "../interfaces/IDeepFamilyArchive.sol";

contract StoryNFTOwnerMock {
  address public archive;

  function setArchive(address candidate) external {
    archive = candidate;
  }

  function initializeStory(
    uint256 tokenId,
    address author,
    bytes calldata payload,
    bytes32 expectedPayloadHash
  ) external {
    IDeepFamilyArchive(archive).initializeStory(tokenId, author, payload, expectedPayloadHash);
  }

  mapping(uint256 tokenId => address owner) private _owners;

  function setOwner(uint256 tokenId, address owner) external {
    _owners[tokenId] = owner;
  }

  function ownerOf(uint256 tokenId) external view returns (address owner) {
    owner = _owners[tokenId];
    require(owner != address(0), "nonexistent token");
  }
}

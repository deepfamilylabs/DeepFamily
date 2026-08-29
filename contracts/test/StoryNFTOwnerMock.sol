// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract StoryNFTOwnerMock {
  mapping(uint256 tokenId => address owner) private _owners;

  function setOwner(uint256 tokenId, address owner) external {
    _owners[tokenId] = owner;
  }

  function ownerOf(uint256 tokenId) external view returns (address owner) {
    owner = _owners[tokenId];
    require(owner != address(0), "nonexistent token");
  }
}

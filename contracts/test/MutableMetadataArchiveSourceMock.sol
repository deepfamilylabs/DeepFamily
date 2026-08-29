// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @dev Minimal mutable stand-in for the DeepFamily proxy used to prove that
 *      DeepFamilyReader snapshots both archive addresses at construction time.
 */
contract MutableMetadataArchiveSourceMock {
  address public metadataArchive;
  address public storyArchive;

  function setMetadataArchive(address archive) external {
    metadataArchive = archive;
  }

  function setStoryArchive(address archive) external {
    storyArchive = archive;
  }
}

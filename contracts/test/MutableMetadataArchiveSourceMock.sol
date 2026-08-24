// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @dev Minimal mutable stand-in for the DeepFamily proxy used to prove that
 *      DeepFamilyReader snapshots its archive address at construction time.
 */
contract MutableMetadataArchiveSourceMock {
  address public metadataArchive;

  function setMetadataArchive(address archive) external {
    metadataArchive = archive;
  }
}

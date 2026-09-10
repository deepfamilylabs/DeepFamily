// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/** @dev Proves that Reader snapshots the bound archive at construction. */
contract MutableArchiveSourceMock {
  address public archive;
  function setArchive(address candidate) external {
    archive = candidate;
  }
}

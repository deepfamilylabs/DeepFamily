// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICanonicalLetterPoolFactory {
  function AUTHORIZATION_STATE() external view returns (address);
  function poolFor(address asset) external view returns (address);
}

interface ICanonicalLetterPool {
  function AUTHORIZATION_STATE() external view returns (address);
  function isKnownNoteRoot(uint256 shardId, uint256 root) external view returns (bool);
}

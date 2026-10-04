// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/** @notice Immutable pool configuration used when registering and discovering assets. */
interface IShieldedPoolConfiguration {
  function assetKind() external pure returns (uint8);

  function protocolVersion() external pure returns (uint256);

  function creationBlock() external view returns (uint256);

  function LINEAGE_INDEX() external view returns (address);

  function VERIFIER() external view returns (address);
}

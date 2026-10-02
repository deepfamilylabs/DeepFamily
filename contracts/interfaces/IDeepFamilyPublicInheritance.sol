// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/** @dev Public family facts used by public-budget funding and claiming. */
interface IDeepFamilyPublicInheritance {
  struct PersonVersion {
    bytes32 personHash;
    bytes32 fatherHash;
    bytes32 motherHash;
    uint256 versionIndex;
    uint256 fatherVersionIndex;
    uint256 motherVersionIndex;
    uint256 versionCommitment;
    address addedBy;
    uint96 timestamp;
  }

  function personVersionsCount(bytes32 personHash) external view returns (uint256);
  function personVersionAt(
    bytes32 personHash,
    uint256 arrayIndex
  ) external view returns (PersonVersion memory);
  function endorsedVersionIndex(
    bytes32 personHash,
    address endorser
  ) external view returns (uint256);
  function trustedEndorserOf(
    bytes32 personHash,
    uint256 versionIndex,
    address endorser
  ) external view returns (bool);
}

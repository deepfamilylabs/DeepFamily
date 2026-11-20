// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/** @dev The v1 interface ID, write selector and event are frozen independently of the v2 ABI. */
contract LegacyLineageIndexMock {
  error UnauthorizedCaller();

  address public immutable DEEP_FAMILY;

  event VersionIndexed(
    bytes32 indexed personHash,
    uint256 indexed versionIndex,
    uint256 identityCommitment,
    uint256 fatherIdentityCommitment,
    uint256 motherIdentityCommitment
  );

  constructor(address family) {
    DEEP_FAMILY = family;
  }

  function indexKind() external pure returns (bytes32) {
    return keccak256("deepfamily.lineage-index.v1");
  }

  function apiVersion() external pure returns (uint256) {
    return 1;
  }

  function supportsInterface(bytes4 id) external pure returns (bool) {
    return id == 0x01ffc9a7 || id == 0x3f36c37f;
  }

  function onVersionAdded(
    bytes32 person,
    uint256 version,
    uint256 identity,
    uint256 father,
    uint256 mother
  ) external {
    if (msg.sender != DEEP_FAMILY) revert UnauthorizedCaller();
    emit VersionIndexed(person, version, identity, father, mother);
  }

  function onTrustedEndorserSet(bytes32, uint256, address, bool) external view {
    if (msg.sender != DEEP_FAMILY) revert UnauthorizedCaller();
  }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IDeepFamilyArchive} from "../interfaces/IDeepFamilyArchive.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/** @dev Independently malformed capability claims for one-time binding tests. */
contract ArchiveBindingMock {
  address public immutable DEEP_FAMILY;
  bytes32 public immutable archiveKind;
  uint256 public immutable apiVersion;
  uint8 public immutable capability;

  constructor(address bound, bytes32 kind, uint256 version, uint8 interfaces) {
    DEEP_FAMILY = bound;
    archiveKind = kind;
    apiVersion = version;
    capability = interfaces;
  }

  function supportsInterface(bytes4 id) external view returns (bool) {
    if (capability == 2) return true;
    return
      capability == 1 &&
      (id == type(IERC165).interfaceId || id == type(IDeepFamilyArchive).interfaceId);
  }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DeepFamilyArchive} from "../DeepFamilyArchive.sol";

contract StubArchive is DeepFamilyArchive {
  error StoreFailed();
  bool public immutable shouldRevert;

  constructor(address deepFamily, bool fail) DeepFamilyArchive(deepFamily) {
    shouldRevert = fail;
  }

  function _deployData(bytes memory data) internal override returns (address) {
    if (shouldRevert) revert StoreFailed();
    return super._deployData(data);
  }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DeepFamilyArchiveV1} from "../DeepFamilyArchiveV1.sol";

contract StubArchive is DeepFamilyArchiveV1 {
  error StoreFailed();
  bool public immutable shouldRevert;

  constructor(address deepFamily, bool fail) DeepFamilyArchiveV1(deepFamily) {
    shouldRevert = fail;
  }

  function _deployData(bytes memory data) internal override returns (address) {
    if (shouldRevert) revert StoreFailed();
    return super._deployData(data);
  }
}

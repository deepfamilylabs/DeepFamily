// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract StubNameDisclosureVerifierV2 {
  bool private immutable shouldVerify;

  constructor(bool _shouldVerify) {
    shouldVerify = _shouldVerify;
  }

  function verifyProof(
    uint256[2] calldata,
    uint256[2][2] calldata,
    uint256[2] calldata,
    uint256[6] calldata
  ) external view returns (bool) {
    return shouldVerify;
  }
}

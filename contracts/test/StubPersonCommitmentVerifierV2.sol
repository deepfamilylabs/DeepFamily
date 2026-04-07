// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract StubPersonCommitmentVerifierV2 {
  bool private immutable shouldVerify;

  constructor(bool _shouldVerify) {
    shouldVerify = _shouldVerify;
  }

  function verifyProof(
    uint256[2] calldata,
    uint256[2][2] calldata,
    uint256[2] calldata,
    uint256[7] calldata
  ) external view returns (bool) {
    return shouldVerify;
  }
}

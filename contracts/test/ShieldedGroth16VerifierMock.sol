// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ShieldedGroth16VerifierMock {
  bool public accept = true;
  uint256 public expectedAmount;

  function configure(bool shouldAccept, uint256 amount) external {
    accept = shouldAccept;
    expectedAmount = amount;
  }

  function verifyProof(
    uint256[2] calldata,
    uint256[2][2] calldata,
    uint256[2] calldata,
    uint256[32] calldata publicSignals
  ) external view returns (bool) {
    return accept && publicSignals[25] == expectedAmount;
  }
}

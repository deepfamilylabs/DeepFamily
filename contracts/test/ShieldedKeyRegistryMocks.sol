// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ShieldedKeyRegistryLineageMock {
  mapping(bytes32 => uint256) public identityCommitmentOf;

  function setIdentity(bytes32 personHash, uint256 commitment) external {
    identityCommitmentOf[personHash] = commitment;
  }
}

contract ShieldedKeyRegistryVerifierMock {
  uint256[7] private _expected;
  bool public accept;

  function configure(uint256[7] calldata expected, bool shouldAccept) external {
    _expected = expected;
    accept = shouldAccept;
  }

  function verifyProof(
    uint256[2] calldata,
    uint256[2][2] calldata,
    uint256[2] calldata,
    uint256[7] calldata signals
  ) external view returns (bool) {
    if (!accept) return false;
    for (uint256 i = 0; i < signals.length; ++i) {
      if (signals[i] != _expected[i]) return false;
    }
    return true;
  }
}

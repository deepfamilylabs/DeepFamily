// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @dev Test only. Implements the generated verifier ABI for every pool action size and accepts
 *      only a configured final public signal, so a proof forwarded to another route fails.
 */
contract ShieldedGroth16VerifierMock {
  bool public accept = true;
  uint256 public expectedLastSignal;

  function configure(bool shouldAccept, uint256 lastSignal) external {
    accept = shouldAccept;
    expectedLastSignal = lastSignal;
  }

  function verifyProof(
    uint256[2] calldata,
    uint256[2][2] calldata,
    uint256[2] calldata,
    uint256[7] calldata publicSignals
  ) external view returns (bool) {
    return _check(publicSignals[6]);
  }

  function verifyProof(
    uint256[2] calldata,
    uint256[2][2] calldata,
    uint256[2] calldata,
    uint256[14] calldata publicSignals
  ) external view returns (bool) {
    return _check(publicSignals[13]);
  }

  function verifyProof(
    uint256[2] calldata,
    uint256[2][2] calldata,
    uint256[2] calldata,
    uint256[10] calldata publicSignals
  ) external view returns (bool) {
    return _check(publicSignals[9]);
  }

  function _check(uint256 lastSignal) private view returns (bool) {
    return accept && lastSignal == expectedLastSignal;
  }

  function verifyProof(
    uint256[2] calldata,
    uint256[2][2] calldata,
    uint256[2] calldata,
    uint256[27] calldata publicSignals
  ) external view returns (bool) {
    return _check(publicSignals[26]);
  }

  function verifyProof(
    uint256[2] calldata,
    uint256[2][2] calldata,
    uint256[2] calldata,
    uint256[16] calldata publicSignals
  ) external view returns (bool) {
    return _check(publicSignals[15]);
  }
}

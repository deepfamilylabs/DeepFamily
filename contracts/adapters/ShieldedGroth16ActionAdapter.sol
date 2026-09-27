// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/** @dev Interface implemented by a generated Groth16 verifier with exactly 32 public signals. */
interface IShieldedGroth16Verifier {
  function verifyProof(
    uint256[2] calldata a,
    uint256[2][2] calldata b,
    uint256[2] calldata c,
    uint256[32] calldata publicSignals
  ) external view returns (bool);
}

/**
 * @notice Pins one action-specific verifier and decodes the same ABC proof envelope used by
 *         the rest of the project. Each deployed pool action must have its own sound circuit.
 */
contract ShieldedGroth16ActionAdapter {
  error InvalidVerifier();
  error InvalidAction();
  error WrongAction();
  error MalformedProof();

  IShieldedGroth16Verifier public immutable VERIFIER;
  uint8 public immutable ACTION;

  constructor(address verifier, uint8 action) {
    if (verifier.code.length == 0) revert InvalidVerifier();
    if (action > 7) revert InvalidAction();
    VERIFIER = IShieldedGroth16Verifier(verifier);
    ACTION = action;
  }

  function verifyProof(
    bytes calldata proof,
    uint256[32] calldata publicSignals
  ) external view returns (bool) {
    if (publicSignals[0] != ACTION) revert WrongAction();
    if (proof.length != 256) revert MalformedProof();
    (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = abi.decode(
      proof,
      (uint256[2], uint256[2][2], uint256[2])
    );
    return VERIFIER.verifyProof(a, b, c, publicSignals);
  }
}

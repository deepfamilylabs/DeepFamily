// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IReceivePresentationVerifier} from "../interfaces/IReceivePresentationVerifier.sol";

/** @notice Fixed statement routing for the two shielded money receive purposes. */
contract ReceivePresentationVerifierRouter is IReceivePresentationVerifier {
  error InvalidVerifier();
  error InvalidReceiveAction();

  IReceivePresentationVerifier public immutable RECEIVE_VERIFIER;
  IReceivePresentationVerifier public immutable FUND_VERIFIER;

  constructor(address receiveVerifier, address fundVerifier) {
    if (receiveVerifier.code.length == 0 || fundVerifier.code.length == 0) {
      revert InvalidVerifier();
    }
    RECEIVE_VERIFIER = IReceivePresentationVerifier(receiveVerifier);
    FUND_VERIFIER = IReceivePresentationVerifier(fundVerifier);
  }

  function verifyProof(bytes calldata proof, uint256[11] calldata inputs) external view {
    if (inputs[2] == 3) {
      FUND_VERIFIER.verifyProof(proof, inputs);
    } else if (inputs[2] == 4) {
      RECEIVE_VERIFIER.verifyProof(proof, inputs);
    } else {
      revert InvalidReceiveAction();
    }
  }
}

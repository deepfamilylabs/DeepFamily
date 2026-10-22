// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPrivateLetterVerifier} from "./interfaces/IPrivateLetterVerifiers.sol";

/** @notice Fixed statement routing for the two shielded money receive disclosures. */
contract ReceivePresentationVerifierRouter is IPrivateLetterVerifier {
  error InvalidVerifier();
  error InvalidReceiveAction();

  IPrivateLetterVerifier public immutable ANONYMOUS_VERIFIER;
  IPrivateLetterVerifier public immutable FUND_VERIFIER;

  constructor(address anonymousVerifier, address fundVerifier) {
    if (anonymousVerifier.code.length == 0 || fundVerifier.code.length == 0) {
      revert InvalidVerifier();
    }
    ANONYMOUS_VERIFIER = IPrivateLetterVerifier(anonymousVerifier);
    FUND_VERIFIER = IPrivateLetterVerifier(fundVerifier);
  }

  function verifyProof(bytes calldata proof, uint256[11] calldata inputs) external view {
    if (inputs[2] == 3) {
      FUND_VERIFIER.verifyProof(proof, inputs);
    } else if (inputs[2] == 4) {
      ANONYMOUS_VERIFIER.verifyProof(proof, inputs);
    } else {
      revert InvalidReceiveAction();
    }
  }
}

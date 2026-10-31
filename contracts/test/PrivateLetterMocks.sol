// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIdentityCounterUpdateVerifier} from "../interfaces/IIdentityAuthorizationState.sol";
import {IPrivateLetterVerifier} from "../interfaces/IPrivateLetterVerifiers.sol";

/** @dev TEST ONLY. Exact-public-input transport checks; no cryptographic authentication. */
contract IdentityCounterVerifierMock is IIdentityCounterUpdateVerifier {
  function verifyProof(
    bytes calldata proof,
    uint256[6] calldata inputs
  ) external pure returns (bool) {
    return keccak256(proof) == keccak256(abi.encode(inputs));
  }
}

/** @dev TEST ONLY. A fabricated proof cannot authenticate any receipt. */
contract PrivateLetterVerifierMock is IPrivateLetterVerifier {
  error InvalidZKProof();

  function verifyProof(bytes calldata proof, uint256[11] calldata inputs) external pure {
    if (keccak256(proof) != keccak256(abi.encode(inputs))) revert InvalidZKProof();
  }
}

/** @dev TEST ONLY. Production uses the immutable canonical ShieldedPoolFactory. */
contract PrivateLetterPoolFactoryMock {
  address public immutable AUTHORIZATION_STATE;

  constructor(address state) {
    AUTHORIZATION_STATE = state;
  }
}

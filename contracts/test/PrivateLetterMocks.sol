// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIdentityCounterUpdateVerifier} from "../interfaces/IIdentityAuthorizationState.sol";
import {IPrivateLetterVerifier, IPrivateAttachedLetterVerifier} from "../interfaces/IPrivateLetterVerifiers.sol";

/** @dev TEST ONLY. Exact-public-input transport checks; no cryptographic authentication. */
contract IdentityCounterVerifierMock is IIdentityCounterUpdateVerifier {
  function verifyProof(
    bytes calldata proof,
    uint256[8] calldata inputs
  ) external pure returns (bool) {
    return keccak256(proof) == keccak256(abi.encode(inputs));
  }
}

/** @dev TEST ONLY. A fabricated proof cannot authenticate any receipt or budget. */
contract PrivateLetterVerifierMock is IPrivateLetterVerifier, IPrivateAttachedLetterVerifier {
  error InvalidZKProof();

  function verifyProof(bytes calldata proof, uint256[11] calldata inputs) external pure {
    if (keccak256(proof) != keccak256(abi.encode(inputs))) revert InvalidZKProof();
  }

  function verifyProof(bytes calldata proof, uint256[14] calldata inputs) external pure {
    if (keccak256(proof) != keccak256(abi.encode(inputs))) revert InvalidZKProof();
  }
}

/** @dev TEST ONLY. Arbitrary roots isolate canonical source checks from actual Fund validity. */
contract PrivateLetterPoolMock {
  address public immutable AUTHORIZATION_STATE;
  mapping(uint256 shardId => mapping(uint256 root => bool known)) private _roots;

  constructor(address state) {
    AUTHORIZATION_STATE = state;
  }

  function setKnownNoteRoot(uint256 shardId, uint256 root) external {
    _roots[shardId][root] = true;
  }

  function isKnownNoteRoot(uint256 shardId, uint256 root) external view returns (bool) {
    return _roots[shardId][root];
  }
}

/** @dev TEST ONLY. Production uses the immutable canonical ShieldedPoolFactory. */
contract PrivateLetterPoolFactoryMock {
  address public immutable AUTHORIZATION_STATE;
  mapping(address asset => address pool) public poolFor;

  constructor(address state) {
    AUTHORIZATION_STATE = state;
  }

  function registerPool(address asset, address pool) external {
    poolFor[asset] = pool;
  }
}

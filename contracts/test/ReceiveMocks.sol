// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoseidonT4} from "poseidon-solidity/PoseidonT4.sol";
import {IFixedProofVerifier} from "../interfaces/IFixedProofVerifier.sol";
import {IEligibilitySource} from "../interfaces/IEligibilitySource.sol";

/// @dev TEST ONLY: exact public-input binding, not a cryptographic proof verifier.
contract FixedProofVerifierMock is IFixedProofVerifier {
  function verifyProof(bytes calldata proof, uint256[] calldata signals) external pure returns (bool) {
    return keccak256(proof) == keccak256(abi.encode(signals));
  }
}

/// @dev TEST ONLY: deliberately unauthenticated source roots and revocations.
contract EligibilitySourceMock is IEligibilitySource {
  uint256 public sourceRoot = 101;
  uint256 public trustedRoot = 102;
  uint256[3][] private _revocations;

  function setRoots(uint256 facts, uint256 trusted) external {
    sourceRoot = facts;
    trustedRoot = trusted;
  }

  function revokeRole(uint8 role, uint256 secret) external {
    require(role < 3);
    uint256[3] memory item;
    item[role] = secret;
    _revocations.push(item);
  }

  function isRoleRevoked(uint8 role, uint256 nonce, uint256 tag) external view returns (bool) {
    require(role < 3);
    for (uint256 index; index < _revocations.length; ++index) {
      uint256 secret = _revocations[index][role];
      if (secret != 0 && PoseidonT4.hash([uint256(73301) + role, secret, nonce]) == tag) return true;
    }
    return false;
  }

  function revokeRoles(address, uint8[] calldata roles, uint256[] calldata secrets) external {
    require(roles.length == secrets.length);
    for (uint256 index; index < roles.length; ++index) {
      require(roles[index] < 3);
      uint256[3] memory item;
      item[roles[index]] = secrets[index];
      _revocations.push(item);
    }
  }

  function beforeEndorsementChange(uint256, address) external pure {}
  function beforeTrustedChange(uint256, uint256, address) external pure {}
}

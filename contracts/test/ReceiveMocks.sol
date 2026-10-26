// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
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
  mapping(uint8 role => mapping(uint256 roleIndex => bool revoked)) private _revoked;

  function setRoots(uint256 facts, uint256 trusted) external {
    sourceRoot = facts;
    trustedRoot = trusted;
  }

  function revokeRole(uint8 role, uint256 secret) external {
    require(role < 3);
    _revoked[role][PoseidonT3.hash([uint256(74321) + role, secret])] = true;
  }

  function isRoleRevoked(uint8 role, uint256 roleIndex) external view returns (bool) {
    require(role < 3);
    return _revoked[role][roleIndex];
  }

  function revokeRoles(address, uint8[] calldata roles, uint256[] calldata secrets) external {
    require(roles.length == secrets.length);
    for (uint256 index; index < roles.length; ++index) {
      require(roles[index] < 3);
      _revoked[roles[index]][PoseidonT3.hash([uint256(74321) + roles[index], secrets[index]])] = true;
    }
  }

  function beforeEndorsementChange(uint256, address) external pure {}
  function beforeTrustedChange(uint256, uint256, address) external pure {}
}

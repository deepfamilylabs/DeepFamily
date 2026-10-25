// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IProofVerifierAdapter} from "../interfaces/IProofVerifierAdapter.sol";
import {IFixedProofVerifier} from "../interfaces/IFixedProofVerifier.sol";
import {IReceiveRegistry} from "../interfaces/IReceiveRegistry.sol";

/// @dev State/input wiring tests only. These echo verifiers must never secure real funds.
contract PoolProofVerifierMock is IFixedProofVerifier {
  function verifyProof(bytes calldata proof, uint256[] calldata signals) external pure returns (bool) {
    return keccak256(proof) == keccak256(abi.encode(signals));
  }
}

contract PoolBoundaryVerifierMock is IProofVerifierAdapter {
  function verifyProof(uint8 purpose, uint8 encoding, bytes calldata proof,
    uint256[] calldata signals) external pure returns (bool) {
    return encoding == 1 && ((purpose == 2 && signals.length == 7) ||
      (purpose == 6 && (signals.length == 11 || signals.length == 20))) &&
      keccak256(proof) == keccak256(abi.encode(purpose, signals));
  }
}

contract PoolReceiveRegistryMock is IReceiveRegistry {
  bool public receiving = true;
  bool public qualified = true;
  function setStatus(bool receiveStatus, bool qualificationStatus) external {
    receiving = receiveStatus;
    qualified = qualificationStatus;
  }
  function verifyReceive(Code calldata, bytes calldata) external view returns (bool) { return receiving; }
  function verifyBudgetCapability(Code calldata, Capability calldata, bytes calldata, bytes calldata)
    external view returns (bool) { return receiving && qualified; }
  function validateBudgetRoleStatus(uint256 root, uint256, uint256, uint256, uint256)
    external view returns (bool) { return qualified && root != 0; }
  function isKnownIssuanceRoot(uint256 root) external pure returns (bool) { return root != 0; }
  function isCodeRevoked(uint256) external view returns (bool) { return !receiving; }
}

contract PoolTokenMock is ERC20 {
  bool public chargeFee;
  constructor() ERC20("Canonical ledger test token", "CLT") {}
  function mint(address recipient, uint256 amount) external { _mint(recipient, amount); }
  function setChargeFee(bool enabled) external { chargeFee = enabled; }
  function _update(address from, address to, uint256 amount) internal override {
    if (chargeFee && from != address(0) && to != address(0) && amount > 0) {
      super._update(from, address(0), 1);
      super._update(from, to, amount - 1);
    } else {
      super._update(from, to, amount);
    }
  }
}

/// @dev Typed generated-verifier stubs let adapter tests distinguish every fixed route/arity.
contract BoundaryGeneratedVerifierMock {
  uint256 public immutable MARKER;
  uint256 public immutable WIDTH;
  constructor(uint256 marker, uint256 width) { MARKER = marker; WIDTH = width; }
  function verifyProof(uint256[2] calldata a, uint256[2][2] calldata,
    uint256[2] calldata, uint256[7] calldata signals) external view returns (bool) {
    return WIDTH == 7 && a[0] == MARKER && a[1] == 7 && signals[0] == MARKER;
  }
  function verifyProof(uint256[2] calldata a, uint256[2][2] calldata,
    uint256[2] calldata, uint256[11] calldata signals) external view returns (bool) {
    return WIDTH == 11 && a[0] == MARKER && a[1] == 11 && signals[0] == MARKER;
  }
  function verifyProof(uint256[2] calldata a, uint256[2][2] calldata,
    uint256[2] calldata, uint256[20] calldata signals) external view returns (bool) {
    return WIDTH == 20 && a[0] == MARKER && a[1] == 20 && signals[0] == MARKER;
  }
}

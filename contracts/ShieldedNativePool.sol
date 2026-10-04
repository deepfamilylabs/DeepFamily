// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ShieldedPoolCore} from "./ShieldedPoolCore.sol";

/** @notice Direct native-asset deposits and withdrawals using the common shielded protocol. */
contract ShieldedNativePool is ShieldedPoolCore {
  error UnexpectedNativeValue();
  error NativeTransferFailed();

  constructor(address lineageIndex, address verifier) ShieldedPoolCore(lineageIndex, verifier) {}

  function assetKind() external pure override returns (uint8) {
    return 1;
  }

  function shield(
    uint256 amount,
    ActionData calldata data,
    bytes calldata proof
  ) external payable nonReentrant {
    _validateAmount(amount);
    if (msg.value != amount) revert UnexpectedNativeValue();
    _execute(Action.Shield, data, proof, amount, address(0));
    totalShielded += amount;
    _assertCollateral();
    _appendOutputs(Action.Shield, data);
  }

  function _assetBalance() internal view override returns (uint256) {
    return address(this).balance;
  }

  function _pay(address recipient, uint256 amount) internal override {
    (bool success, ) = recipient.call{value: amount}("");
    if (!success) revert NativeTransferFailed();
  }
}

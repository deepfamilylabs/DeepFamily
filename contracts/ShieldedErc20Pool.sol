// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ShieldedPoolCore} from "./ShieldedPoolCore.sol";

/** @notice An immutable pool for one ERC-20, with exact transfers at both asset boundaries. */
contract ShieldedErc20Pool is ShieldedPoolCore {
  using SafeERC20 for IERC20;

  IERC20 public immutable TOKEN;

  constructor(
    address token,
    address lineageIndex,
    address verifier
  ) ShieldedPoolCore(lineageIndex, verifier) {
    if (token.code.length == 0) revert InvalidConstructorAddress();
    TOKEN = IERC20(token);
  }

  function assetKind() external pure override returns (uint8) {
    return 0;
  }

  function shield(
    uint256 amount,
    ActionData calldata data,
    bytes calldata proof
  ) external nonReentrant {
    _validateAmount(amount);
    _execute(Action.Shield, data, proof, amount, address(0));
    uint256 senderBefore = TOKEN.balanceOf(msg.sender);
    uint256 poolBefore = TOKEN.balanceOf(address(this));
    TOKEN.safeTransferFrom(msg.sender, address(this), amount);
    uint256 senderAfter = TOKEN.balanceOf(msg.sender);
    uint256 poolAfter = TOKEN.balanceOf(address(this));
    if (
      senderAfter > senderBefore ||
      poolAfter < poolBefore ||
      senderBefore - senderAfter != amount ||
      poolAfter - poolBefore != amount
    ) revert UnexpectedTokenTransfer();
    totalShielded += amount;
    _assertCollateral();
    _appendOutputs(Action.Shield, data);
  }

  function _assetBalance() internal view override returns (uint256) {
    return TOKEN.balanceOf(address(this));
  }

  function _pay(address recipient, uint256 amount) internal override {
    uint256 poolBefore = TOKEN.balanceOf(address(this));
    uint256 recipientBefore = TOKEN.balanceOf(recipient);
    TOKEN.safeTransfer(recipient, amount);
    uint256 poolAfter = TOKEN.balanceOf(address(this));
    uint256 recipientAfter = TOKEN.balanceOf(recipient);
    if (
      poolAfter > poolBefore ||
      recipientAfter < recipientBefore ||
      poolBefore - poolAfter != amount ||
      recipientAfter - recipientBefore != amount
    ) revert UnexpectedTokenTransfer();
  }
}

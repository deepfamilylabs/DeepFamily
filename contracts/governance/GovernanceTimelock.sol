// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/TimelockController.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/access/IAccessControl.sol";
import "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Production governance owner and DEEP protocol treasury for DeepFamily deployments.
/// @dev Assign PROPOSER/CANCELLER and EXECUTOR roles to a multisig so every privileged action
///      requires both the multisig threshold and the configured on-chain delay.
contract GovernanceTimelock is TimelockController, AccessControlEnumerable {
  using SafeERC20 for IERC20;

  error InvalidGovernanceDelay();
  error InvalidGovernanceMultisig();
  error InvalidTreasuryToken();
  error InvalidTreasuryRecipient();

  event ERC20Swept(address indexed token, address indexed recipient, uint256 amount);

  constructor(
    uint256 minDelay,
    address multisig
  ) TimelockController(minDelay, _singleton(multisig), _singleton(multisig), address(0)) {
    if (minDelay == 0) revert InvalidGovernanceDelay();
    if (multisig == address(0)) revert InvalidGovernanceMultisig();
  }

  /// @dev Role changes must be executed by the timelock itself, never by an external admin.
  function grantRole(bytes32 role, address account) public override(AccessControl, IAccessControl) {
    if (msg.sender != address(this)) revert TimelockUnauthorizedCaller(msg.sender);
    super.grantRole(role, account);
  }

  /// @dev Role changes must be executed by the timelock itself, never by an external admin.
  function revokeRole(
    bytes32 role,
    address account
  ) public override(AccessControl, IAccessControl) {
    if (msg.sender != address(this)) revert TimelockUnauthorizedCaller(msg.sender);
    super.revokeRole(role, account);
  }

  /// @dev Prevent a role holder from bypassing the delay by immediately removing itself.
  function renounceRole(
    bytes32 role,
    address callerConfirmation
  ) public override(AccessControl, IAccessControl) {
    if (msg.sender != address(this)) revert TimelockUnauthorizedCaller(msg.sender);
    super.renounceRole(role, callerConfirmation);
  }

  /// @dev Governance may adjust the delay through a delayed self-call, but never disable it.
  function updateDelay(uint256 newDelay) public override {
    if (newDelay == 0) revert InvalidGovernanceDelay();
    super.updateDelay(newDelay);
  }

  /// @notice Transfer this Timelock's complete balance of an ERC-20 token.
  /// @dev Only a delayed Timelock self-call can execute a sweep. Reading the balance during
  ///      execution, rather than when the operation is scheduled, also includes funds received
  ///      while the governance delay is running.
  function sweepERC20(address token, address recipient) external returns (uint256 amount) {
    if (msg.sender != address(this)) revert TimelockUnauthorizedCaller(msg.sender);
    if (token == address(0) || token.code.length == 0) revert InvalidTreasuryToken();
    if (recipient == address(0)) revert InvalidTreasuryRecipient();

    IERC20 tokenContract = IERC20(token);
    amount = tokenContract.balanceOf(address(this));
    tokenContract.safeTransfer(recipient, amount);
    emit ERC20Swept(token, recipient, amount);
  }

  function supportsInterface(
    bytes4 interfaceId
  ) public view override(TimelockController, AccessControlEnumerable) returns (bool) {
    return super.supportsInterface(interfaceId);
  }

  function _grantRole(
    bytes32 role,
    address account
  ) internal override(AccessControl, AccessControlEnumerable) returns (bool) {
    return super._grantRole(role, account);
  }

  function _revokeRole(
    bytes32 role,
    address account
  ) internal override(AccessControl, AccessControlEnumerable) returns (bool) {
    return super._revokeRole(role, account);
  }

  function _singleton(address account) private pure returns (address[] memory accounts) {
    accounts = new address[](1);
    accounts[0] = account;
  }
}

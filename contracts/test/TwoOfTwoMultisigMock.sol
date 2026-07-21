// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Minimal test-only 2-of-2 wallet used to exercise governance calls from a contract
/// address. It intentionally implements only the behavior needed by the integration tests.
contract TwoOfTwoMultisigMock {
  error NotOwner();
  error AlreadyApproved();
  error TransactionAlreadyExecuted();
  error TransactionFailed();

  struct Transaction {
    address target;
    uint256 value;
    bytes data;
    uint8 approvals;
    bool executed;
  }

  mapping(address => bool) public isOwner;
  mapping(uint256 => mapping(address => bool)) public approvedBy;
  address[] private owners;
  Transaction[] private transactions;

  constructor(address ownerA, address ownerB) {
    isOwner[ownerA] = true;
    isOwner[ownerB] = true;
    owners.push(ownerA);
    owners.push(ownerB);
  }

  function submit(
    address target,
    uint256 value,
    bytes calldata data
  ) external returns (uint256 id) {
    if (!isOwner[msg.sender]) revert NotOwner();
    id = transactions.length;
    transactions.push(
      Transaction({target: target, value: value, data: data, approvals: 1, executed: false})
    );
    approvedBy[id][msg.sender] = true;
  }

  function approveAndExecute(uint256 id) external {
    if (!isOwner[msg.sender]) revert NotOwner();
    Transaction storage transaction = transactions[id];
    if (transaction.executed) revert TransactionAlreadyExecuted();
    if (approvedBy[id][msg.sender]) revert AlreadyApproved();

    approvedBy[id][msg.sender] = true;
    transaction.approvals += 1;
    if (transaction.approvals < 2) return;

    transaction.executed = true;
    (bool success, ) = transaction.target.call{value: transaction.value}(transaction.data);
    if (!success) revert TransactionFailed();
  }

  function transactionCount() external view returns (uint256) {
    return transactions.length;
  }

  /// @dev Multisig inspection surface used by production deployment validation tests.
  function getThreshold() external pure returns (uint256) {
    return 2;
  }

  /// @dev Multisig inspection surface used by production deployment validation tests.
  function getOwners() external view returns (address[] memory) {
    return owners;
  }

  /// @dev Deliberately mimics the TimelockController getter so tests prove that interface probing
  ///      alone cannot make a multisig eligible to own the upgradeable protocol.
  function getMinDelay() external pure returns (uint256) {
    return 3600;
  }

  receive() external payable {}
}

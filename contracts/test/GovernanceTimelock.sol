// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/TimelockController.sol";

// Test-only governance owner used to verify UUPS upgrades can be driven through a
// timelock (intended production model: timelock + multisig). TimelockController lives in
// node_modules and is not imported anywhere else, so this thin subclass exists solely to
// produce a compiled artifact the test suite can deploy.
contract GovernanceTimelock is TimelockController {
  constructor(
    uint256 minDelay,
    address[] memory proposers,
    address[] memory executors,
    address admin
  ) TimelockController(minDelay, proposers, executors, admin) {}
}

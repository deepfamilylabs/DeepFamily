// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../DeepFamilyToken.sol";

contract DeepFamilyTokenHarness is DeepFamilyToken {
  function seedSupply(address account, uint256 amount) external {
    _mint(account, amount);
  }

  /// @dev Test-only hook for exercising monitoring against a legacy/non-retired token owner.
  function forceBootstrapOwnerForTest(address account) external {
    _transferOwnership(account);
  }
}

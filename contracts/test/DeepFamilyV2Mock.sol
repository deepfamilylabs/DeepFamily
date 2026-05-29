// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {DeepFamily} from "../DeepFamily.sol";

/**
 * @title DeepFamilyV2Mock
 * @notice Test-only upgrade target used to verify a UUPS upgrade preserves existing storage
 *         and can introduce new behavior. The mock inherits DeepFamily and appends `newValue`
 *         after the existing state variables — the canonical append-only extension that
 *         scripts/check-storage-layout.mjs validates as storage-safe. A production V2 adds state
 *         the same way: declare new variables after the existing ones in the new implementation.
 */
contract DeepFamilyV2Mock is DeepFamily {
  uint256 public newValue;

  function setNewValue(uint256 v) external {
    newValue = v;
  }

  function version() external pure returns (string memory) {
    return "V2";
  }
}

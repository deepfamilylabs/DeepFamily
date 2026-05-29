// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title UnsafeUpgradeMock
 * @notice Intentionally storage-incompatible with DeepFamily. Used by
 *         scripts/check-storage-layout.mjs as a NEGATIVE test: diffing
 *         DeepFamily -> UnsafeUpgradeMock must produce errors. If it stops
 *         producing errors, the storage-layout checker has silently broken and the
 *         `storage:check` step is no longer enforcing UUPS safety.
 *
 *         The layout is intentionally minimal so the diff against DeepFamily's
 *         rich layout is unambiguously incompatible (slot 0 collides, all the
 *         rest is missing).
 */
contract UnsafeUpgradeMock {
  uint256 public somethingElse;
}

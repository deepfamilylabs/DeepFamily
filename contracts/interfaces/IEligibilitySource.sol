// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Authenticated eligibility facts and their immediately effective role status.
/// @dev Implementations must update source facts and revoke replaced roles atomically.
interface IEligibilitySource {
  function sourceRoot() external view returns (uint256);
  function trustedRoot() external view returns (uint256);

  /// @param role 0 = child qualification, 1 = endorsement, 2 = trusted recommender.
  /// @dev Check current state, never a caller-selected historical checkpoint.
  function isRoleRevoked(uint8 role, uint256 nonce, uint256 tag) external view returns (bool);

  /// @notice Called by DeepFamily, with the original authorized actor preserved.
  function revokeRoles(address actor, uint8[] calldata roles, uint256[] calldata secrets) external;

  /// @notice DeepFamily guards: a source fact cannot change while an old role remains active.
  function beforeEndorsementChange(uint256 childIdentity, address endorser) external view;
  function beforeTrustedChange(uint256 parentIdentity, uint256 parentVersion, address endorser) external view;
}

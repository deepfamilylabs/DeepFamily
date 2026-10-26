// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Authenticated eligibility facts and their immediately effective role status.
/// @dev Implementations must update source facts and revoke replaced roles atomically.
interface IEligibilitySource {
  function sourceRoot() external view returns (uint256);
  function trustedRoot() external view returns (uint256);

  /// @param role 0 = child qualification, 1 = endorsement, 2 = trusted recommender.
  /// @dev Check current state, never a caller-selected historical checkpoint. Revert when too
  ///      much history remains unprepared; incomplete preparation is not a qualification result.
  function isRoleRevoked(uint8 role, uint256 nonce, uint256 tag) external view returns (bool);

  /// @notice Authenticated digest of the role's complete revocation prefix [0,count).
  function revocationCheckpoint(uint8 role, uint256 count) external view returns (uint256);

  /// @notice Contiguous prefix already proved not to revoke this code's role tag.
  function roleScanProgress(uint8 role, uint256 nonce, uint256 tag) external view returns (uint256);

  /// @notice Advance only from the verified progress through one bounded, authenticated interval.
  function prepareRoleScan(uint8 role, uint256 nonce, uint256 tag, uint256 start, uint256 end, bytes calldata proof) external;

  /// @notice Called by DeepFamily, with the original authorized actor preserved.
  function revokeRoles(address actor, uint8[] calldata roles, uint256[] calldata secrets) external;

  /// @notice DeepFamily guards: a source fact cannot change while an old role remains active.
  function beforeEndorsementChange(uint256 childIdentity, address endorser) external view;
  function beforeTrustedChange(uint256 parentIdentity, uint256 parentVersion, address endorser) external view;
}

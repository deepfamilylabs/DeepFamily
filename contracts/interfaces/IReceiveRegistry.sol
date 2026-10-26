// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IReceiveRegistry {
  struct Code {
    uint256 codeAlias;
    uint256 commonBinding;
    uint256 revocationTag;
    uint256 nonce;
    uint256 ownerCommitment;
    uint256 viewKeyLo;
    uint256 viewKeyHi;
    uint64 expiresAt;
  }

  struct Capability {
    uint256 issuanceRoot;
    uint256 parentVersion;
    uint256 capabilityBinding;
    uint256 familyTag;
    uint256 childRoleIndex;
    uint256 endorsementRoleIndex;
    uint256 trustedRoleIndex;
  }

  function verifyReceive(Code calldata code, bytes calldata codeProof) external view returns (bool);

  function verifyBudgetCapability(
    Code calldata code,
    Capability calldata capability,
    bytes calldata codeProof,
    bytes calldata capabilityProof
  ) external view returns (bool);

  function isKnownIssuanceRoot(uint256 root) external view returns (bool);
  /// @dev State check only: the caller's fixed Claim circuit must authenticate these indices.
  function validateBudgetRoleStatus(uint256 issuanceRoot, uint256 childRoleIndex,
    uint256 endorsementRoleIndex, uint256 trustedRoleIndex) external view returns (bool);
  function isCodeRevoked(uint256 revocationTag) external view returns (bool);
}

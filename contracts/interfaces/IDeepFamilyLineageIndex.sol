// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @notice Poseidon LeanIMT mirror of DeepFamily's endorsement and trusted-endorser state, so a
 *         zero-knowledge proof can show membership in that state without naming the record.
 */
interface IDeepFamilyLineageIndex is IERC165 {
  event LeafWritten(uint8 indexed treeId, uint256 indexed leafIndex, uint256 leaf, uint256 root);
  /// @notice The Poseidon identity commitments behind a version, which DeepFamily stores only
  ///         keccak-wrapped. A claim needs both parents' commitments to open the parents digest.
  event VersionIndexed(
    bytes32 indexed personHash,
    uint256 indexed versionIndex,
    uint256 identityCommitment,
    uint256 fatherIdentityCommitment,
    uint256 motherIdentityCommitment
  );

  function DEEP_FAMILY() external view returns (address);
  function indexKind() external pure returns (bytes32);
  function apiVersion() external pure returns (uint256);

  function onVersionAdded(
    bytes32 personHash,
    uint256 versionIndex,
    uint256 identityCommitment,
    uint256 fatherIdentityCommitment,
    uint256 motherIdentityCommitment
  ) external;
  function onTrustedEndorserSet(
    bytes32 personHash,
    uint256 versionIndex,
    address account,
    bool trusted
  ) external;
  function onEndorsementSet(bytes32 personHash, address endorser, uint256 versionIndex) external;
  function onEndorsementCleared(bytes32 personHash, address endorser) external;

  function root(uint8 treeId) external view returns (uint256);
  function size(uint8 treeId) external view returns (uint256);
  function depth(uint8 treeId) external view returns (uint256);
  function isKnownRoot(uint8 treeId, uint256 candidate) external view returns (bool);
  function identityCommitmentOf(bytes32 personHash) external view returns (uint256);
  function parentsDigestOf(
    bytes32 personHash,
    uint256 versionIndex
  ) external view returns (uint256);
  function endorsementLeafIndex(
    bytes32 personHash,
    address endorser
  ) external view returns (bool exists, uint256 leafIndex);
  function trustedLeafIndex(
    bytes32 personHash,
    uint256 versionIndex,
    address account
  ) external view returns (bool exists, uint256 leafIndex);
}

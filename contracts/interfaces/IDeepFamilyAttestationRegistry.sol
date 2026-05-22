// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AttestationTypes} from "../libraries/AttestationTypes.sol";

interface IDeepFamilyAttestationRegistry {
  function anchorVerifierUpdateRef(
    AttestationTypes.AttestationRef calldata ref,
    address actor,
    uint16 proofSystemId,
    uint8 purpose,
    address verifier
  ) external returns (bytes32 attestationKey);

  function anchorEndorsementRef(
    AttestationTypes.AttestationRef calldata ref,
    address actor,
    bytes32 personHash,
    uint256 versionIndex
  ) external returns (bytes32 attestationKey);

  function anchorMintRef(
    AttestationTypes.AttestationRef calldata ref,
    address actor,
    bytes32 personHash,
    uint256 versionIndex,
    bytes32 tokenURIHash,
    bytes32 coreInfoDigest
  ) external returns (bytes32 attestationKey);

  function anchorProtocolFeeRef(
    AttestationTypes.AttestationRef calldata ref,
    address actor,
    uint256 newBps
  ) external returns (bytes32 attestationKey);

  function anchorStorySealRef(
    AttestationTypes.AttestationRef calldata ref,
    address actor,
    uint256 tokenId,
    uint256 totalChunks,
    bytes32 fullStoryHash
  ) external returns (bytes32 attestationKey);
}

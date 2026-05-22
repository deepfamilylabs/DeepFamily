// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library AttestationTypes {
  struct AttestationRef {
    uint16 attestationRefVersion;
    uint16 subjectType;
    bytes32 subjectHash;
    uint16 actionType;
    bytes32 actionDigest;
    bytes32 attestationPayloadDigest;
    uint16 signatureSuiteId;
    bytes32 signerKeyId;
    string uri;
    uint64 issuedAt;
    uint64 expiresAt;
    uint8 revocationType;
    bytes32 revocationRef;
  }
}

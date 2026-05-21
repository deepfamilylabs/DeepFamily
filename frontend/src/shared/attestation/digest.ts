import { ethers } from "ethers";
import {
  ACTION_TYPE_AUTHORITATIVE_MINT,
  ACTION_TYPE_HIGH_TRUST_ENDORSEMENT,
  ACTION_TYPE_PROTOCOL_FEE_UPDATE,
  ACTION_TYPE_STORY_SEAL,
  ACTION_TYPE_VERIFIER_UPDATE,
  ATTESTATION_REF_VERSION_V1,
  DOMAIN_ATTESTATION_ACTION,
  DOMAIN_ATTESTATION_SUBJECT_TOKEN,
  DOMAIN_ATTESTATION_SUBJECT_VERSION,
  REVOCATION_TYPE_NONE,
  SIG_SUITE_ECDSA_SECP256K1_V1,
  SUBJECT_TYPE_ACTION,
  SUBJECT_TYPE_TOKEN,
  SUBJECT_TYPE_VERSION,
  ZERO_REF,
} from "./catalogue";
import { canonicalizeJson } from "./canonicalize";
import type { AttestationRef, CanonicalAttestationPayload } from "./types";

const abi = ethers.AbiCoder.defaultAbiCoder();
let draftNonce = 1n;

export type MintCoreInfo = {
  basicInfo: {
    identityCommitment: string;
    isBirthBC: boolean;
    birthYear: number;
    birthMonth: number;
    birthDay: number;
    gender: number;
  };
  supplementInfo: {
    fullName: string;
    birthPlace: string;
    isDeathBC: boolean;
    deathYear: number;
    deathMonth: number;
    deathDay: number;
    deathPlace: string;
    story: string;
  };
};

export function computeVersionSubjectHash(personHash: string, versionIndex: number): string {
  return ethers.keccak256(
    abi.encode(["string", "bytes32", "uint256"], [DOMAIN_ATTESTATION_SUBJECT_VERSION, personHash, versionIndex]),
  );
}

export function computeTokenSubjectHash(tokenId: string | number | bigint): string {
  return ethers.keccak256(
    abi.encode(["string", "uint256"], [DOMAIN_ATTESTATION_SUBJECT_TOKEN, tokenId]),
  );
}

export function computeCoreInfoDigest(coreInfo: MintCoreInfo): string {
  return ethers.keccak256(
    abi.encode(
      [
        "bytes32",
        "bool",
        "uint16",
        "uint8",
        "uint8",
        "uint8",
        "bytes32",
        "bytes32",
        "bool",
        "uint16",
        "uint8",
        "uint8",
        "bytes32",
        "bytes32",
      ],
      [
        coreInfo.basicInfo.identityCommitment,
        coreInfo.basicInfo.isBirthBC,
        coreInfo.basicInfo.birthYear,
        coreInfo.basicInfo.birthMonth,
        coreInfo.basicInfo.birthDay,
        coreInfo.basicInfo.gender,
        ethers.keccak256(ethers.toUtf8Bytes(coreInfo.supplementInfo.fullName)),
        ethers.keccak256(ethers.toUtf8Bytes(coreInfo.supplementInfo.birthPlace)),
        coreInfo.supplementInfo.isDeathBC,
        coreInfo.supplementInfo.deathYear,
        coreInfo.supplementInfo.deathMonth,
        coreInfo.supplementInfo.deathDay,
        ethers.keccak256(ethers.toUtf8Bytes(coreInfo.supplementInfo.deathPlace)),
        ethers.keccak256(ethers.toUtf8Bytes(coreInfo.supplementInfo.story)),
      ],
    ),
  );
}

export function computeAuthoritativeMintActionDigest(args: {
  chainId: bigint | number;
  contractAddress: string;
  actor: string;
  personHash: string;
  versionIndex: number;
  tokenURI: string;
  coreInfo: MintCoreInfo;
}): string {
  return ethers.keccak256(
    abi.encode(
      ["string", "uint256", "address", "uint16", "address", "bytes32", "uint256", "bytes32", "bytes32"],
      [
        DOMAIN_ATTESTATION_ACTION,
        args.chainId,
        args.contractAddress,
        ACTION_TYPE_AUTHORITATIVE_MINT,
        args.actor,
        args.personHash,
        args.versionIndex,
        ethers.keccak256(ethers.toUtf8Bytes(args.tokenURI)),
        computeCoreInfoDigest(args.coreInfo),
      ],
    ),
  );
}

export function computeHighTrustEndorsementActionDigest(args: {
  chainId: bigint | number;
  contractAddress: string;
  actor: string;
  personHash: string;
  versionIndex: number;
}): string {
  return ethers.keccak256(
    abi.encode(
      ["string", "uint256", "address", "uint16", "address", "bytes32", "uint256"],
      [
        DOMAIN_ATTESTATION_ACTION,
        args.chainId,
        args.contractAddress,
        ACTION_TYPE_HIGH_TRUST_ENDORSEMENT,
        args.actor,
        args.personHash,
        args.versionIndex,
      ],
    ),
  );
}

export function computeStorySealActionDigest(args: {
  chainId: bigint | number;
  contractAddress: string;
  actor: string;
  tokenId: string | number | bigint;
  totalChunks: string | number | bigint;
  fullStoryHash: string;
}): string {
  return ethers.keccak256(
    abi.encode(
      ["string", "uint256", "address", "uint16", "address", "uint256", "uint256", "bytes32"],
      [
        DOMAIN_ATTESTATION_ACTION,
        args.chainId,
        args.contractAddress,
        ACTION_TYPE_STORY_SEAL,
        args.actor,
        args.tokenId,
        args.totalChunks,
        args.fullStoryHash,
      ],
    ),
  );
}

export function computeVerifierUpdateActionDigest(args: {
  chainId: bigint | number;
  contractAddress: string;
  actor: string;
  proofSystemId: number;
  purpose: number;
  verifier: string;
}): string {
  return ethers.keccak256(
    abi.encode(
      ["string", "uint256", "address", "uint16", "address", "uint16", "uint8", "address"],
      [
        DOMAIN_ATTESTATION_ACTION,
        args.chainId,
        args.contractAddress,
        ACTION_TYPE_VERIFIER_UPDATE,
        args.actor,
        args.proofSystemId,
        args.purpose,
        args.verifier,
      ],
    ),
  );
}

export function computeProtocolFeeUpdateActionDigest(args: {
  chainId: bigint | number;
  contractAddress: string;
  actor: string;
  newBps: string | number | bigint;
}): string {
  return ethers.keccak256(
    abi.encode(
      ["string", "uint256", "address", "uint16", "address", "uint256"],
      [DOMAIN_ATTESTATION_ACTION, args.chainId, args.contractAddress, ACTION_TYPE_PROTOCOL_FEE_UPDATE, args.actor, args.newBps],
    ),
  );
}

export function computeAttestationPayloadDigest(payload: CanonicalAttestationPayload): string {
  return ethers.keccak256(ethers.toUtf8Bytes(canonicalizeJson(payload)));
}

export function makeDraftAttestationRef(args: {
  subjectType: number;
  subjectHash: string;
  actionType: number;
  actionDigest: string;
  signerAddress: string;
  issuedAt?: number;
  expiresAt?: number;
  uri?: string;
}): AttestationRef {
  const issuedAt = args.issuedAt ?? Math.floor(Date.now() / 1000);
  const expiresAt = args.expiresAt ?? issuedAt + 3600;
  const nonce = draftNonce++;
  const attestationPayloadDigest = ethers.keccak256(
    abi.encode(["bytes32", "address", "uint256"], [args.actionDigest, args.signerAddress, nonce]),
  );
  return {
    attestationRefVersion: ATTESTATION_REF_VERSION_V1,
    subjectType: args.subjectType,
    subjectHash: args.subjectHash,
    actionType: args.actionType,
    actionDigest: args.actionDigest,
    attestationPayloadDigest,
    signatureSuiteId: SIG_SUITE_ECDSA_SECP256K1_V1,
    signerKeyId: ethers.zeroPadValue(args.signerAddress, 32),
    uri: args.uri ?? `ipfs://draft-attestation-${nonce.toString()}`,
    issuedAt,
    expiresAt,
    revocationType: REVOCATION_TYPE_NONE,
    revocationRef: ZERO_REF,
  };
}

export function makeDraftMintAttestationRef(args: {
  chainId: bigint | number;
  contractAddress: string;
  actor: string;
  personHash: string;
  versionIndex: number;
  tokenURI: string;
  coreInfo: MintCoreInfo;
}): AttestationRef {
  const subjectHash = computeVersionSubjectHash(args.personHash, args.versionIndex);
  const actionDigest = computeAuthoritativeMintActionDigest(args);
  return makeDraftAttestationRef({
    subjectType: SUBJECT_TYPE_VERSION,
    subjectHash,
    actionType: ACTION_TYPE_AUTHORITATIVE_MINT,
    actionDigest,
    signerAddress: args.actor,
  });
}

export function makeDraftEndorseAttestationRef(args: {
  chainId: bigint | number;
  contractAddress: string;
  actor: string;
  personHash: string;
  versionIndex: number;
}): AttestationRef {
  const subjectHash = computeVersionSubjectHash(args.personHash, args.versionIndex);
  const actionDigest = computeHighTrustEndorsementActionDigest(args);
  return makeDraftAttestationRef({
    subjectType: SUBJECT_TYPE_VERSION,
    subjectHash,
    actionType: ACTION_TYPE_HIGH_TRUST_ENDORSEMENT,
    actionDigest,
    signerAddress: args.actor,
  });
}

export function makeDraftStorySealAttestationRef(args: {
  chainId: bigint | number;
  contractAddress: string;
  actor: string;
  tokenId: string | number | bigint;
  totalChunks: string | number | bigint;
  fullStoryHash: string;
}): AttestationRef {
  const subjectHash = computeTokenSubjectHash(args.tokenId);
  const actionDigest = computeStorySealActionDigest(args);
  return makeDraftAttestationRef({
    subjectType: SUBJECT_TYPE_TOKEN,
    subjectHash,
    actionType: ACTION_TYPE_STORY_SEAL,
    actionDigest,
    signerAddress: args.actor,
  });
}

export function makeDraftProtocolFeeAttestationRef(args: {
  chainId: bigint | number;
  contractAddress: string;
  actor: string;
  newBps: string | number | bigint;
}): AttestationRef {
  const actionDigest = computeProtocolFeeUpdateActionDigest(args);
  return makeDraftAttestationRef({
    subjectType: SUBJECT_TYPE_ACTION,
    subjectHash: actionDigest,
    actionType: ACTION_TYPE_PROTOCOL_FEE_UPDATE,
    actionDigest,
    signerAddress: args.actor,
  });
}

export function makeDraftVerifierUpdateAttestationRef(args: {
  chainId: bigint | number;
  contractAddress: string;
  actor: string;
  proofSystemId: number;
  purpose: number;
  verifier: string;
}): AttestationRef {
  const actionDigest = computeVerifierUpdateActionDigest(args);
  return makeDraftAttestationRef({
    subjectType: SUBJECT_TYPE_ACTION,
    subjectHash: actionDigest,
    actionType: ACTION_TYPE_VERIFIER_UPDATE,
    actionDigest,
    signerAddress: args.actor,
  });
}

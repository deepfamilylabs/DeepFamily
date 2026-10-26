/** New receive protocol. Proof callbacks must use pinned protocol verification keys. */
export type ProtocolInteger = bigint | number | string;
export type ProtocolBytes = Uint8Array | ArrayBuffer | ArrayBufferView | string;
export interface ProtocolProof {
  pi_a: readonly ProtocolInteger[];
  pi_b: readonly (readonly ProtocolInteger[])[];
  pi_c: readonly ProtocolInteger[];
  protocol?: "groth16";
  curve?: "bn128";
}
export interface ReceiveCommonInput {
  chainId: ProtocolInteger;
  /** Registry address as a 0x-prefixed address or a canonical integer. */
  authorizerScope: ProtocolInteger;
  nonce: ProtocolInteger;
  codeAlias: ProtocolInteger;
  commonBinding?: ProtocolInteger;
  revocationTag: ProtocolInteger;
  ownerCommitment: ProtocolInteger;
  viewingKey: ProtocolBytes;
  expiresAt: ProtocolInteger;
}
export interface ReceiveCommon {
  chainId: bigint;
  authorizerScope: bigint;
  nonce: bigint;
  codeAlias: bigint;
  commonBinding: bigint;
  revocationTag: bigint;
  ownerCommitment: bigint;
  viewingKey: Uint8Array;
  expiresAt: bigint;
}
export interface CapabilityInput {
  issuanceRoot: ProtocolInteger;
  parentVersion: ProtocolInteger;
  familyTag: ProtocolInteger;
  childRoleIndex: ProtocolInteger;
  endorsementRoleIndex: ProtocolInteger;
  trustedRoleIndex: ProtocolInteger;
  capabilityBinding: ProtocolInteger;
  proof: ProtocolProof;
}
export interface Capability {
  issuanceRoot: bigint;
  parentVersion: bigint;
  familyTag: bigint;
  childRoleIndex: bigint;
  endorsementRoleIndex: bigint;
  trustedRoleIndex: bigint;
  capabilityBinding: bigint;
  proof: ProtocolProof;
  publicSignals: bigint[];
}
export interface ReceiveCodeInput extends ReceiveCommonInput {
  proof: ProtocolProof;
  capabilities?: readonly CapabilityInput[];
}
export interface ReceiveCode extends ReceiveCommon {
  version: 1;
  proof: ProtocolProof;
  publicSignals: bigint[];
  capabilities: Capability[];
}
export interface ReceivePrivateInput {
  chainId: ProtocolInteger;
  authorizerScope: ProtocolInteger;
  nonce: ProtocolInteger;
  codeRootSecret: ProtocolInteger;
  codeSecret: ProtocolInteger;
  ownerSecret: ProtocolInteger;
  ownerCommitment?: ProtocolInteger;
  viewingKey: ProtocolBytes;
  expiresAt: ProtocolInteger;
}
export interface ReceiveKeyMaterial {
  chainId: bigint;
  authorizerScope: bigint;
  /** Private witness; never encode or publish. */
  codeRootSecret: bigint;
  /** Private witness; never encode or publish. */
  codeSecret: bigint;
  nonce: bigint;
  /** Private spending secret; never encode or publish. */
  ownerSecret: bigint;
  ownerCommitment: bigint;
  /** Private HPKE derivation material; never encode or publish. */
  hpkeIkm: string;
  viewingKey: Uint8Array;
  viewKeyLo: bigint;
  viewKeyHi: bigint;
}
export const RECEIVE_VERSION: 1;
export const RECEIVE_PREFIX: "dfreceive";
export const RECEIVE_MAX_CAPABILITIES: 2;
export const RECEIVE_PUBLIC_SIGNAL_COUNT: 10;
export const CAPABILITY_PUBLIC_SIGNAL_COUNT: 10;
export function buildReceivePublicSignals(input: ReceiveCommonInput): bigint[];
export function computeReceiveAuthorization(input: ReceivePrivateInput): ReceiveCommon & {
  /** Publish only to revoke this code, since its publication identifies the code. */
  revocationSecret: bigint;
  publicSignals: bigint[];
};
export function computeCapabilityBinding(
  common: ReceiveCommonInput,
  capability: Omit<CapabilityInput, "proof" | "capabilityBinding">,
): bigint;
export function buildCapabilityPublicSignals(
  common: ReceiveCommonInput,
  capability: Omit<CapabilityInput, "proof">,
): bigint[];
/** Encodes a transport envelope; does not verify Groth16 proofs. */
export function encodeReceiveCode(input: ReceiveCodeInput): string;
/** Validates transport, ranges and public bindings; does not verify Groth16 proofs. */
export function decodeReceiveCode(code: string): ReceiveCode;
/** Prefix detection only. */
export function isReceiveCode(code: unknown): boolean;
export type ProtocolProofVerifier = (
  proof: ProtocolProof,
  publicSignals: bigint[],
) => Promise<boolean> | boolean;
export function verifyReceiveCode(input: {
  code: string;
  verifyAuthorization: ProtocolProofVerifier;
  verifyCapability?: ProtocolProofVerifier;
  chainId?: ProtocolInteger;
  authorizerScope?: ProtocolInteger;
  asOf?: ProtocolInteger;
}): Promise<ReceiveCode>;
export function computeFamilyTag(input: {
  familyCommitment: ProtocolInteger;
  nonce: ProtocolInteger;
}): bigint;
export function computeRoleStatusIndex(input: {
  role: "child" | "endorsement" | "trusted";
  roleSecret: ProtocolInteger;
}): bigint;
/** Restore the selected private branch. codeIndex must be explicitly supplied and backed up privately. */
export function deriveReceiveKeyMaterial(input: {
  masterKey: ProtocolBytes;
  chainId: ProtocolInteger;
  authorizerScope: ProtocolInteger;
  codeIndex: ProtocolInteger;
  /** Qualified wallets must provide their actual canonical identity derivedSecretField. */
  codeRootSecret?: ProtocolInteger;
}): Promise<ReceiveKeyMaterial>;

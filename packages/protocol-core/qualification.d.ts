import type { ProtocolInteger, ProtocolBytes } from "./receive-code.js";
import type { WalletState } from "./wallet.js";
export interface QualificationRequestInput {
  chainId: ProtocolInteger;
  registryAddress: string;
  sourceAddress: string;
  childIdentity: ProtocolInteger;
  parentIdentity: ProtocolInteger;
  parentVersion: ProtocolInteger;
  endorser: string;
  nonce: string;
  recipientPublicKey: string;
}
export interface QualificationRequest {
  version: 1;
  chainId: string;
  registryAddress: string;
  sourceAddress: string;
  childIdentity: string;
  parentIdentity: string;
  parentVersion: string;
  endorser: string;
  nonce: string;
  recipientPublicKey: string;
  request: string;
  requestId: string;
  childPersonHash: string;
  parentPersonHash: string;
}
export interface WalletSourceOpening {
  xChild: string;
  xEndorse: string;
  xTrust: string;
  sourceFactSalt: string;
  sourceTrustSalt: string;
  familySalt: string;
}
export interface WalletSourceAttachment extends WalletSourceOpening {
  kind: "fact" | "trust";
  sourceAddress: string;
  controller: string;
  leafIndex: string;
}
export interface WalletQualificationRequest {
  id: string;
  request: string;
  fact: WalletSourceAttachment | null;
  trust: WalletSourceAttachment | null;
  issue: {
    issueNonce: string;
    credentialSalt: string;
    credentialCommitment: string;
    familyRoot: string;
  } | null;
  credentialIndex: string | null;
}
export interface WalletQualificationSource extends WalletSourceOpening {
  id: string;
  kind: "fact" | "trust";
  request: string;
  sourceAddress: string;
  controller: string;
  publication: { transactionHash: string | null; leafIndex: string } | null;
}
export interface WalletQualificationState {
  requests: WalletQualificationRequest[];
  sources: WalletQualificationSource[];
  families: Array<{ parentIdentity: string; parentVersion: string; familySalt: string }>;
}
export function encodeQualificationRequest(input: QualificationRequestInput): QualificationRequest;
export function decodeQualificationRequest(request: string): QualificationRequest;
export function qualificationHandoffIkm(
  input: Pick<WalletState, "masterKey" | "chainId" | "authorizerScope"> & { nonce: string },
): Uint8Array;
export function qualificationHandoffPublicKey(
  input: Pick<WalletState, "masterKey" | "chainId" | "authorizerScope"> & { nonce: string },
): Promise<string>;
export const QUALIFICATION_OPENING_FIELDS: readonly string[];
export function encryptQualificationPackage(input: {
  request: string;
  source: WalletSourceAttachment;
}): Promise<Uint8Array>;
export function decryptQualificationPackage(input: {
  wallet: WalletState;
  request: string;
  package: ProtocolBytes;
}): Promise<WalletSourceAttachment>;
export function normalizeWalletQualifications(
  input?: Partial<WalletQualificationState>,
): WalletQualificationState;

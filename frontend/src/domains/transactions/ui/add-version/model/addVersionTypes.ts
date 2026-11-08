import type { TransactionErrorContext } from "@deepfamily/chain-client";
import type { TFunction } from "i18next";
import type { PersonData, ProofEnvelope } from "../../../../../shared/zk/zk";
import type {
  AddVersionPublicSignals,
  AddVersionResult,
  AddVersionTransactionPreview,
} from "../../../services/addVersionService";

export type { AddVersionPublicSignals, AddVersionResult, AddVersionTransactionPreview };

export type AddVersionT = TFunction;

export interface AddVersionFormInput {
  fatherVersionIndex: number | "";
  motherVersionIndex: number | "";
  tag: string;
  biography: string;
}

export interface AddVersionFormData {
  fatherVersionIndex: number;
  motherVersionIndex: number;
  tag: string;
  biography: string;
}

export interface EncryptedMetadataBundle {
  envelope: Uint8Array;
  payloadHash: string;
  envelopeLength: number;
  versionCommitment: bigint;
}

export interface PersonInfoPublic {
  fullName: string;
  gender: number;
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  isBirthBC: boolean;
}

export interface IdentityMaterial {
  personData: PersonData;
  personHash: string;
  identitySuiteId: number;
  identityCommitment: bigint;
  derivedSecretField: bigint;
}

export interface AddVersionConsents {
  hash: boolean;
  legal: boolean;
  passphrase: boolean;
}

export type ParentKind = "father" | "mother";
export type ParentStatus = "empty" | "partial" | "complete";
export type AddVersionIdentityRole = "person" | ParentKind;

export interface AddVersionFlowArgs {
  proof: ProofEnvelope;
  publicSignals: AddVersionPublicSignals;
  fatherVersionIndex: number;
  motherVersionIndex: number;
  metadataEnvelope: Uint8Array;
}

export interface AddVersionSuccessResultView {
  hash: string;
  index: number;
  rewardAmount: number;
  transactionHash: string;
  blockNumber: number;
  events: AddVersionResult["events"];
}

export interface AddVersionErrorResultView extends TransactionErrorContext {
  type: string;
  message: string;
  details: string;
  retryable?: boolean;
}

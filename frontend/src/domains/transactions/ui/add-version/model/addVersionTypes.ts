import type { TFunction } from "i18next";
import type { FriendlyError } from "../../../../../shared/lib/errors";
import type { PersonData, ProofEnvelope } from "../../../../../shared/zk/zk";
import type {
  AddVersionPublicSignals,
  AddVersionResult,
} from "../../../services/addVersionService";

export type { AddVersionPublicSignals, AddVersionResult };

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
  age: boolean;
  legal: boolean;
  passphrase: boolean;
}

export type ParentKind = "father" | "mother";
export type ParentStatus = "empty" | "partial" | "complete";

export interface AddVersionFlowArgs {
  proof: ProofEnvelope;
  publicSignals: AddVersionPublicSignals;
  fatherVersionIndex: number;
  motherVersionIndex: number;
  metadataEnvelope: Uint8Array;
}

export type AddVersionFlowStep = "idle" | "validating" | "confirming" | "success" | "error";

export type AddVersionFlowState =
  | { step: "idle"; result?: undefined; error?: undefined }
  | { step: "validating"; result?: undefined; error?: undefined }
  | { step: "confirming"; result?: undefined; error?: undefined }
  | { step: "success"; result: AddVersionResult; error?: undefined }
  | { step: "error"; result?: undefined; error: FriendlyError };

export type AddVersionFlowAction =
  | { type: "reset" }
  | { type: "stage"; step: Extract<AddVersionFlowStep, "validating" | "confirming"> }
  | { type: "success"; result: AddVersionResult }
  | { type: "error"; error: FriendlyError };

export interface AddVersionSuccessResultView {
  hash: string;
  index: number;
  rewardAmount: number;
  transactionHash: string;
  blockNumber: number;
  events: AddVersionResult["events"];
}

export interface AddVersionErrorResultView {
  type: string;
  message: string;
  details: string;
  retryable?: boolean;
}

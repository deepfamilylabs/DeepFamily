import type { TFunction } from "i18next";
import type { FriendlyError } from "../../../../../shared/lib/errors";
import type { MetadataRecoveryV2 } from "../../../../../shared/crypto/metadataCrypto";
import type { IdentitySaltMode } from "../../../../../shared/crypto/identityHash";
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
  metadataCID?: string;
}

export interface AddVersionFormData {
  fatherVersionIndex: number;
  motherVersionIndex: number;
  tag: string;
  metadataCID?: string;
}

export interface EncryptedMetadataBundle {
  json: string;
  cid: string;
  plainHash: string;
  passwordFingerprint: string;
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
  identityMode: IdentitySaltMode;
  identitySaltHex: string | null;
  recovery: MetadataRecoveryV2["identityKdf"] | null;
}

export interface IdentityResolutionOptions {
  identityMode?: IdentitySaltMode;
  identitySaltHex?: string | null;
}

export interface IdentitySaltSelections {
  personIdentitySaltHex: string | null;
  fatherIdentitySaltHex: string | null;
  motherIdentitySaltHex: string | null;
}

export interface AddVersionConsents {
  hash: boolean;
  age: boolean;
  legal: boolean;
}

export type ParentKind = "father" | "mother";
export type ParentStatus = "empty" | "partial" | "complete";

export interface AddVersionFlowArgs {
  proof: ProofEnvelope;
  publicSignals: AddVersionPublicSignals;
  fatherVersionIndex: number;
  motherVersionIndex: number;
  tag: string;
  metadataCID: string;
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
}

import type { TFunction } from "i18next";
import type { FriendlyError } from "../../../../../shared/lib/errors";
import type {
  ExecuteMintFlowResult,
  MintCoreInfo,
  MintDisclosurePublicSignals,
} from "../../../services/mintNftService";

export type { ExecuteMintFlowResult, MintCoreInfo, MintDisclosurePublicSignals };

export type MintNFTT = TFunction;

export interface MintNFTFormValues {
  birthPlace: string;
  isDeathBC: boolean;
  deathYear: number | string;
  deathMonth: number | string;
  deathDay: number | string;
  deathPlace: string;
  story: string;
  tokenURI?: string;
}

export interface MintPersonInfo {
  fullName: string;
  gender: number;
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  isBirthBC: boolean;
}

export interface MintConsents {
  public: boolean;
  age: boolean;
  legal: boolean;
}

export type MintMissingParents = {
  father: boolean;
  mother: boolean;
} | null;

export interface MintNftFlowArgs {
  personHash: string;
  versionIndex: number;
  proofEnvelope: any;
  publicSignals: MintDisclosurePublicSignals;
  tokenURI: string;
  coreInfo: MintCoreInfo;
}

export type MintNftFlowStep =
  | "idle"
  | "validating"
  | "submitting"
  | "confirming"
  | "success"
  | "error";

export type MintNftFlowState =
  | { step: "idle"; result?: undefined; error?: undefined }
  | { step: "validating"; result?: undefined; error?: undefined }
  | { step: "submitting"; result?: undefined; error?: undefined }
  | { step: "confirming"; result?: undefined; error?: undefined }
  | { step: "success"; result: ExecuteMintFlowResult; error?: undefined }
  | { step: "error"; result?: undefined; error: FriendlyError };

export type MintNftFlowAction =
  | { type: "reset" }
  | { type: "stage"; step: Extract<MintNftFlowStep, "validating" | "submitting" | "confirming"> }
  | { type: "success"; result: ExecuteMintFlowResult }
  | { type: "error"; error: FriendlyError };

export interface MintNFTSuccessResultView {
  tokenId: number;
  personHash: string;
  versionIndex: number;
  tokenURI: string;
  transactionHash: string;
  blockNumber: number;
  events: { PersonNFTMinted: any };
}

export interface MintNFTErrorResultView {
  type: string;
  message: string;
  details: string;
}

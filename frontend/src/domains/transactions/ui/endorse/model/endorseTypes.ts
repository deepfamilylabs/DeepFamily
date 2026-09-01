import type { FriendlyError } from "../../../../../shared/lib/errors";
import type { ExecuteEndorseFlowResult, EndorseServiceStage } from "../../../services/endorseService";

export type { ExecuteEndorseFlowResult, EndorseServiceStage };

export interface EndorseFlowArgs {
  personHash: string;
  versionIndex: number;
  deepTokenAddress?: string;
  suppressToasts?: boolean;
  onStageChange?: (stage: EndorseServiceStage) => void;
}

export type EndorseFlowStep = "idle" | "validating" | "approving" | "submitting" | "success" | "error";

export type EndorseFlowState =
  | { step: "idle"; result?: undefined; error?: undefined }
  | { step: "validating"; result?: undefined; error?: undefined }
  | { step: "approving"; result?: undefined; error?: undefined }
  | { step: "submitting"; result?: undefined; error?: undefined }
  | { step: "success"; result: ExecuteEndorseFlowResult; error?: undefined }
  | { step: "error"; result?: undefined; error: FriendlyError };

export type EndorseFlowAction =
  | { type: "reset" }
  | { type: "stage"; step: Extract<EndorseFlowStep, "validating" | "approving" | "submitting"> }
  | { type: "success"; result: ExecuteEndorseFlowResult }
  | { type: "error"; error: FriendlyError };

export type EndorseT = (
  key: string,
  fallback: string,
  options?: Record<string, unknown>,
) => string;

export interface EndorseSuccessResultView {
  personHash: string;
  versionIndex: number;
  endorsementFee: string;
  feeRecipient: string;
  transactionHash: string;
  blockNumber: number;
  events: { PersonVersionEndorsed: any };
}

export interface EndorseErrorResultView {
  type: string;
  message: string;
  details: string;
  retryable?: boolean;
}


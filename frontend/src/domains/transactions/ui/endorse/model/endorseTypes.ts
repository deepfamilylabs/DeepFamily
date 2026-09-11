import type { FriendlyError } from "../../../../../shared/lib/errors";
import type {
  EndorseFeeQuote,
  ExecuteEndorseFlowResult,
  EndorseServiceStage,
} from "../../../services/endorseService";

export type { EndorseFeeQuote, ExecuteEndorseFlowResult, EndorseServiceStage };

export interface EndorseFlowArgs {
  personHash: string;
  versionIndex: number;
  deepTokenAddress?: string;
  quotedFee?: bigint;
  onStageChange?: (stage: EndorseServiceStage) => void;
  onFeeQuoteChange?: (quote: EndorseFeeQuote) => void;
}

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


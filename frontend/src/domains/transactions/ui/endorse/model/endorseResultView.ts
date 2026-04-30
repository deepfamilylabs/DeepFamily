import type { EndorseErrorResultView, EndorseSuccessResultView, ExecuteEndorseFlowResult } from "./endorseTypes";

type SuccessfulEndorseResult = Extract<ExecuteEndorseFlowResult, { alreadyEndorsed: false }>;

interface BuildEndorseSuccessResultArgs {
  result: SuccessfulEndorseResult;
  personHash: string;
  versionIndex: number;
  feeRecipient: string;
  endorser?: string;
}

export function toEndorseErrorResult(
  type: string,
  message: string,
  retryable?: boolean,
): EndorseErrorResultView {
  return {
    type,
    message,
    details: message,
    retryable,
  };
}

export function buildEndorseSuccessResultView({
  result,
  personHash,
  versionIndex,
  feeRecipient,
  endorser,
}: BuildEndorseSuccessResultArgs): EndorseSuccessResultView {
  const timestamp = Math.floor(Date.now() / 1000);

  return {
    personHash,
    versionIndex,
    endorsementFee: result.feeFormatted,
    feeRecipient,
    transactionHash: result.transactionHash,
    blockNumber: result.blockNumber,
    events: {
      PersonVersionEndorsed: result.event
        ? {
            personHash: result.event.personHash,
            endorser: result.event.endorser,
            versionIndex: result.event.versionIndex,
            recipient: result.event.recipient,
            recipientShare: result.event.recipientShare,
            protocolRecipient: result.event.protocolRecipient,
            protocolShare: result.event.protocolShare,
            endorsementFee: result.event.endorsementFee,
            timestamp: result.event.timestamp || timestamp,
          }
        : {
            personHash,
            endorser,
            versionIndex,
            recipient: undefined,
            recipientShare: undefined,
            protocolRecipient: undefined,
            protocolShare: undefined,
            endorsementFee: result.fee.toString(),
            timestamp,
          },
    },
  };
}

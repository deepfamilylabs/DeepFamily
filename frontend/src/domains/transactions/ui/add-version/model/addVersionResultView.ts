import type {
  AddVersionErrorResultView,
  AddVersionResult,
  AddVersionSuccessResultView,
} from "./addVersionTypes";

export function toAddVersionErrorResult(
  type: string,
  message: string,
  retryable?: boolean,
): AddVersionErrorResultView {
  return {
    type,
    message,
    details: message,
    retryable,
  };
}

export function buildAddVersionSuccessResultView(
  result: AddVersionResult,
): AddVersionSuccessResultView {
  return {
    hash: result.hash,
    index: result.index,
    rewardAmount: result.rewardAmount,
    transactionHash: result.transactionHash,
    blockNumber: result.blockNumber,
    events: result.events,
  };
}

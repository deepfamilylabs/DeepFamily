import { extractRevertReason, resolveErrorReason } from "./core";

const STORY_ERROR_MESSAGES: Record<string, string> = {
  MustBeNFTHolder: "You must own this NFT to edit its story",
  Unauthorized: "Not authorized to perform this action",
  OnlyOwner: "Only the owner can perform this action",
  StorySealed: "Story is sealed and cannot be modified",
  StoryAlreadySealed: "Story is sealed and cannot be modified",
  ChunkIndexExists: "Chunk at this index already exists",
  InvalidChunkIndex: "Invalid chunk index",
  ContentTooLong: "Content exceeds maximum length",
  ExpectedHashMismatch: "Expected hash does not match",
  ChunkHashMismatch: "Chunk content does not match expected hash",
  ChunkIndexOutOfRange: "Chunk index is out of valid range",
  InvalidChunkContent: "Story chunk content invalid",
};

const makeTypedError = (message: string, type: string, code?: string): Error => {
  const err = new Error(message);
  (err as any).type = type;
  if (code) (err as any).code = code;
  return err;
};

/**
 * Normalize a raw story transaction error into a typed Error with `type` and
 * optional `code` properties. Reuses the shared revert decoding / reason
 * detection pipeline so story flows do not maintain a separate parser.
 */
export function normalizeStoryTxError(error: any, contract: any): Error {
  const reason = resolveErrorReason(error);
  if (reason === "WALLET_POPUP_TIMEOUT") {
    return makeTypedError(
      "Wallet confirmation timed out. Please reopen your wallet and confirm the transaction.",
      "WALLET_POPUP_TIMEOUT",
      "WALLET_POPUP_TIMEOUT",
    );
  }

  if (reason === "USER_REJECTED") {
    return makeTypedError("Transaction was rejected by user", "USER_REJECTED", "USER_REJECTED");
  }

  if (reason === "INSUFFICIENT_FUNDS") {
    return makeTypedError("Insufficient funds for gas", "INSUFFICIENT_FUNDS");
  }

  if (reason) {
    return makeTypedError(STORY_ERROR_MESSAGES[reason] || `Contract error: ${reason}`, reason);
  }

  const revertReason = extractRevertReason(contract, error);
  if (revertReason) {
    return makeTypedError(
      STORY_ERROR_MESSAGES[revertReason] || `Contract error: ${revertReason}`,
      revertReason,
    );
  }

  if (
    error?.code === -32002 ||
    (typeof error?.message === "string" && /request (?:is )?already pending/i.test(error.message))
  ) {
    return makeTypedError(
      "Wallet has a pending request. Open your wallet to confirm or cancel it, then try again.",
      "WALLET_REQUEST_PENDING",
      "WALLET_REQUEST_PENDING",
    );
  }

  if (
    typeof error?.message === "string" &&
    error.message.includes("execution reverted")
  ) {
    return makeTypedError("Transaction failed: execution reverted", "EXECUTION_REVERTED");
  }

  return makeTypedError(error?.message || "An unknown error occurred", "UNKNOWN_ERROR");
}

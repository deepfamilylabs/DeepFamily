import { defaultErrorTranslator, normalizeErrorToError } from "./core";

const STORY_ERROR_MESSAGES: Record<string, string> = {
  MustBeNFTHolder: "You must own this NFT to edit its story",
  Unauthorized: "Not authorized to perform this action",
  OnlyOwner: "Only the owner can perform this action",
  StorySealed: "Story is sealed and cannot be modified",
  StoryAlreadySealed: "Story is sealed and cannot be modified",
  InvalidStoryArchive: "Story archive configuration is invalid",
  StoryArchiveAlreadySet: "Story archive is already configured",
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
  const normalized = normalizeErrorToError(error, defaultErrorTranslator as any, {
    contract,
    fallbackMessage: error?.message || "An unknown error occurred",
    messageOverrides: STORY_ERROR_MESSAGES,
  });
  const typed = makeTypedError(
    normalized.message,
    (normalized as any).type || "UNKNOWN_ERROR",
    (normalized as any).code,
  );
  (typed as any).reason = (normalized as any).reason;
  (typed as any).details = (normalized as any).details;
  (typed as any).retryable = (normalized as any).retryable;
  (typed as any).friendly = (normalized as any).friendly;
  return typed;
}

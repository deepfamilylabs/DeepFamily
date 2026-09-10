import { defaultErrorTranslator, normalizeErrorToError } from "./core";

const STORY_ERROR_MESSAGES: Record<string, string> = {
  MustBeNFTHolder: "You must own this NFT to edit its story",
  Unauthorized: "Not authorized to perform this action",
  OnlyOwner: "Only the owner can perform this action",
  StoryAlreadySealed: "Story is sealed and cannot be modified",
  InvalidArchive: "Archive configuration is invalid",
  ArchiveAlreadySet: "Archive is already configured",
  ArchiveNotActive: "This archive is not the configured archive",
  InvalidSchemaId: "Story schema must be nonzero",
  InvalidPayloadLength: "Story payload cannot be empty",
  PayloadHashMismatch: "Story payload differs from the expected hash",
  StoryIndexMismatch: "Story changed; refresh before appending",
  StoryHeadMismatch: "Story changed; refresh before appending",
  StoryNotFound: "Story has no records",
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
  if (error?.code === "ARCHIVE_VALIDATION_FAILED")
    return makeTypedError(error.message, "VALIDATION_ERROR", error.code);
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

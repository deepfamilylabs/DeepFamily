import {
  defaultErrorTranslator,
  normalizeErrorToError,
  type NormalizedError,
  type NormalizeFriendlyErrorOptions,
} from "./core";

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

/** Story-specific wording uses the same classification and normalization as every UI flow. */
export function normalizeStoryTxError(error: unknown, contract: NormalizeFriendlyErrorOptions["contract"]): NormalizedError {
  return normalizeErrorToError(error, defaultErrorTranslator as any, {
    contract,
    messageOverrides: STORY_ERROR_MESSAGES,
  });
}

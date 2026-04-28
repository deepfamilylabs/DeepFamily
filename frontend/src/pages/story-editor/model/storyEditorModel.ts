import { ethers } from "ethers";
import type { NodeData, StoryChunk, StoryMetadata } from "../../../shared/model";
import { formatHashMiddle } from "../../../shared/model";

export interface PrefetchedStoryState {
  prefetchedStory?: {
    tokenId: string;
    fullName?: string;
    storyMetadata?: StoryMetadata;
    storyChunks?: StoryChunk[];
  };
}

export interface ChunkFormData {
  content: string;
  expectedHash?: string;
  chunkType: number;
  attachmentCID: string;
}

export const STORY_MAX_CHUNK_BYTES = 2048;
export const STORY_WARNING_ORANGE_BYTES = STORY_MAX_CHUNK_BYTES - 200;
export const STORY_WARNING_YELLOW_BYTES = STORY_MAX_CHUNK_BYTES - 400;
export const STORY_MAX_ATTACHMENT_CHARS = 256;

export const initialChunkFormData: ChunkFormData = {
  content: "",
  chunkType: 0,
  attachmentCID: "",
  expectedHash: undefined,
};

export function convertChunkTypeToNumber(type: number | string | null | undefined): number {
  if (type === null || type === undefined || type === "") return 0;
  if (typeof type === "number" && Number.isFinite(type)) return type;
  if (typeof type === "string") {
    const trimmed = type.trim();
    if (!trimmed) return 0;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number(type as any);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeStoryChunks(chunks: StoryChunk[] | undefined): StoryChunk[] | undefined {
  return chunks?.map((chunk) => ({
    ...chunk,
    chunkType: convertChunkTypeToNumber(chunk.chunkType),
    attachmentCID: chunk.attachmentCID ?? "",
  }));
}

export function computeContentHash(content: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(content));
}

export function formatStoryHash(hash?: string): string {
  return formatHashMiddle(hash);
}

export function getByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function resolveAttachmentUrl(cid: string): string {
  if (!cid) return "";
  if (cid.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${cid.slice(7)}`;
  }
  return cid;
}

export function getByteWarningColor(byteLen: number): string {
  if (byteLen > STORY_MAX_CHUNK_BYTES) return "text-red-600 dark:text-red-400 font-semibold";
  if (byteLen > STORY_WARNING_ORANGE_BYTES) {
    return "text-orange-600 dark:text-orange-400 font-medium";
  }
  if (byteLen > STORY_WARNING_YELLOW_BYTES) return "text-yellow-600 dark:text-yellow-500";
  return "text-gray-500 dark:text-gray-400";
}

export function isChunkFormDirty(formData: ChunkFormData): boolean {
  const trimmed = (formData.content || "").trim();
  return (
    trimmed.length > 0 || (formData.attachmentCID || "").length > 0 || formData.chunkType !== 0
  );
}

export function sortStoryChunks(chunks: StoryChunk[] | undefined): StoryChunk[] {
  return [...(chunks || [])].sort((a, b) => a.chunkIndex - b.chunkIndex);
}

export function buildNodeDetailsFromNft(data: any, tokenId: string | undefined): NodeData {
  const core = data.core;
  return {
    id: `${data.personHash}:${data.versionIndex}`,
    personHash: data.personHash,
    versionIndex: data.versionIndex,
    fullName: core?.fullName,
    gender: core?.gender,
    birthYear: core?.birthYear,
    birthMonth: core?.birthMonth,
    birthDay: core?.birthDay,
    birthPlace: core?.birthPlace,
    deathYear: core?.deathYear,
    deathMonth: core?.deathMonth,
    deathDay: core?.deathDay,
    deathPlace: core?.deathPlace,
    tokenId,
  } as NodeData;
}

export function getValidTokenId(tokenId: string | undefined): string | undefined {
  return tokenId && /^\d+$/.test(tokenId) ? tokenId : undefined;
}

export function mapStorySubmitError(error: any, t: (key: string, fallback: string) => string): string {
  const errorType = error?.type || error?.code;
  let message =
    error instanceof Error ? error.message : t("storyChunkEditor.operationFailed", "Operation failed");

  if (errorType === "USER_REJECTED") {
    message = t("storyChunkEditor.errors.userRejected", "Transaction was rejected by user");
  } else if (errorType === "WALLET_POPUP_TIMEOUT") {
    message = t(
      "storyChunkEditor.errors.walletTimeout",
      "Wallet confirmation timed out. Please reopen your wallet and confirm in Fluent.",
    );
  } else if (errorType === "WALLET_REQUEST_PENDING") {
    message = t(
      "storyChunkEditor.errors.walletPending",
      "Wallet has a pending request. Open your wallet to confirm or cancel it, then try again.",
    );
  }

  return message;
}

export function mapStorySealError(error: any, t: (key: string, fallback: string) => string): string {
  const errorMessage = error?.message || String(error);
  const errorType = error?.type || error?.code;

  if (errorMessage.toLowerCase().includes("no wallet connected") || errorType === "NO_WALLET") {
    return t(
      "storyChunkEditor.errors.noWallet",
      "No wallet connected. Please connect your wallet first.",
    );
  }
  if (errorType === "USER_REJECTED") {
    return t("storyChunkEditor.errors.userRejected", "Transaction was rejected by user");
  }
  if (errorType === "WALLET_POPUP_TIMEOUT") {
    return t(
      "storyChunkEditor.errors.walletTimeout",
      "Wallet confirmation timed out. Please reopen your wallet and confirm.",
    );
  }
  if (errorType === "WALLET_REQUEST_PENDING") {
    return t(
      "storyChunkEditor.errors.walletPending",
      "Wallet has a pending request. Open your wallet to confirm or cancel it, then try again.",
    );
  }

  return error instanceof Error ? error.message : t("storyChunkEditor.sealFailed", "Seal failed");
}

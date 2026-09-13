import { ethers } from "ethers";
import { encodePublicStoryRecord } from "../../../shared/config/storyEncoding";
import { getFriendlyErrorMessage } from "../../../shared/lib/errors";
import type { NodeData, StoryRecord, StoryMetadata } from "../../../shared/model";
import { formatHashMiddle } from "../../../shared/model";

export interface PrefetchedStoryState {
  prefetchedStory?: {
    tokenId: string;
    fullName?: string;
    storyMetadata?: StoryMetadata;
    storyRecords?: StoryRecord[];
  };
}

export interface RecordFormData {
  title: string;
  content: string;
  expectedPayloadHash?: string;
  recordType: number;
  attachmentCID: string;
}

export const STORY_SEGMENT_BYTES = 16_384;
export const STORY_WARNING_ORANGE_BYTES = STORY_SEGMENT_BYTES - 200;
export const STORY_WARNING_YELLOW_BYTES = STORY_SEGMENT_BYTES - 400;
export const STORY_MAX_ATTACHMENT_BYTES = 256;

export const initialRecordFormData: RecordFormData = {
  title: "",
  content: "",
  recordType: 1,
  attachmentCID: "",
  expectedPayloadHash: undefined,
};

export function convertRecordTypeToNumber(type: number | string | null | undefined): number {
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

export function normalizeStoryRecords(
  records: StoryRecord[] | undefined,
): StoryRecord[] | undefined {
  return records?.map((record) => ({
    ...record,
    recordType: convertRecordTypeToNumber(record.recordType),
    attachmentCID: record.attachmentCID ?? "",
  }));
}

export function computeStoryPayloadHash(
  content: string,
  recordType = 1,
  attachmentCID = "",
  title = "",
): string {
  return ethers.keccak256(encodePublicStoryRecord({ title, content, recordType, attachmentCID }));
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
  if (byteLen > STORY_SEGMENT_BYTES) return "text-orange-600 dark:text-orange-400 font-medium";
  if (byteLen > STORY_WARNING_ORANGE_BYTES) {
    return "text-orange-600 dark:text-orange-400 font-medium";
  }
  if (byteLen > STORY_WARNING_YELLOW_BYTES) return "text-yellow-600 dark:text-yellow-500";
  return "text-gray-500 dark:text-gray-400";
}

export function isRecordFormDirty(formData: RecordFormData): boolean {
  const trimmed = (formData.content || "").trim();
  return (
    formData.title.length > 0 ||
    trimmed.length > 0 ||
    (formData.attachmentCID || "").length > 0 ||
    formData.recordType !== 1
  );
}

export function sortStoryRecords(records: StoryRecord[] | undefined): StoryRecord[] {
  return [...(records || [])].sort((a, b) => a.recordIndex - b.recordIndex);
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

export function mapStorySubmitError(
  error: any,
  t: (key: string, fallback: string) => string,
): string {
  return getFriendlyErrorMessage(
    error,
    t as any,
    t("storyRecordEditor.operationFailed", "Operation failed"),
    { preferDetailsForUnknown: true },
  );
}

export function mapStorySealError(
  error: any,
  t: (key: string, fallback: string) => string,
): string {
  return getFriendlyErrorMessage(
    error,
    t as any,
    t("storyRecordEditor.sealFailed", "Seal failed"),
    {
      preferDetailsForUnknown: true,
    },
  );
}

/**
 * Tone of the composer's byte meter. The editor used to surface the byte budget
 * as one coloured line of text; the meter needs the same thresholds as a value
 * it can style a track with.
 */
export type ByteMeterTone = "normal" | "warn" | "over";

export function getByteMeterTone(byteLen: number): ByteMeterTone {
  if (byteLen > STORY_SEGMENT_BYTES) return "over";
  if (byteLen > STORY_WARNING_YELLOW_BYTES) return "warn";
  return "normal";
}

/** Fill fraction (0–1) of the byte meter track. */
export function getByteMeterRatio(byteLen: number): number {
  if (STORY_SEGMENT_BYTES <= 0) return 0;
  return Math.max(0, Math.min(1, byteLen / STORY_SEGMENT_BYTES));
}

import {
  buildStorySnapshot,
  getStoryPresentation,
  type NodeData,
  type StoryRecord,
  type StoryMetadata,
} from "../../../shared/model";
import { getFriendlyErrorMessage, resolveErrorReason } from "../../../shared/lib/errors";

export type PersonStoryViewMode = "sections" | "paragraph" | "raw";
export type PersonSectionKey = string | number;

export interface PersonStoryIntegrity {
  missing: number[];
  lengthMatch: boolean;
  hashMatch: boolean | null;
  computedLength: number;
  computedHash?: string;
}

export interface StoryDetailData {
  tokenId: string;
  personHash?: string;
  versionIndex?: number;
  fullName?: string;
  storyMetadata?: StoryMetadata;
  storyRecords?: StoryRecord[];
  fullStory?: string;
  owner?: string;
  nftCoreInfo?: {
    gender?: number;
    birthYear?: number;
    birthMonth?: number;
    birthDay?: number;
    birthPlace?: string;
    isBirthBC?: boolean;
    deathYear?: number;
    deathMonth?: number;
    deathDay?: number;
    deathPlace?: string;
    isDeathBC?: boolean;
    storyTitle?: string;
    story?: string;
  };
  integrity?: PersonStoryIntegrity;
}

export interface PrefetchedStoryDetailState {
  prefetchedStory?: Partial<StoryDetailData>;
}

export interface GroupedStoryRecords {
  type: number;
  records: StoryRecord[];
}

export interface RecordTypeOption {
  value: number;
  label: string;
}

export interface CachedStoryDetail {
  metadata?: StoryMetadata;
  records?: StoryRecord[];
  fullStory?: string;
  integrity?: PersonStoryIntegrity;
}

type Translate = (key: string, fallback?: string) => string;

export function isValidPersonTokenId(tokenId: string | undefined): tokenId is string {
  return Boolean(tokenId && /^\d+$/.test(tokenId));
}

export function normalizeRecordType(type: number | string | null | undefined): number {
  if (type === null || type === undefined || type === "") return 0;
  if (typeof type === "number" && Number.isFinite(type)) return type;
  if (typeof type === "string") {
    const trimmed = type.trim();
    if (!trimmed) return 0;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number(type);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeStoryRecord(record: StoryRecord): StoryRecord {
  return {
    ...record,
    recordType: normalizeRecordType(record.recordType),
    attachmentURI: record.attachmentURI ?? "",
  };
}

export function getRecordTypeLabel(
  type: number | string | null | undefined,
  options: RecordTypeOption[],
  fallback: string,
): string {
  const numericType = normalizeRecordType(type);
  const match = options.find((option) => option.value === numericType);
  return match ? match.label : fallback;
}

export function buildPrefetchedStoryDetailData(
  tokenId: string,
  prefetched: Partial<StoryDetailData> | undefined,
): StoryDetailData | null {
  if (!prefetched) return null;
  if (prefetched.tokenId && String(prefetched.tokenId) !== String(tokenId)) return null;

  const storyRecords = prefetched.storyRecords?.map(normalizeStoryRecord);
  const presentation = getStoryPresentation(storyRecords, prefetched.storyMetadata);
  const initialFullStory = storyRecords ? presentation.fullStory : prefetched.fullStory;

  return {
    tokenId,
    personHash: prefetched.personHash,
    versionIndex: prefetched.versionIndex,
    fullName: prefetched.fullName,
    owner: prefetched.owner,
    nftCoreInfo:
      presentation.biography && !presentation.biography.unsupportedSchema
        ? {
            ...prefetched.nftCoreInfo,
            story: presentation.biography.content,
            storyTitle: presentation.biography.title,
          }
        : prefetched.nftCoreInfo,
    storyMetadata: prefetched.storyMetadata,
    storyRecords,
    fullStory: initialFullStory,
    integrity: prefetched.integrity,
  };
}

export function getFullStoryParagraphs(
  fullStory: string | undefined,
  viewMode: PersonStoryViewMode,
): string[] {
  if (!fullStory || viewMode === "raw") return [];
  const raw = fullStory.replace(/\r\n/g, "\n").trim();
  let parts = raw
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    const sentencePieces = raw
      .split(/(?<=[。．\.?!！？])\s+(?=\S)/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    if (sentencePieces.length > 1) {
      const grouped: string[] = [];
      let buffer = "";
      for (const sentence of sentencePieces) {
        if (buffer && (buffer + " " + sentence).length > 240) {
          grouped.push(buffer.trim());
          buffer = sentence;
        } else {
          buffer = buffer ? buffer + " " + sentence : sentence;
        }
      }
      if (buffer) grouped.push(buffer.trim());
      parts = grouped;
    }
  }

  if (parts.length <= 1) {
    const lineSplit = raw
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lineSplit.length > 1 && lineSplit.length < 50) {
      parts = lineSplit;
    }
  }

  return parts;
}

export function getRecordParagraphs(records: StoryRecord[] | undefined): string[] {
  if (!records || records.length === 0) return [];
  return getStoryPresentation(records).records.map((record) => record.content);
}

export function groupStoryRecords(records: StoryRecord[] | undefined): GroupedStoryRecords[] {
  if (!records || records.length === 0) return [];

  const groups = new Map<number, StoryRecord[]>();
  getStoryPresentation(records).records.forEach((record) => {
    const type = normalizeRecordType(record.recordType);
    if (!groups.has(type)) {
      groups.set(type, []);
    }
    groups.get(type)!.push({ ...record, recordType: type });
  });

  return Array.from(groups.entries())
    .sort(([typeA], [typeB]) => typeA - typeB)
    .map(([type, groupedRecords]) => ({
      type,
      records: [...groupedRecords].sort((a, b) => a.recordIndex - b.recordIndex),
    }));
}

export function hasStoryIntegrityIssues(data: StoryDetailData | null | undefined): boolean {
  if (!data?.integrity || !data.storyMetadata || data.storyMetadata.totalRecords <= 0) return false;
  return (
    data.integrity.missing.length > 0 ||
    !data.integrity.lengthMatch ||
    data.integrity.hashMatch === false
  );
}

export function getFreshCachedStoryDetail(
  node: NodeData | null | undefined,
  now = Date.now(),
): CachedStoryDetail | null {
  if (!node?.storyMetadata || !Array.isArray(node.storyRecords)) return null;
  const fetchedAt = Number(node.storyFetchedAt || 0);
  const isSealed = Boolean(node.storyMetadata?.isSealed);
  const ttl = isSealed ? 7 * 24 * 60 * 60 * 1000 : 2 * 60 * 1000;
  const expired = !fetchedAt || now - fetchedAt > ttl;
  if (expired) return null;

  const { fullStory, integrity } = buildStorySnapshot(node.storyRecords, node.storyMetadata);
  return {
    metadata: node.storyMetadata,
    records: node.storyRecords,
    fullStory,
    integrity,
  };
}

export function buildNftCoreInfo(
  node: NodeData | null | undefined,
): StoryDetailData["nftCoreInfo"] {
  if (!node) return undefined;
  return {
    gender: node.gender,
    birthYear: node.birthYear,
    birthMonth: node.birthMonth,
    birthDay: node.birthDay,
    birthPlace: node.birthPlace,
    isBirthBC: node.isBirthBC,
    deathYear: node.deathYear,
    deathMonth: node.deathMonth,
    deathDay: node.deathDay,
    deathPlace: node.deathPlace,
    isDeathBC: node.isDeathBC,
    story: node.nftPublicStory || "",
    storyTitle: node.nftPublicStoryTitle || "",
  };
}

export function buildStoryDetailData(options: {
  tokenId: string;
  node: NodeData | null | undefined;
  story: CachedStoryDetail | null | undefined;
  owner?: string;
}): StoryDetailData {
  const { tokenId, node, story, owner } = options;
  const presentation = getStoryPresentation(story?.records, story?.metadata);
  const coreInfo = buildNftCoreInfo(node);
  return {
    tokenId,
    personHash: node?.personHash,
    versionIndex: node?.versionIndex,
    fullName: node?.fullName,
    nftCoreInfo:
      presentation.biography && !presentation.biography.unsupportedSchema
        ? {
            ...coreInfo,
            story: presentation.biography.content,
            storyTitle: presentation.biography.title,
          }
        : coreInfo,
    storyMetadata: story?.metadata,
    storyRecords: story?.records,
    fullStory: story?.records ? presentation.fullStory : story?.fullStory,
    owner,
    integrity: story?.integrity,
  };
}

export function mapPersonStoryFetchError(error: unknown, t: Translate): string {
  const reason = resolveErrorReason(error);
  if (reason === "InvalidTokenId") {
    return t("person.invalidTokenId", "Invalid token ID");
  }
  if (reason === "ERC721NonexistentToken") {
    return t("person.nonexistentToken", "Token does not exist");
  }
  return getFriendlyErrorMessage(error, t as any, t("person.fetchFailed", "Failed to load token"), {
    preferDetailsForUnknown: false,
  });
}

import type { NodeData, StoryChunk, StoryMetadata } from "../../../shared/model";
import { buildStorySnapshot } from "../../../domains/person";

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
  storyChunks?: StoryChunk[];
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
    story?: string;
  };
  integrity?: PersonStoryIntegrity;
}

export interface PrefetchedStoryDetailState {
  prefetchedStory?: Partial<StoryDetailData>;
}

export interface GroupedStoryChunks {
  type: number;
  chunks: StoryChunk[];
}

export interface ChunkTypeOption {
  value: number;
  label: string;
}

export interface CachedStoryDetail {
  metadata?: StoryMetadata;
  chunks?: StoryChunk[];
  fullStory?: string;
  integrity?: PersonStoryIntegrity;
}

type Translate = (key: string, fallback?: string) => string;

export function isValidPersonTokenId(tokenId: string | undefined): tokenId is string {
  return Boolean(tokenId && /^\d+$/.test(tokenId));
}

export function normalizeChunkType(type: number | string | null | undefined): number {
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

export function normalizeStoryChunk(chunk: StoryChunk): StoryChunk {
  return {
    ...chunk,
    chunkType: normalizeChunkType(chunk.chunkType),
    attachmentCID: chunk.attachmentCID ?? "",
  };
}

export function getChunkTypeLabel(
  type: number | string | null | undefined,
  options: ChunkTypeOption[],
  fallback: string,
): string {
  const numericType = normalizeChunkType(type);
  const match = options.find((option) => option.value === numericType);
  return match ? match.label : fallback;
}

export function buildPrefetchedStoryDetailData(
  tokenId: string,
  prefetched: Partial<StoryDetailData> | undefined,
): StoryDetailData | null {
  if (!prefetched) return null;
  if (prefetched.tokenId && String(prefetched.tokenId) !== String(tokenId)) return null;

  const storyChunks = prefetched.storyChunks?.map(normalizeStoryChunk);
  const initialFullStory =
    prefetched.fullStory ||
    (storyChunks && storyChunks.length > 0 ? storyChunks.map((chunk) => chunk.content).join("") : undefined);

  return {
    tokenId,
    personHash: prefetched.personHash,
    versionIndex: prefetched.versionIndex,
    fullName: prefetched.fullName,
    owner: prefetched.owner,
    nftCoreInfo: prefetched.nftCoreInfo,
    storyMetadata: prefetched.storyMetadata,
    storyChunks,
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

export function getChunkParagraphs(chunks: StoryChunk[] | undefined): string[] {
  if (!chunks || chunks.length === 0) return [];
  return [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex).map((chunk) => chunk.content);
}

export function groupStoryChunks(chunks: StoryChunk[] | undefined): GroupedStoryChunks[] {
  if (!chunks || chunks.length === 0) return [];

  const groups = new Map<number, StoryChunk[]>();
  chunks.forEach((chunk) => {
    const type = normalizeChunkType(chunk.chunkType);
    if (!groups.has(type)) {
      groups.set(type, []);
    }
    groups.get(type)!.push({ ...chunk, chunkType: type });
  });

  return Array.from(groups.entries())
    .sort(([typeA], [typeB]) => typeA - typeB)
    .map(([type, groupedChunks]) => ({
      type,
      chunks: [...groupedChunks].sort((a, b) => a.chunkIndex - b.chunkIndex),
    }));
}

export function hasStoryIntegrityIssues(data: StoryDetailData | null | undefined): boolean {
  if (!data?.integrity || !data.storyMetadata || data.storyMetadata.totalChunks <= 0) return false;
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
  if (!node?.storyMetadata || !Array.isArray(node.storyChunks)) return null;
  const fetchedAt = Number(node.storyFetchedAt || 0);
  const isSealed = Boolean(node.storyMetadata?.isSealed);
  const ttl = isSealed ? 7 * 24 * 60 * 60 * 1000 : 2 * 60 * 1000;
  const expired = !fetchedAt || now - fetchedAt > ttl;
  if (expired) return null;

  const { fullStory, integrity } = buildStorySnapshot(node.storyChunks, node.storyMetadata);
  return {
    metadata: node.storyMetadata,
    chunks: node.storyChunks,
    fullStory,
    integrity,
  };
}

export function buildNftCoreInfo(node: NodeData | null | undefined): StoryDetailData["nftCoreInfo"] {
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
    story: node.story || "",
  };
}

export function buildStoryDetailData(options: {
  tokenId: string;
  node: NodeData | null | undefined;
  story: CachedStoryDetail | null | undefined;
  owner?: string;
}): StoryDetailData {
  const { tokenId, node, story, owner } = options;
  return {
    tokenId,
    personHash: node?.personHash,
    versionIndex: node?.versionIndex,
    fullName: node?.fullName,
    nftCoreInfo: buildNftCoreInfo(node),
    storyMetadata: story?.metadata,
    storyChunks: story?.chunks,
    fullStory: story?.fullStory,
    owner,
    integrity: story?.integrity,
  };
}

export function mapPersonStoryFetchError(error: unknown, t: Translate): string {
  const raw =
    error && typeof error === "object"
      ? ((error as { message?: string; shortMessage?: string }).message ||
          (error as { shortMessage?: string }).shortMessage ||
          "")
      : "";
  const full = error && typeof error === "object" ? JSON.stringify(error) : "";
  const lower = (raw + full).toLowerCase();

  if (lower.includes("invalidtokenid") || lower.includes("invalid token id")) {
    return t("person.invalidTokenId", "Invalid token ID");
  }
  if (
    lower.includes("nonexistent token") ||
    lower.includes("query for nonexistent token") ||
    lower.includes("token does not exist")
  ) {
    return t("person.nonexistentToken", "Token does not exist");
  }
  if (lower.includes("execution reverted")) {
    return t("person.fetchFailed", "Failed to load token");
  }
  return raw || "Failed to fetch story data";
}

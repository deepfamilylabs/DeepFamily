import type { TFunction } from "i18next";

export type SearchPageT = TFunction;

export const MAX_SEARCH_PAGE_SIZE = 100;

export type SearchSectionKey =
  | "hash"
  | "versions"
  | "trustedEndorsers"
  | "endorsement"
  | "children"
  | "storyChunks"
  | "uri";

export type SearchOpenSections = Record<SearchSectionKey, boolean>;

export const initialSearchOpenSections: SearchOpenSections = {
  hash: true,
  versions: false,
  trustedEndorsers: false,
  endorsement: false,
  children: false,
  storyChunks: false,
  uri: false,
};

export type EndorsementStatsForm = {
  personHash: string;
  pageSize: number;
};

export type TokenURIHistoryForm = {
  tokenId: number;
  pageSize: number;
};

export type PersonVersionsForm = {
  personHash: string;
  pageSize: number;
};

export type TrustedEndorsersForm = {
  personHash: string;
  versionIndex: number;
  pageSize: number;
};

export type StoryChunksForm = {
  tokenId: number;
  pageSize: number;
};

export type ChildrenForm = {
  parentHash: string;
  parentVersionIndex: number;
  pageSize: number;
};

export type EndorsementStatsData = {
  versionIndices: number[];
  endorsementCounts: number[];
  tokenIds: number[];
};

export type ChildrenPageData = {
  childHashes: string[];
  childVersions: number[];
};

export type TrustedEndorsersPageData = {
  accounts: string[];
};

export const emptyEndorsementStatsData: EndorsementStatsData = {
  versionIndices: [],
  endorsementCounts: [],
  tokenIds: [],
};

export const emptyChildrenPageData: ChildrenPageData = {
  childHashes: [],
  childVersions: [],
};

export const emptyTrustedEndorsersPageData: TrustedEndorsersPageData = {
  accounts: [],
};

export function sanitizeNumberInput(value: unknown) {
  if (value === "" || value === null || value === undefined) return undefined;
  const num = Number(value);
  return Number.isNaN(num) ? undefined : num;
}

export function formatNumericError(message: unknown, fallback: string) {
  if (!message) return undefined;
  const text = typeof message === "string" ? message : String(message);
  return /expected number/i.test(text) || /required/i.test(text) ? fallback : text;
}

export function getPreviousPageOffset(offset: number, pageSize: number): number {
  return Math.max(0, offset - pageSize * 2);
}

export function getWatchedNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

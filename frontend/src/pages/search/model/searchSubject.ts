/**
 * Unified search subject model.
 *
 * The search page resolves ONE subject from a single query box and then hangs
 * every facet (versions, endorsers, children, story chunks, ...) off it, so a
 * person hash is pasted once instead of once per query section.
 */

export type SearchSubject =
  | { kind: "empty" }
  | { kind: "personHash"; personHash: string }
  | { kind: "tokenId"; tokenId: number }
  | { kind: "address"; address: string }
  | { kind: "invalid"; reason: "hexLength"; hexLength: number }
  | { kind: "invalid"; reason: "unrecognized" };

export type SearchSubjectKind = SearchSubject["kind"];

/** A resolved subject is one the page can actually query against. */
export type ResolvedSearchSubject =
  | { kind: "personHash"; personHash: string }
  | { kind: "tokenId"; tokenId: number }
  | { kind: "address"; address: string };

const HEX_BODY = /^[0-9a-fA-F]*$/;
const DIGITS = /^[0-9]+$/;

/**
 * Classify raw query-box text. Detection is deliberately shape-based (length of
 * the hex body, or all-digits) because the chain gives us nothing to probe
 * against before a query is actually issued.
 */
export function detectSearchSubject(raw: string): SearchSubject {
  const value = (raw ?? "").trim();
  if (!value) return { kind: "empty" };

  if (DIGITS.test(value)) {
    const tokenId = Number(value);
    if (Number.isSafeInteger(tokenId) && tokenId >= 1) return { kind: "tokenId", tokenId };
    return { kind: "invalid", reason: "unrecognized" };
  }

  if (value.startsWith("0x") || value.startsWith("0X")) {
    const body = value.slice(2);
    if (!HEX_BODY.test(body)) return { kind: "invalid", reason: "unrecognized" };
    if (body.length === 64) return { kind: "personHash", personHash: `0x${body.toLowerCase()}` };
    if (body.length === 40) return { kind: "address", address: `0x${body.toLowerCase()}` };
    return { kind: "invalid", reason: "hexLength", hexLength: body.length };
  }

  return { kind: "invalid", reason: "unrecognized" };
}

/** Everything except malformed input resolves to something queryable. */
export function toResolvedSubject(subject: SearchSubject): ResolvedSearchSubject | null {
  if (subject.kind === "personHash") return { kind: "personHash", personHash: subject.personHash };
  if (subject.kind === "tokenId") return { kind: "tokenId", tokenId: subject.tokenId };
  if (subject.kind === "address") return { kind: "address", address: subject.address };
  return null;
}

export type SearchFacetKey =
  | "versions"
  | "trustedEndorsers"
  | "endorsement"
  | "children"
  | "personNfts"
  | "storyChunks"
  | "uri"
  | "accountVersions"
  | "accountEndorsements"
  | "accountNfts";

/**
 * Scope a facet needs beyond the subject itself:
 * - `person`        person hash alone
 * - `personVersion` person hash + a version index
 * - `token`         an NFT token id
 * - `account`       a wallet address
 */
export type SearchFacetScope = "person" | "personVersion" | "token" | "account";

export type SearchFacetDescriptor = {
  key: SearchFacetKey;
  scope: SearchFacetScope;
  /** trustedEndorsers is 1-based on chain; children accepts 0. */
  minVersionIndex: number;
};

export const SEARCH_FACETS: readonly SearchFacetDescriptor[] = [
  { key: "versions", scope: "person", minVersionIndex: 0 },
  { key: "trustedEndorsers", scope: "personVersion", minVersionIndex: 1 },
  { key: "endorsement", scope: "person", minVersionIndex: 0 },
  { key: "children", scope: "personVersion", minVersionIndex: 0 },
  { key: "personNfts", scope: "person", minVersionIndex: 0 },
  { key: "storyChunks", scope: "token", minVersionIndex: 0 },
  { key: "uri", scope: "token", minVersionIndex: 0 },
  { key: "accountVersions", scope: "account", minVersionIndex: 0 },
  { key: "accountEndorsements", scope: "account", minVersionIndex: 0 },
  { key: "accountNfts", scope: "account", minVersionIndex: 0 },
] as const;

export function getFacetDescriptor(key: SearchFacetKey): SearchFacetDescriptor {
  const found = SEARCH_FACETS.find((facet) => facet.key === key);
  if (!found) throw new Error(`Unknown search facet: ${key}`);
  return found;
}

/** Facets reachable from a subject: a token id can't answer person questions. */
export function getFacetsForSubject(
  subject: ResolvedSearchSubject | null,
): readonly SearchFacetDescriptor[] {
  if (!subject) return [];
  if (subject.kind === "tokenId") return SEARCH_FACETS.filter((facet) => facet.scope === "token");
  if (subject.kind === "address") return SEARCH_FACETS.filter((facet) => facet.scope === "account");
  return SEARCH_FACETS.filter((facet) => facet.scope !== "account");
}

export function getDefaultFacet(subject: ResolvedSearchSubject): SearchFacetKey {
  if (subject.kind === "tokenId") return "storyChunks";
  if (subject.kind === "address") return "accountVersions";
  return "versions";
}

/** Whether the current scope satisfies the facet, i.e. the query can be issued. */
export function isFacetRunnable(
  facet: SearchFacetDescriptor,
  subject: ResolvedSearchSubject | null,
  versionIndex: number | undefined,
  tokenId: number | undefined,
): boolean {
  if (!subject) return false;
  if (facet.scope === "account") return subject.kind === "address";
  if (facet.scope === "token") return tokenId !== undefined && Number.isFinite(tokenId);
  if (subject.kind !== "personHash") return false;
  if (facet.scope === "person") return true;
  return (
    versionIndex !== undefined &&
    Number.isFinite(versionIndex) &&
    versionIndex >= facet.minVersionIndex
  );
}

const RECENT_KEY = "deepfamily.search.recent";
const RECENT_LIMIT = 6;

export function readRecentQueries(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string").slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function writeRecentQueries(entries: string[]): void {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(entries.slice(0, RECENT_LIMIT)));
  } catch {
    /* private mode / blocked storage: recents are a convenience, never required */
  }
}

export function pushRecentQuery(entries: string[], value: string): string[] {
  const next = [value, ...entries.filter((entry) => entry !== value)].slice(0, RECENT_LIMIT);
  writeRecentQueries(next);
  return next;
}

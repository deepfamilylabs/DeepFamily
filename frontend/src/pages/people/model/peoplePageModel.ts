import type { TFunction } from "i18next";
import {
  compareBirthOrderKey,
  getBirthOrderKey,
  isMinted,
  type NodeData,
} from "../../../shared/model";

export type PeoplePageT = TFunction;
export type PeopleFilterType =
  | "all"
  | "by_create_time"
  | "by_name"
  | "by_endorsement"
  | "by_generation"
  | "by_birth_date";
export type PeopleSortOrder = "asc" | "desc";
export type PeopleViewMode = "grid" | "list";

export const PEOPLE_PAGE_SIZE = 12;

export interface ProjectedGraphNode {
  id: string;
  /** BFS depth in the current projection; the root sits at 0. Absent on nodes the walk never sized. */
  depth?: number;
}

/** One generation of the projection, with the number of listed people it holds. */
export interface GenerationOption {
  generation: number;
  count: number;
}

export interface PeopleFiltersState {
  searchTerm: string;
  filterType: PeopleFilterType;
  sortOrder: PeopleSortOrder;
  selectedAddresses: string[];
  selectedGenerations: number[];
}

/** node id -> generation number (1-based), the number the genealogy book prints. */
export type GenerationIndex = Map<string, number>;

export interface ProjectedPeopleLookup {
  byId: Map<string, NodeData>;
  byTokenId: Map<string, NodeData>;
  byHash: Map<string, NodeData>;
}

export interface PeoplePageStats {
  totalCount: number;
  totalNFTs: number;
  storyCount: number;
}

export function selectProjectedMintedPeople(
  graphNodes: ProjectedGraphNode[],
  nodesData: Record<string, NodeData>,
): NodeData[] {
  return graphNodes
    .map((node) => nodesData[node.id])
    .filter((person): person is NodeData => !!person && isMinted(person));
}

export function createProjectedPeopleLookup(people: NodeData[]): ProjectedPeopleLookup {
  const byId = new Map<string, NodeData>();
  const byTokenId = new Map<string, NodeData>();
  const byHash = new Map<string, NodeData>();

  for (const person of people) {
    byId.set(String(person.id), person);
    if (person.tokenId) byTokenId.set(String(person.tokenId), person);
    if (person.personHash) byHash.set(String(person.personHash).toLowerCase(), person);
  }

  return { byId, byTokenId, byHash };
}

export function resolveProjectedPerson(
  query: string,
  lookup: ProjectedPeopleLookup,
): NodeData | null {
  const normalized = query.trim();
  const isHexHash = /^0x[a-fA-F0-9]{64}$/.test(normalized);

  return (
    lookup.byId.get(normalized) ||
    (isHexHash ? lookup.byHash.get(normalized.toLowerCase()) : null) ||
    lookup.byTokenId.get(normalized) ||
    null
  );
}

export function getPeoplePageStats(params: {
  graphNodes: ProjectedGraphNode[];
  nodesData: Record<string, NodeData>;
  people: NodeData[];
}): PeoplePageStats {
  const totalNFTs = params.graphNodes.reduce((acc, node) => {
    const data = params.nodesData[node.id];
    return isMinted(data) ? acc + 1 : acc;
  }, 0);

  const uniquePeople = new Set<string>();
  for (const node of params.graphNodes) {
    const data = params.nodesData[node.id];
    if (!isMinted(data)) continue;
    uniquePeople.add(String(data.personHash || "").toLowerCase());
  }

  const storyCount = params.people.filter(
    (person) => person.storyMetadata && person.storyMetadata.totalChunks > 0,
  ).length;

  return {
    totalCount: uniquePeople.size,
    totalNFTs,
    storyCount,
  };
}

/**
 * Generation numbers come straight off the projection: the view graph walks the
 * tree breadth-first and stamps a depth on every node, so generation = depth + 1
 * — the same number the genealogy book prints. A node reachable by several paths
 * keeps the shallowest one.
 */
export function buildGenerationIndex(graphNodes: ProjectedGraphNode[]): GenerationIndex {
  const index: GenerationIndex = new Map();

  for (const node of graphNodes) {
    if (typeof node.depth !== "number" || !Number.isFinite(node.depth)) continue;
    const generation = Math.trunc(node.depth) + 1;
    if (generation < 1) continue;
    const current = index.get(node.id);
    if (current === undefined || generation < current) index.set(node.id, generation);
  }

  return index;
}

export function getPersonGeneration(
  person: NodeData,
  generations: GenerationIndex,
): number | undefined {
  return generations.get(String(person.id));
}

/** Ascending generations that actually hold listed people, with their head counts. */
export function getGenerationOptions(
  people: NodeData[],
  generations: GenerationIndex,
): GenerationOption[] {
  const counts = new Map<number, number>();

  for (const person of people) {
    const generation = getPersonGeneration(person, generations);
    if (generation === undefined) continue;
    counts.set(generation, (counts.get(generation) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([generation, count]) => ({ generation, count }));
}

/** Inclusive run between two picked generations, so a drag reads as a range. */
export function generationRange(from: number, to: number): number[] {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const range: number[] = [];
  for (let generation = start; generation <= end; generation++) range.push(generation);
  return range;
}

export function toggleGenerationSelection(selected: number[], generation: number): number[] {
  return selected.includes(generation)
    ? selected.filter((value) => value !== generation)
    : [...selected, generation].sort((a, b) => a - b);
}

/** A contiguous run of two or more generations is labelled "3 – 6" rather than counted. */
export function isContiguousGenerationRun(selected: number[]): boolean {
  if (selected.length < 2) return false;
  const sorted = [...selected].sort((a, b) => a - b);
  return sorted.every((generation, index) => index === 0 || generation === sorted[index - 1] + 1);
}

export function hasVisiblePeopleFilters(filters: PeopleFiltersState): boolean {
  return (
    filters.selectedAddresses.length > 0 ||
    filters.selectedGenerations.length > 0 ||
    Boolean(filters.searchTerm)
  );
}

export function hasPeopleRuleFilters(filters: PeopleFiltersState): boolean {
  return filters.selectedAddresses.length > 0 || filters.selectedGenerations.length > 0;
}

/**
 * Tiebreak for the sorts whose key repeats a lot: elder first, then mint order so
 * the result is fully determined instead of falling back to load order. Most
 * people carry 0 or 1 endorsement and every generation holds many people, so this
 * is what actually orders most of the list. It deliberately does NOT follow the
 * sort direction — asking for "most endorsed first" should not also turn the
 * people tied at zero upside down.
 */
function compareBirthThenToken(a: NodeData, b: NodeData): number {
  const keyA = getBirthOrderKey(a);
  const keyB = getBirthOrderKey(b);
  if (keyA && keyB) {
    const byBirth = compareBirthOrderKey(keyA, keyB);
    if (byBirth !== 0) return byBirth;
  } else if (keyA || keyB) {
    return keyA ? -1 : 1;
  }
  return parseInt(a.tokenId || "0", 10) - parseInt(b.tokenId || "0", 10);
}

function matchesText(value: string | undefined, term: string): boolean {
  return value?.toLowerCase().includes(term) ?? false;
}

export interface PeopleFilterContext {
  generations?: GenerationIndex;
  /** Collator built from the active UI language; names sort by that language's rules. */
  collator?: Intl.Collator;
}

export function filterPeople(
  people: NodeData[],
  filters: PeopleFiltersState,
  context: PeopleFilterContext = {},
): NodeData[] {
  const { generations, collator } = context;
  let filtered = [...people];

  if (filters.searchTerm.trim()) {
    const term = filters.searchTerm.toLowerCase();
    filtered = filtered.filter(
      (person) =>
        matchesText(person.fullName, term) ||
        person.personHash.toLowerCase().includes(term) ||
        matchesText(person.birthPlace, term) ||
        matchesText(person.deathPlace, term) ||
        matchesText(person.nftPublicStory, term) ||
        matchesText(person.addedBy, term),
    );
  }

  if (filters.selectedGenerations.length > 0 && generations) {
    const wanted = new Set(filters.selectedGenerations);
    filtered = filtered.filter((person) => {
      const generation = getPersonGeneration(person, generations);
      return generation !== undefined && wanted.has(generation);
    });
  }

  if (filters.selectedAddresses.length > 0) {
    filtered = filtered.filter((person) =>
      filters.selectedAddresses.some((address) =>
        person.addedBy?.toLowerCase().includes(address.toLowerCase()),
      ),
    );
  }

  switch (filters.filterType) {
    case "all":
      filtered = filtered.sort((a, b) => {
        const aTokenId = parseInt(a.tokenId || "0");
        const bTokenId = parseInt(b.tokenId || "0");
        return filters.sortOrder === "desc" ? bTokenId - aTokenId : aTokenId - bTokenId;
      });
      break;
    case "by_create_time":
      filtered = filtered.sort((a, b) => {
        const timeA = a.timestamp || 0;
        const timeB = b.timestamp || 0;
        const byTime = filters.sortOrder === "desc" ? timeB - timeA : timeA - timeB;
        return byTime || compareBirthThenToken(a, b);
      });
      break;
    case "by_name":
      // Bare localeCompare() collates in whatever locale the browser happens to
      // run in, so a Chinese register sorted by name came out in code-point order
      // (张 曹 白 阿 陈) for anyone whose browser was not Chinese. The collator is
      // built from the language the UI is actually in, so 阿 白 曹 陈 张 — pinyin
      // for Chinese, alphabetical for Latin. People with no name recorded sort
      // last either way.
      filtered = filtered.sort((a, b) => {
        const nameA = a.fullName?.trim() || "";
        const nameB = b.fullName?.trim() || "";
        if (!nameA || !nameB) return nameA ? -1 : nameB ? 1 : 0;
        const result = collator ? collator.compare(nameA, nameB) : nameA.localeCompare(nameB);
        return filters.sortOrder === "desc" ? -result : result;
      });
      break;
    case "by_endorsement":
      filtered = filtered.sort((a, b) => {
        const countA = a.endorsementCount || 0;
        const countB = b.endorsementCount || 0;
        const byCount = filters.sortOrder === "desc" ? countB - countA : countA - countB;
        return byCount || compareBirthThenToken(a, b);
      });
      break;
    case "by_generation":
      // Eldest generation first, and within a generation the elder person first —
      // the order a genealogy is written in. People the projection could not place
      // fall to the end whichever way the sort runs.
      filtered = filtered.sort((a, b) => {
        const genA = generations ? getPersonGeneration(a, generations) : undefined;
        const genB = generations ? getPersonGeneration(b, generations) : undefined;
        if (genA === undefined || genB === undefined) {
          return genA !== undefined ? -1 : genB !== undefined ? 1 : 0;
        }
        const byGeneration = filters.sortOrder === "desc" ? genB - genA : genA - genB;
        return byGeneration || compareBirthThenToken(a, b);
      });
      break;
    case "by_birth_date":
      // Year alone puts two siblings born in the same year in load order, so this
      // compares the whole date through the shared birth-order key: BC years count
      // backwards, and a missing month or day sorts at the start of what is known
      // (1868 before 1868-03). A record with no usable birth year cannot be placed
      // at all, so it stays at the end whichever way the sort runs.
      filtered = filtered.sort((a, b) => {
        const keyA = getBirthOrderKey(a);
        const keyB = getBirthOrderKey(b);
        if (!keyA || !keyB) {
          // One undated record goes last; two of them fall back to mint order.
          return keyA ? -1 : keyB ? 1 : compareBirthThenToken(a, b);
        }
        const byBirth = compareBirthOrderKey(keyA, keyB);
        return (filters.sortOrder === "desc" ? -byBirth : byBirth) || compareBirthThenToken(a, b);
      });
      break;
  }

  // A search term is matched against the biography text too, and a well-known
  // ancestor is named in dozens of other people's biographies (曹操 appears in 52
  // of the 138 seeded records), so searching a name used to bury that person in
  // the people who merely mention them. Name matches float to the top; the sort
  // is stable, so each group keeps the order the sort rule just gave it.
  const searchTerm = filters.searchTerm.trim().toLowerCase();
  if (searchTerm) {
    filtered = filtered.sort(
      (a, b) =>
        Number(!matchesText(a.fullName, searchTerm)) -
        Number(!matchesText(b.fullName, searchTerm)),
    );
  }

  return filtered;
}

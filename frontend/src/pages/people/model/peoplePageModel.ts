import type { TFunction } from "i18next";
import { isMinted, type NodeData } from "../../../shared/model";

export type PeoplePageT = TFunction;
export type PeopleFilterType =
  | "all"
  | "by_create_time"
  | "by_name"
  | "by_endorsement"
  | "by_birth_year";
export type PeopleSortOrder = "asc" | "desc";
export type PeopleViewMode = "grid" | "list";

export const PEOPLE_PAGE_SIZE = 12;

export interface ProjectedGraphNode {
  id: string;
}

export interface PeopleFiltersState {
  searchTerm: string;
  filterType: PeopleFilterType;
  sortOrder: PeopleSortOrder;
  selectedAddresses: string[];
}

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

export function hasVisiblePeopleFilters(filters: PeopleFiltersState): boolean {
  return filters.selectedAddresses.length > 0 || Boolean(filters.searchTerm);
}

export function hasPeopleRuleFilters(filters: PeopleFiltersState): boolean {
  return filters.selectedAddresses.length > 0;
}

function matchesText(value: string | undefined, term: string): boolean {
  return value?.toLowerCase().includes(term) ?? false;
}

export function filterPeople(people: NodeData[], filters: PeopleFiltersState): NodeData[] {
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
        return filters.sortOrder === "desc" ? timeB - timeA : timeA - timeB;
      });
      break;
    case "by_name":
      filtered = filtered.sort((a, b) => {
        const nameA = a.fullName || "";
        const nameB = b.fullName || "";
        const result = nameA.localeCompare(nameB);
        return filters.sortOrder === "desc" ? -result : result;
      });
      break;
    case "by_endorsement":
      filtered = filtered.sort((a, b) => {
        const countA = a.endorsementCount || 0;
        const countB = b.endorsementCount || 0;
        return filters.sortOrder === "desc" ? countB - countA : countA - countB;
      });
      break;
    case "by_birth_year":
      filtered = filtered.sort((a, b) => {
        const aYear = a.birthYear || 0;
        const bYear = b.birthYear || 0;
        if (aYear === 0 && bYear === 0) return 0;
        if (aYear === 0) return filters.sortOrder === "desc" ? -1 : 1;
        if (bYear === 0) return filters.sortOrder === "desc" ? 1 : -1;
        return filters.sortOrder === "desc" ? bYear - aYear : aYear - bYear;
      });
      break;
  }

  return filtered;
}

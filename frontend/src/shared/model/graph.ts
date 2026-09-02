export type NodeLabelInput = { personHash: string; versionIndex: number };

export interface StoryChunk {
  chunkIndex: number;
  chunkHash: string;
  content: string;
  timestamp: number;
  editor: string;
  chunkType: number;
  attachmentCID: string;
}

export interface StoryMetadata {
  totalChunks: number;
  fullStoryHash: string;
  lastUpdateTime: number;
  isSealed: boolean;
  totalLength: number;
}

export interface StoryChunkCreateData {
  tokenId: string;
  chunkIndex: number;
  content: string;
  expectedHash?: string;
  chunkType?: number;
  attachmentCID?: string;
}

export interface MetadataPersonDisplay {
  fullName: string;
  gender: number;
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  isBirthBC: boolean;
  personHash: string;
}

export interface MetadataParentDisplay extends MetadataPersonDisplay {
  versionIndex: string;
}

export interface MetadataParentsDisplay {
  father: MetadataParentDisplay | null;
  mother: MetadataParentDisplay | null;
}

export interface NodeData {
  personHash: string;
  versionIndex: number;
  id: string; // = makeNodeId
  tag?: string;
  biography?: string;
  fatherHash?: string;
  motherHash?: string;
  fatherVersionIndex?: number | string;
  motherVersionIndex?: number | string;
  addedBy?: string;
  timestamp?: number;
  versionCommitment?: string;
  metadataPointer?: string;
  metadataPayloadHash?: string;
  metadataPayloadLength?: number;
  metadataUnlockValidated?: boolean;
  metadataProtocolGeneration?: string;
  metadataFormatVersion?: number;
  identitySuiteId?: number;
  metadataPerson?: MetadataPersonDisplay;
  metadataParents?: MetadataParentsDisplay;
  endorsementCount?: number;
  tokenId?: string;
  versionDetailsFetchedAt?: number;
  owner?: string;
  fullName?: string; // coreInfo.fullName
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
  nftPublicStory?: string;
  nftTokenURI?: string;
  storyMetadata?: StoryMetadata;
  storyChunks?: StoryChunk[];
  storyFetchedAt?: number;
  totalVersions?: number; // Total number of versions for this personHash (from contract)
}

export type NodeDataPatch = Partial<Omit<NodeData, "personHash" | "versionIndex" | "id">>;

export type NodeId = string;

export function makeNodeId(personHash: string, versionIndex: number): NodeId {
  return `${personHash}-v-${versionIndex}`;
}

export function parseNodeId(id: NodeId): { personHash: string; versionIndex: number } {
  const idx = id.lastIndexOf("-v-");
  if (idx <= 0) return { personHash: id, versionIndex: 0 };
  const hash = id.slice(0, idx);
  const v = Number(id.slice(idx + 3));
  return { personHash: hash, versionIndex: Number.isFinite(v) ? v : 0 };
}

export function shortHash(hash: string, shown = 4): string {
  if (!hash) return "";
  const start = hash.startsWith("0x") ? 2 : 0;
  return `0x${hash.slice(start, start + shown)}…`;
}

export function nodeLabel(node: NodeLabelInput): string {
  return `${node.personHash}  v${node.versionIndex}`;
}

// Derived helpers
// Check if person has detailed story chunks (not just basic story field)
export function hasDetailedStory(nd: Partial<NodeData> | undefined | null): boolean {
  if (!nd) return false;
  // Only return true if there are actual story chunks, not just basic story field
  if (Array.isArray(nd.storyChunks) && nd.storyChunks.length > 0) return true;
  if (
    nd.storyMetadata &&
    typeof nd.storyMetadata.totalChunks === "number" &&
    nd.storyMetadata.totalChunks > 0
  )
    return true;
  return false;
}

export function isMinted(nd: Partial<NodeData> | undefined | null): boolean {
  if (!nd) return false;
  return !!(nd.tokenId && String(nd.tokenId) !== "0");
}

export function formatYMD(year?: number, month?: number, day?: number, isBC?: boolean): string {
  if (!year) return "";
  let s = isBC ? `BC ${year}` : String(year);
  if (month && month > 0) {
    s += `-${String(month).padStart(2, "0")}`;
    if (day && day > 0) s += `-${String(day).padStart(2, "0")}`;
  }
  return s;
}

export function birthDateString(nd: Partial<NodeData> | undefined | null): string {
  if (!nd) return "";
  return formatYMD(nd.birthYear, nd.birthMonth, nd.birthDay, nd.isBirthBC);
}

export function deathDateString(nd: Partial<NodeData> | undefined | null): string {
  if (!nd) return "";
  return formatYMD(nd.deathYear, nd.deathMonth, nd.deathDay, nd.isDeathBC);
}

// Year-only life span for compact rows ("1858 – 1929"). Full Y-M-D dates are
// too wide for a 4-up card or a table cell; they stay in the detail views.
export function lifeSpanYears(nd: Partial<NodeData> | undefined | null): string {
  if (!nd) return "";
  const birth = nd.birthYear ? (nd.isBirthBC ? `BC ${nd.birthYear}` : String(nd.birthYear)) : "";
  const death = nd.deathYear ? (nd.isDeathBC ? `BC ${nd.deathYear}` : String(nd.deathYear)) : "";
  if (birth && death) return `${birth} – ${death}`;
  if (birth) return birth;
  if (death) return `– ${death}`;
  return "";
}

// Birth-order comparison shared by the projection layer and the paper genealogy view.
// Returns null when no usable birth year is present so callers can treat the date as unknown.
export function getBirthOrderKey(
  nd: Partial<NodeData> | undefined | null,
): [number, number, number] | null {
  if (!nd || typeof nd.birthYear !== "number" || nd.birthYear <= 0) return null;
  const year = nd.isBirthBC ? -nd.birthYear : nd.birthYear;
  const month = typeof nd.birthMonth === "number" && nd.birthMonth > 0 ? nd.birthMonth : 0;
  const day = typeof nd.birthDay === "number" && nd.birthDay > 0 ? nd.birthDay : 0;
  return [year, month, day];
}

export function compareBirthOrderKey(
  a: [number, number, number],
  b: [number, number, number],
): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

// Order node ids eldest-first by birth date. Nodes with a known birth date sort before
// those without; equal or unknown dates keep their original order (stable). No id is ever
// dropped, so younger siblings never jump ahead of older ones and partially-loaded data
// degrades gracefully to insertion order until birth dates arrive.
export function sortNodeIdsByBirthOrder(
  ids: NodeId[],
  nodesData: Record<string, NodeData>,
): NodeId[] {
  if (ids.length <= 1) return ids;
  return ids
    .map((id, index) => ({ id, index }))
    .sort((a, b) => {
      const keyA = getBirthOrderKey(nodesData[a.id]);
      const keyB = getBirthOrderKey(nodesData[b.id]);
      if (keyA && keyB) {
        const byBirth = compareBirthOrderKey(keyA, keyB);
        if (byBirth !== 0) return byBirth;
      } else if (keyA) {
        return -1;
      } else if (keyB) {
        return 1;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.id);
}

export function genderText(
  gender: number | undefined,
  t: (key: string, def?: string) => string,
): string {
  switch (gender) {
    case 1:
      return t("familyTree.nodeDetail.genders.male", "Male");
    case 2:
      return t("familyTree.nodeDetail.genders.female", "Female");
    case 3:
      return t("familyTree.nodeDetail.genders.other", "Other");
    default:
      return gender !== undefined && gender >= 4 && gender <= 255
        ? `${t("familyTree.nodeDetail.genders.custom", "Custom")} (${gender})`
        : "";
  }
}

// Timestamp helpers (unix seconds -> localized string)
export function formatUnixSeconds(sec?: number | string | bigint): string {
  if (sec === undefined || sec === null) return "-";
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return "-";
  try {
    return new Date(n * 1000).toLocaleString();
  } catch {
    return "-";
  }
}

export function formatUnixDate(sec?: number | string | bigint): string {
  if (sec === undefined || sec === null) return "";
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return "";
  try {
    return new Date(n * 1000).toLocaleDateString();
  } catch {
    return "";
  }
}

// Address/Hash display helpers
export function formatHashMiddle(val?: string, prefix = 10, suffix = 8): string {
  if (!val) return "";
  const isHexLike = /^0x[0-9a-fA-F]+$/.test(val);
  if (isHexLike || val.length > prefix + suffix + 4) {
    return `${val.slice(0, prefix)}…${val.slice(-suffix)}`;
  }
  return val;
}

export function shortAddress(addr?: string, prefix = 8, suffix = 6): string {
  if (!addr) return "";
  const s = addr;
  if (s.length <= prefix + suffix + 2) return s;
  return `${s.slice(0, prefix)}…${s.slice(-suffix)}`;
}

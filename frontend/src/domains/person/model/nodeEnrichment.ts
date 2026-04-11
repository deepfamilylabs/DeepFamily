import { makeNodeId, type NodeData, type StoryMetadata } from "../../../types/graph";
import type { ParsedNftDetails, ParsedVersionDetails } from "../api/personDetailParsers";

export interface NodePair {
  h: string;
  v: number;
}

export interface NodeEnrichmentContext {
  id: string;
  current?: NodeData;
}

export interface NodeEnrichmentPatch {
  id: string;
  patch: Partial<NodeData>;
}

export interface NodeEnrichmentBatchResult {
  patches: NodeEnrichmentPatch[];
  nftErrors: Array<{ id: string; error: unknown }>;
}

export interface NodeEnrichmentSlicePlan {
  targets: NodePair[];
  backfills: Record<string, NodeData>;
}

type StoryMetadataReader = (tokenId: string) => Promise<StoryMetadata>;

export interface NodeEnrichmentApi {
  getVersionDetails: (
    personHash: string,
    versionIndex: number,
    options?: { ttlMs?: number },
  ) => Promise<ParsedVersionDetails>;
  getNFTDetails: (
    tokenId: string,
    options?: { ttlMs?: number },
  ) => Promise<ParsedNftDetails>;
}

export async function fetchNodeEnrichmentBatch(options: {
  targets: NodePair[];
  api: NodeEnrichmentApi;
  versionDetailsTtlMs: number;
  nftDetailsTtlMs: number;
  getVersionDetailsFetchedAt: (pair: NodePair) => number;
  getCurrentNode: (id: string) => NodeData | undefined;
  readStoryMetadata: StoryMetadataReader;
}): Promise<NodeEnrichmentBatchResult> {
  const versionResults = await Promise.all(
    options.targets.map(async (original) => {
      try {
        const parsed = await options.api.getVersionDetails(original.h, original.v, {
          ttlMs: options.versionDetailsTtlMs,
        });
        return { ok: true as const, original, parsed };
      } catch {
        return { ok: false as const, original };
      }
    }),
  );

  const patches: NodeEnrichmentPatch[] = [];
  const nftErrors: Array<{ id: string; error: unknown }> = [];
  for (const result of versionResults) {
    if (!result.ok) continue;
    const { original, parsed } = result;
    const id = makeNodeId(original.h, original.v);
    const current = options.getCurrentNode(id);
    patches.push({
      id,
      patch: buildVersionDetailsPatch({
        id,
        original,
        parsed,
        current,
        versionDetailsFetchedAt: options.getVersionDetailsFetchedAt(original),
      }),
    });

    if (parsed.tokenId === "0") continue;
    if (current?.fullName !== undefined) continue;

    try {
      const nftRet = await options.api.getNFTDetails(parsed.tokenId, {
        ttlMs: options.nftDetailsTtlMs,
      });
      const storyMetadata = await readStoryMetadataOrDefault(options.readStoryMetadata, parsed.tokenId);
      patches.push({
        id,
        patch: buildNftDetailsPatch({
          current: options.getCurrentNode(id) ?? current,
          tokenId: parsed.tokenId,
          nftRet,
          storyMetadata,
        }),
      });
    } catch (error) {
      nftErrors.push({ id, error });
    }
  }

  return { patches, nftErrors };
}

export function hasVersionDetailFields(node?: NodeData): boolean {
  return !!node && node.endorsementCount !== undefined && node.tokenId !== undefined;
}

export function isVersionDetailsFresh(node: NodeData | undefined, ttlMs: number): boolean {
  if (!hasVersionDetailFields(node)) return false;
  if (!Number.isFinite(node?.versionDetailsFetchedAt)) return false;
  if (ttlMs <= 0) return true;
  return Date.now() - Number(node?.versionDetailsFetchedAt) <= ttlMs;
}

export function planNodeEnrichmentSlice(options: {
  slice: NodePair[];
  snapshot: Record<string, NodeData> | null;
  currentNodes: Record<string, NodeData>;
  versionDetailsTtlMs: number;
}): NodeEnrichmentSlicePlan {
  const backfills: Record<string, NodeData> = {};
  const targets = options.slice.filter((pair) => {
    const id = makeNodeId(pair.h, pair.v);
    const fromMem = options.currentNodes[id];
    const fromSnap = options.snapshot ? options.snapshot[id] : undefined;
    if (hasVersionDetailFields(fromMem) || hasVersionDetailFields(fromSnap)) {
      if (!hasVersionDetailFields(fromMem) && fromSnap) {
        backfills[id] = fromSnap;
      }
    }
    return (
      !isVersionDetailsFresh(fromMem, options.versionDetailsTtlMs) &&
      !isVersionDetailsFresh(fromSnap, options.versionDetailsTtlMs)
    );
  });

  return { targets, backfills };
}

export function applyNodeDataBackfills(
  nodesData: Record<string, NodeData>,
  backfills: Record<string, NodeData>,
): Record<string, NodeData> {
  if (Object.keys(backfills).length === 0) return nodesData;
  let changed = false;
  const next = { ...nodesData };
  for (const [id, node] of Object.entries(backfills)) {
    const current = next[id];
    if (!hasVersionDetailFields(current)) {
      next[id] = current ? { ...current, ...node, id: current.id } : node;
      changed = true;
    }
  }
  return changed ? next : nodesData;
}

export function applyNodeEnrichmentPatches(
  nodesData: Record<string, NodeData>,
  patches: NodeEnrichmentPatch[],
): Record<string, NodeData> {
  if (patches.length === 0) return nodesData;
  let changed = false;
  const next = { ...nodesData };
  for (const { id, patch } of patches) {
    const current = next[id];
    const merged = current ? { ...current, ...patch } : ({ ...patch } as NodeData);
    if (next[id] !== merged) {
      next[id] = merged;
      changed = true;
    }
  }
  return changed ? next : nodesData;
}

export function buildVersionDetailsPatch(options: {
  id: string;
  original: NodePair;
  parsed: ParsedVersionDetails;
  current?: NodeData;
  versionDetailsFetchedAt: number;
}): Partial<NodeData> {
  const versionFields = options.parsed.version;
  return {
    ...(options.current || {
      personHash: options.original.h,
      versionIndex: options.original.v,
      id: options.id,
    }),
    endorsementCount: options.parsed.endorsementCount,
    tokenId: options.parsed.tokenId,
    fatherHash: versionFields.fatherHash,
    motherHash: versionFields.motherHash,
    fatherVersionIndex: versionFields.fatherVersionIndex,
    motherVersionIndex: versionFields.motherVersionIndex,
    addedBy: versionFields.addedBy,
    timestamp: versionFields.timestamp,
    tag: versionFields.tag ?? options.current?.tag,
    metadataCID: versionFields.metadataCID,
    versionDetailsFetchedAt: options.versionDetailsFetchedAt,
  };
}

export function buildNftDetailsPatch(options: {
  current?: NodeData;
  tokenId: string;
  nftRet: ParsedNftDetails;
  storyMetadata: StoryMetadata;
}): Partial<NodeData> {
  const versionFields = options.nftRet.version;
  const coreFields = options.nftRet.core;
  return {
    fatherHash: versionFields.fatherHash ?? options.current?.fatherHash,
    motherHash: versionFields.motherHash ?? options.current?.motherHash,
    fatherVersionIndex: versionFields.fatherVersionIndex ?? options.current?.fatherVersionIndex,
    motherVersionIndex: versionFields.motherVersionIndex ?? options.current?.motherVersionIndex,
    addedBy: versionFields.addedBy ?? options.current?.addedBy,
    timestamp: versionFields.timestamp ?? options.current?.timestamp,
    tag: versionFields.tag || options.current?.tag,
    metadataCID: versionFields.metadataCID ?? options.current?.metadataCID,
    endorsementCount: options.nftRet.endorsementCount ?? options.current?.endorsementCount,
    tokenId: options.tokenId,
    fullName: coreFields.fullName,
    gender: coreFields.gender,
    birthYear: coreFields.birthYear,
    birthMonth: coreFields.birthMonth,
    birthDay: coreFields.birthDay,
    birthPlace: coreFields.birthPlace,
    isBirthBC: coreFields.isBirthBC,
    deathYear: coreFields.deathYear,
    deathMonth: coreFields.deathMonth,
    deathDay: coreFields.deathDay,
    deathPlace: coreFields.deathPlace,
    isDeathBC: coreFields.isDeathBC,
    story: coreFields.story,
    nftTokenURI: options.nftRet.nftTokenURI,
    storyMetadata: options.storyMetadata,
    versionDetailsFetchedAt: Date.now(),
  };
}

async function readStoryMetadataOrDefault(
  readStoryMetadata: StoryMetadataReader,
  tokenId: string,
): Promise<StoryMetadata> {
  try {
    return await readStoryMetadata(tokenId);
  } catch {
    return {
      totalChunks: 0,
      totalLength: 0,
      isSealed: false,
      lastUpdateTime: 0,
      fullStoryHash: "",
    };
  }
}

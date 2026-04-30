import { readBlob, isIndexedDBSupported } from "../../../shared/cache/persistence";
import {
  applyOwnerToTokenNode,
  applyStoryDataToNode,
  backfillPersistedTokenNode,
  buildNodeFromNftDetails,
  buildStoryDataResult,
  buildStorySnapshot,
  findNodeByTokenId,
  findNodeEntryByTokenId,
  findNodeIdByTokenId,
  getMissingStoryOffset,
  getOwnerFromTokenNode,
  mergeStoryChunkRecords,
  parseStoryChunkRecord,
  type NodeData,
  type ParsedNftDetails,
  type StoryDataResult,
  upsertNode,
} from "../../../shared/model";

type RefLike<T> = { current: T };
type SetNodesData = (updater: (prev: Record<string, NodeData>) => Record<string, NodeData>) => void;

interface TreeNodeDataAccessOptions {
  api: {
    getNFTDetails: (tokenId: string, options?: { ttlMs?: number }) => Promise<ParsedNftDetails>;
  } | null;
  contract: any;
  contractAddress?: string | null;
  provider: any;
  nodesDataRef: RefLike<Record<string, NodeData>>;
  setNodesData: SetNodesData;
  storageNS: string;
  nftDetailsTtlMs: number;
  storyTtlMs: number;
  storyPageLimit: number;
  storyRevalidateRef: RefLike<Set<string>>;
}

export interface TreeNodeDataAccess {
  getNodeByTokenId: (tokenId: string) => Promise<NodeData | null>;
  getStoryData: (tokenId: string, opts?: { nodeIdHint?: string }) => Promise<StoryDataResult>;
  preloadStoryData: (tokenId: string) => void;
  getOwnerOf: (tokenId: string) => Promise<string | null>;
}

const isStale = (fetchedAt?: number, ttlMs?: number) => {
  if (!Number.isFinite(fetchedAt)) return true;
  const ttl = Number(ttlMs ?? 0);
  if (ttl <= 0) return false;
  return Date.now() - Number(fetchedAt) > ttl;
};

async function readPersistedNodesData(storageNS: string): Promise<Record<string, NodeData> | null> {
  if (!isIndexedDBSupported()) return null;
  try {
    return (await readBlob<Record<string, NodeData>>(`${storageNS}::nodesData`)) ?? null;
  } catch {
    return null;
  }
}

export function createTreeNodeDataAccess(options: TreeNodeDataAccessOptions): TreeNodeDataAccess {
  const getNodeByTokenId = async (tokenId: string): Promise<NodeData | null> => {
    const cachedNode = findNodeByTokenId(options.nodesDataRef.current, tokenId);
    if (cachedNode) return cachedNode;

    const persistedNodes = await readPersistedNodesData(options.storageNS);
    if (persistedNodes) {
      const persistedEntry = findNodeEntryByTokenId(persistedNodes, tokenId);
      if (persistedEntry) {
        options.setNodesData((prev) => backfillPersistedTokenNode(prev, persistedEntry));
        return persistedEntry[1];
      }
    }

    if (!options.api) return null;
    try {
      const nftDetails = await options.api.getNFTDetails(tokenId, {
        ttlMs: options.nftDetailsTtlMs,
      });
      const node = buildNodeFromNftDetails(tokenId, nftDetails);
      options.setNodesData((prev) => upsertNode(prev, node));
      return node;
    } catch {
      return null;
    }
  };

  const getStoryData = async (
    tokenId: string,
    opts?: { nodeIdHint?: string },
  ): Promise<StoryDataResult> => {
    const scheduleStoryRevalidate = (key: string, run: () => Promise<void>) => {
      if (options.storyRevalidateRef.current.has(key)) return;
      options.storyRevalidateRef.current.add(key);
      run()
        .catch(() => {})
        .finally(() => {
          options.storyRevalidateRef.current.delete(key);
        });
    };

    const fetchAndStoreStory = async (
      effectiveTokenId: string,
      nodeIdToUpdate?: string,
    ): Promise<StoryDataResult> => {
      if (!options.provider || !options.contractAddress || !options.contract) {
        throw new Error("Provider or contract address not available");
      }

      const existingNode = nodeIdToUpdate
        ? options.nodesDataRef.current[nodeIdToUpdate]
        : undefined;
      const existingChunks = Array.isArray(existingNode?.storyChunks)
        ? existingNode.storyChunks
        : [];
      let mergedChunks = [...existingChunks];

      const metadata = await options.contract.getStoryMetadata(effectiveTokenId);
      const storyMetadata = {
        totalChunks: Number(metadata.totalChunks),
        totalLength: Number(metadata.totalLength),
        isSealed: Boolean(metadata.isSealed),
        lastUpdateTime: Number(metadata.lastUpdateTime),
        fullStoryHash: metadata.fullStoryHash,
      };

      const total = Number(storyMetadata.totalChunks || 0);
      if (total > 0) {
        let offset = getMissingStoryOffset(mergedChunks);
        if (offset < total) {
          let hasMore = true;
          while (hasMore && offset < total) {
            const out: any = await options.contract.listStoryChunks(
              effectiveTokenId,
              offset,
              options.storyPageLimit,
            );
            const nextChunks = Array.from(out?.chunks ?? out?.[0] ?? []).map(parseStoryChunkRecord);
            mergedChunks = mergeStoryChunkRecords(mergedChunks, nextChunks, total);
            hasMore = Boolean(out?.hasMore ?? out?.[2]);
            const nextOffset = Number(out?.nextOffset ?? out?.[3] ?? 0);
            if (!Number.isFinite(nextOffset) || nextOffset <= offset) break;
            offset = nextOffset;
          }
        }
      }

      const storyData = buildStoryDataResult(mergedChunks, storyMetadata, Date.now());
      if (nodeIdToUpdate) {
        options.setNodesData((prev) => applyStoryDataToNode(prev, nodeIdToUpdate, storyData));
      }
      return storyData;
    };

    const findNodeIdByToken = () => findNodeIdByTokenId(options.nodesDataRef.current, tokenId);
    let nodeId = opts?.nodeIdHint || findNodeIdByToken();
    let nodeFromLookup: NodeData | undefined;
    if (!nodeId) {
      const node = await getNodeByTokenId(tokenId);
      if (node) {
        nodeId = node.id;
        nodeFromLookup = node;
      }
    }

    if (nodeId) {
      const node = nodeFromLookup || options.nodesDataRef.current[nodeId];
      if (node?.storyMetadata && Array.isArray(node.storyChunks)) {
        const stale = isStale(node.storyFetchedAt, options.storyTtlMs);
        const storySnapshot = buildStorySnapshot(node.storyChunks, node.storyMetadata);
        if (stale) {
          scheduleStoryRevalidate(`story:${String(tokenId)}`, async () => {
            await fetchAndStoreStory(String(tokenId), nodeId);
          });
        }
        return {
          chunks: storySnapshot.chunks,
          fullStory: storySnapshot.fullStory,
          integrity: storySnapshot.integrity,
          metadata: node.storyMetadata,
          loading: false,
          fetchedAt: Number(node.storyFetchedAt || 0),
        };
      }
    }

    if (!options.provider || !options.contractAddress || !options.contract) {
      throw new Error("Provider or contract address not available");
    }

    const ensuredNodeId = nodeId || findNodeIdByToken();
    return await fetchAndStoreStory(String(tokenId), ensuredNodeId);
  };

  const preloadStoryData = (tokenId: string) => {
    getStoryData(tokenId).catch(() => {
      /* silent */
    });
  };

  const getOwnerOf = async (tokenId: string): Promise<string | null> => {
    if (!options.contract) return null;

    const currentOwner = getOwnerFromTokenNode(options.nodesDataRef.current, tokenId);
    if (currentOwner) return currentOwner;

    const persistedNodes = await readPersistedNodesData(options.storageNS);
    if (persistedNodes) {
      const persistedEntry = findNodeEntryByTokenId(persistedNodes, tokenId);
      if (persistedEntry?.[1].owner) {
        options.setNodesData((prev) => backfillPersistedTokenNode(prev, persistedEntry));
        return persistedEntry[1].owner ?? null;
      }
    }

    try {
      const owner = await options.contract.ownerOf(tokenId);
      options.setNodesData((prev) => applyOwnerToTokenNode(prev, tokenId, owner));
      return owner;
    } catch {
      return null;
    }
  };

  return {
    getNodeByTokenId,
    getStoryData,
    preloadStoryData,
    getOwnerOf,
  };
}

import { useCallback } from "react";
import type React from "react";
import { deleteBlob, isIndexedDBSupported } from "../../../shared/cache/persistence";
import type { QueryCache } from "../../../shared/cache/QueryCache";
import {
  csKey,
  cuKey,
  nftKey,
  parseVdKey,
  storyKey,
  trustedEndorsementVisibilityPrefix,
  tvKey,
  vdKey,
} from "../../../shared/cache/queryKeys";
import {
  applyNodeDetailNftDetails,
  applyNodeDetailVersionDetails,
  bumpNodeEndorsementCount,
  clearAllMetadataUnlocks,
  isMetadataUnlockUsable,
  makeNodeId,
  rebaseValidatedMetadataUnlock,
  type NodeData,
  type NodeId,
  type NodeKeyMinimal,
  type ParsedNftDetails,
  type ParsedVersionDetails,
  type StoryDataResult,
  upsertNode,
} from "../../../shared/model";
import type { EdgeStoreStrict, EdgeStoreUnion } from "../model/treeStore";
import {
  addPlaceholderNodes,
  mergeReachableNodeIds,
  removeStrictEdges,
  removeUnionEdges,
  zeroVersionDetailFetchTimes,
} from "../services/treeEdgeState";
import { reloadInvalidatedTreeEdges } from "../services/treeEdgeRefresh";
import {
  buildTreeTxInvalidation,
  getInvalidateKeysAfterPersonVersionAdded,
  type TreeTxInvalidationInput,
} from "../services/treeInvalidation";
import { applyTotalVersionsToNodes } from "../selectors/treeTotals";
import {
  captureTreeNodesPersistenceRevision,
  clearTreeMetadataUnlocks,
  deleteTreeNodesSnapshot,
  invalidateAllTreeNodesWrites,
  invalidateTreeNodesPlaintextWrites,
  isTreeNodesPersistenceRevisionCurrent,
  updateTreeNodesSnapshot,
} from "../services/treeNodesPersistence";
import type { TreeProgress } from "./types";

interface UseTreeCacheActionsOptions {
  api: any;
  contract: any;
  contractAddress?: string | null;
  eventInterfaceRef: React.MutableRefObject<any>;
  queryCacheRef: { current: QueryCache };
  nodesDataRef: React.MutableRefObject<Record<string, NodeData>>;
  edgesStrictRef: React.MutableRefObject<EdgeStoreStrict>;
  reachableNodeIdsRef: React.MutableRefObject<NodeId[]>;
  setNodesData: React.Dispatch<React.SetStateAction<Record<string, NodeData>>>;
  setEdgesUnion: React.Dispatch<React.SetStateAction<EdgeStoreUnion>>;
  setEdgesStrict: React.Dispatch<React.SetStateAction<EdgeStoreStrict>>;
  setReachableNodeIds: React.Dispatch<React.SetStateAction<NodeId[]>>;
  setProgress: React.Dispatch<React.SetStateAction<TreeProgress | undefined>>;
  refresh: () => void;
  storageNS: string;
  edgesUnionKey: string;
  edgesStrictKey: string;
  useIndexedDbCache: boolean;
  childrenPageLimit: number;
  totalVersionsTtlMs: number;
}

function projectConfirmedPersonVersion(node: NodeData): NodeData {
  if (!isMetadataUnlockUsable(node)) {
    throw new Error("Only fully validated metadata may enter the confirmed version cache");
  }
  const id = makeNodeId(node.personHash, Number(node.versionIndex));
  const publicSnapshot: NodeData = {
    id,
    personHash: node.personHash,
    versionIndex: Number(node.versionIndex),
    versionCommitment: node.versionCommitment,
    metadataPointer: node.metadataPointer,
    metadataPayloadHash: node.metadataPayloadHash,
    metadataPayloadLength: node.metadataPayloadLength,
    ...(node.fatherHash !== undefined ? { fatherHash: node.fatherHash } : {}),
    ...(node.motherHash !== undefined ? { motherHash: node.motherHash } : {}),
    ...(node.fatherVersionIndex !== undefined
      ? { fatherVersionIndex: node.fatherVersionIndex }
      : {}),
    ...(node.motherVersionIndex !== undefined
      ? { motherVersionIndex: node.motherVersionIndex }
      : {}),
    ...(node.addedBy !== undefined ? { addedBy: node.addedBy } : {}),
    ...(node.timestamp !== undefined ? { timestamp: node.timestamp } : {}),
    ...(node.endorsementCount !== undefined ? { endorsementCount: node.endorsementCount } : {}),
    ...(node.tokenId !== undefined ? { tokenId: node.tokenId } : {}),
    ...(node.versionDetailsFetchedAt !== undefined
      ? { versionDetailsFetchedAt: node.versionDetailsFetchedAt }
      : {}),
    ...(node.totalVersions !== undefined ? { totalVersions: node.totalVersions } : {}),
  };
  return rebaseValidatedMetadataUnlock(publicSnapshot, node);
}

export function useTreeCacheActions(options: UseTreeCacheActionsOptions) {
  const nodesStorageKey = `${options.storageNS}::nodesData`;
  const captureMetadataCacheRevision = useCallback(
    () => captureTreeNodesPersistenceRevision(nodesStorageKey),
    [nodesStorageKey],
  );

  const clearTreeQueryCaches = useCallback(
    (includeNodeDetailKeys: boolean) => {
      options.queryCacheRef.current.clear("tv:");
      options.queryCacheRef.current.clear("cs:");
      options.queryCacheRef.current.clear("cu:");
      // Trusted-source list (`te:`) and per-version visibility (`tev:`) caches gate
      // which nodes the tree filter shows. They are tied to the current trusted-source
      // set, so a full tree-cache clear must drop them too (e.g. after editing sources).
      options.queryCacheRef.current.clear("te:");
      options.queryCacheRef.current.clear("tev:");

      if (!includeNodeDetailKeys) return;
      const seenVersionKeys = new Set<string>();
      const seenTokenIds = new Set<string>();
      for (const node of Object.values(options.nodesDataRef.current)) {
        if (
          node?.personHash &&
          Number.isFinite(Number(node.versionIndex)) &&
          Number(node.versionIndex) > 0
        ) {
          seenVersionKeys.add(vdKey(node.personHash, Number(node.versionIndex)));
          seenVersionKeys.add(tvKey(node.personHash));
          seenVersionKeys.add(csKey(node.personHash, Number(node.versionIndex)));
          seenVersionKeys.add(cuKey(node.personHash));
        }
        if (node?.tokenId && String(node.tokenId) !== "0") {
          seenTokenIds.add(String(node.tokenId));
        }
      }

      for (const key of seenVersionKeys) {
        options.queryCacheRef.current.clear(key);
      }
      for (const tokenId of seenTokenIds) {
        options.queryCacheRef.current.clear(nftKey(tokenId));
        options.queryCacheRef.current.clear(storyKey(tokenId));
        options.queryCacheRef.current.clear(`${storyKey(tokenId)}:meta`);
      }
    },
    [options.nodesDataRef, options.queryCacheRef],
  );

  const clearAllCaches = useCallback(() => {
    options.setNodesData({});
    options.setEdgesUnion({});
    options.setEdgesStrict({});
    clearTreeQueryCaches(true);
    options.setReachableNodeIds([]);
    options.setProgress(undefined);
    if (options.useIndexedDbCache && isIndexedDBSupported()) {
      deleteTreeNodesSnapshot(nodesStorageKey).catch(() => {});
      deleteBlob(options.edgesUnionKey).catch(() => {});
      deleteBlob(options.edgesStrictKey).catch(() => {});
    } else {
      invalidateAllTreeNodesWrites(nodesStorageKey);
    }
  }, [
    clearTreeQueryCaches,
    options.edgesStrictKey,
    options.edgesUnionKey,
    options.setEdgesStrict,
    options.setEdgesUnion,
    options.setNodesData,
    options.setProgress,
    options.setReachableNodeIds,
    nodesStorageKey,
    options.useIndexedDbCache,
  ]);

  const clearMetadataUnlockCache = useCallback(() => {
    const lockedSnapshot = clearAllMetadataUnlocks(options.nodesDataRef.current);
    // Keep the imperative ref in lockstep immediately: callers may unmount or
    // start another cache operation before React runs the normal ref effect.
    options.nodesDataRef.current = lockedSnapshot;
    options.setNodesData((current) => {
      const lockedCurrent = clearAllMetadataUnlocks(current);
      options.nodesDataRef.current = lockedCurrent;
      return lockedCurrent;
    });
    if (!options.useIndexedDbCache || !isIndexedDBSupported()) {
      invalidateTreeNodesPlaintextWrites(nodesStorageKey);
      return Promise.resolve();
    }
    return clearTreeMetadataUnlocks(nodesStorageKey, lockedSnapshot);
  }, [nodesStorageKey, options.nodesDataRef, options.setNodesData, options.useIndexedDbCache]);

  const invalidateTreeRootCache = useCallback(() => {
    options.setReachableNodeIds([]);
    options.setProgress(undefined);
    options.setEdgesUnion({});
    options.setEdgesStrict({});
    clearTreeQueryCaches(false);
    if (options.useIndexedDbCache && isIndexedDBSupported()) {
      deleteBlob(options.edgesUnionKey).catch(() => {});
      deleteBlob(options.edgesStrictKey).catch(() => {});
    }
    options.refresh();
  }, [
    clearTreeQueryCaches,
    options.edgesStrictKey,
    options.edgesUnionKey,
    options.refresh,
    options.setEdgesStrict,
    options.setEdgesUnion,
    options.setProgress,
    options.setReachableNodeIds,
    options.useIndexedDbCache,
  ]);

  const updateTotalVersions = useCallback(
    (personHash: string, totalVersions: number) => {
      options.setNodesData((prev) => applyTotalVersionsToNodes(prev, personHash, totalVersions));
    },
    [options.setNodesData],
  );

  const refreshInvalidatedEdges = useCallback(
    async (invalidation: ReturnType<typeof getInvalidateKeysAfterPersonVersionAdded>) => {
      if (!options.api) {
        options.refresh();
        return;
      }
      const { unionUpserts, strictUpserts, newReachableChildren } =
        await reloadInvalidatedTreeEdges({
          api: options.api,
          invalidation,
          reachableNodeIds: options.reachableNodeIdsRef.current,
          edgesStrict: options.edgesStrictRef.current,
          childrenPageLimit: options.childrenPageLimit,
          totalVersionsTtlMs: options.totalVersionsTtlMs,
          onTotalVersions: updateTotalVersions,
        });

      if (Object.keys(unionUpserts).length) {
        options.setEdgesUnion((prev) => ({ ...prev, ...unionUpserts }));
      }
      if (Object.keys(strictUpserts).length) {
        options.setEdgesStrict((prev) => ({ ...prev, ...strictUpserts }));
      }

      if (newReachableChildren.length) {
        options.setNodesData((prev) => addPlaceholderNodes(prev, newReachableChildren));
        options.setReachableNodeIds((prev) => mergeReachableNodeIds(prev, newReachableChildren));
      }
    },
    [
      options.api,
      options.childrenPageLimit,
      options.edgesStrictRef,
      options.reachableNodeIdsRef,
      options.refresh,
      options.setEdgesStrict,
      options.setEdgesUnion,
      options.setNodesData,
      options.setReachableNodeIds,
      options.totalVersionsTtlMs,
      updateTotalVersions,
    ],
  );

  const invalidateByTx = useCallback(
    (input?: TreeTxInvalidationInput | null) => {
      if (!input) return;

      const invalidation = buildTreeTxInvalidation(input, {
        eventInterface: options.contract?.interface || options.eventInterfaceRef.current,
        contractAddress: options.contractAddress,
      });

      for (const key of invalidation.totalVersionsKeys) {
        options.queryCacheRef.current.clear(key);
      }
      for (const key of invalidation.versionDetailKeys) {
        options.queryCacheRef.current.clear(key);
        // An endorsement/withdrawal flips this version's trusted visibility, so drop the
        // cached `tev:` results for every trusted-source set keyed on this person+version.
        const parsed = parseVdKey(key);
        if (parsed) {
          options.queryCacheRef.current.clear(
            trustedEndorsementVisibilityPrefix(parsed.hashLower, parsed.versionIndex),
          );
        }
      }
      for (const key of invalidation.nftKeys) {
        options.queryCacheRef.current.clear(key);
      }

      if (invalidation.versionDetailKeys.length > 0) {
        options.setNodesData((prev) =>
          zeroVersionDetailFetchTimes(prev, invalidation.versionDetailKeys),
        );
      }

      if (invalidation.unionKeys.length > 0) {
        options.setEdgesUnion((prev) => removeUnionEdges(prev, invalidation.unionKeys));
      }

      if (invalidation.strictKeys.length > 0 || invalidation.strictPrefixes.length > 0) {
        options.setEdgesStrict((prev) =>
          removeStrictEdges({
            edgesStrict: prev,
            strictKeys: invalidation.strictKeys,
            strictPrefixes: invalidation.strictPrefixes,
          }),
        );
      }

      if (
        invalidation.unionKeys.length > 0 ||
        invalidation.strictKeys.length > 0 ||
        invalidation.strictPrefixes.length > 0
      ) {
        refreshInvalidatedEdges({
          totalVersionsKeys: invalidation.totalVersionsKeys,
          unionKeys: invalidation.unionKeys,
          strictKeys: invalidation.strictKeys,
          strictPrefixes: invalidation.strictPrefixes,
        }).catch(() => options.refresh());
      }
    },
    [
      options.contract,
      options.contractAddress,
      options.eventInterfaceRef,
      options.queryCacheRef,
      options.refresh,
      options.setEdgesStrict,
      options.setEdgesUnion,
      options.setNodesData,
      refreshInvalidatedEdges,
    ],
  );

  const bumpEndorsementCount = useCallback(
    (personHash: string, versionIndex: number, delta: number = 1) => {
      if (!personHash || !Number.isFinite(Number(versionIndex))) return;
      options.setNodesData((prev) =>
        bumpNodeEndorsementCount(prev, personHash, Number(versionIndex), delta),
      );
    },
    [options.setNodesData],
  );

  const markVersionMinted = useCallback(
    (params: {
      personHash: string;
      versionIndex: number;
      tokenId: string;
      tokenURI?: string;
      receipt?: unknown;
    }) => {
      const { personHash, versionIndex, tokenId, tokenURI, receipt } = params;
      if (!personHash || !Number.isFinite(Number(versionIndex)) || !tokenId) return;
      const id = makeNodeId(personHash, Number(versionIndex));
      options.setNodesData((prev) => {
        const current = prev[id] ?? {
          personHash,
          versionIndex: Number(versionIndex),
          id,
        };
        return upsertNode(prev, {
          ...current,
          tokenId: String(tokenId),
          ...(tokenURI ? { nftTokenURI: tokenURI } : {}),
        });
      });
      invalidateByTx({
        receipt,
        hints: { personHash, versionIndex: Number(versionIndex), tokenId: String(tokenId) },
      } as TreeTxInvalidationInput);
    },
    [options.setNodesData, invalidateByTx],
  );

  const cacheValidatedPersonVersion = useCallback(
    (node: NodeData, expectedRevision: number) => {
      if (!isMetadataUnlockUsable(node)) {
        throw new Error("Only fully validated metadata may enter the NodeData unlock cache");
      }
      const id = makeNodeId(node.personHash, Number(node.versionIndex));
      if (!isTreeNodesPersistenceRevisionCurrent(nodesStorageKey, expectedRevision)) return;
      const latest = options.nodesDataRef.current[id];
      if (!latest) throw new Error("Cannot cache metadata for a node that is no longer loaded");
      rebaseValidatedMetadataUnlock(latest, node);
      options.setNodesData((current) => {
        const currentNode = current[id];
        if (!currentNode) return current;
        try {
          return upsertNode(current, rebaseValidatedMetadataUnlock(currentNode, node));
        } catch {
          return current;
        }
      });
    },
    [nodesStorageKey, options.nodesDataRef, options.setNodesData],
  );

  const cacheConfirmedPersonVersion = useCallback(
    (node: NodeData, expectedRevision: number): Promise<void> => {
      // This is the only missing-node path. Its caller must have already checked
      // the post-confirmation Reader/Archive anchors; the explicit projection
      // prevents Worker diagnostics or secret intermediates from being retained.
      const committed = projectConfirmedPersonVersion(node);
      if (!isTreeNodesPersistenceRevisionCurrent(nodesStorageKey, expectedRevision)) {
        return Promise.resolve();
      }
      const id = committed.id;
      const nextNodes = upsertNode(options.nodesDataRef.current, committed);
      options.nodesDataRef.current = nextNodes;
      options.setNodesData((current) => {
        const currentNode = current[id];
        if (!currentNode) return upsertNode(current, committed);
        return upsertNode(current, rebaseValidatedMetadataUnlock(currentNode, committed));
      });

      if (!options.useIndexedDbCache || !isIndexedDBSupported()) return Promise.resolve();
      return updateTreeNodesSnapshot(
        nodesStorageKey,
        (persisted) => ({
          ...persisted,
          ...nextNodes,
          [id]: {
            ...(persisted[id] ?? {}),
            ...committed,
          },
        }),
        expectedRevision,
      );
    },
    [nodesStorageKey, options.nodesDataRef, options.setNodesData, options.useIndexedDbCache],
  );

  const persistValidatedPersonVersion = useCallback(
    async (node: NodeData, expectedRevision: number) => {
      if (!isMetadataUnlockUsable(node)) {
        throw new Error("Only fully validated metadata may enter the IndexedDB unlock cache");
      }
      if (!isTreeNodesPersistenceRevisionCurrent(nodesStorageKey, expectedRevision)) return;
      if (!options.useIndexedDbCache || !isIndexedDBSupported()) return;

      const id = makeNodeId(node.personHash, Number(node.versionIndex));
      if (!options.nodesDataRef.current[id]) {
        throw new Error("Cannot persist metadata for a node that is no longer loaded");
      }
      // Persist each successful unlock immediately. Merge both the durable and
      // current in-memory snapshots so a per-item write never discards public
      // tree data or a preceding successful item in the same serial batch.
      await updateTreeNodesSnapshot(
        nodesStorageKey,
        (persisted) => {
          const currentNodes = options.nodesDataRef.current;
          const latest = currentNodes[id];
          if (!latest) {
            throw new Error("Cannot persist metadata for a node that is no longer loaded");
          }
          const committed = rebaseValidatedMetadataUnlock(latest, node);
          return {
            ...persisted,
            ...currentNodes,
            [id]: {
              ...(persisted[id] ?? {}),
              ...committed,
            },
          };
        },
        expectedRevision,
      );
    },
    [nodesStorageKey, options.nodesDataRef, options.useIndexedDbCache],
  );

  const mergeNodeDetail = useCallback(
    (
      selected: NodeKeyMinimal,
      details: {
        versionDetails?: ParsedVersionDetails | null;
        nftDetails?: { tokenId: string; parsed: ParsedNftDetails } | null;
        storyData?: StoryDataResult | null;
      },
    ) => {
      if (!selected) return;
      const { versionDetails, nftDetails, storyData } = details;
      if (versionDetails) {
        options.setNodesData((prev) =>
          applyNodeDetailVersionDetails({
            nodesData: prev,
            selected,
            parsed: versionDetails,
            fetchedAt: Date.now(),
          }),
        );
      }
      if (nftDetails) {
        options.setNodesData((prev) =>
          applyNodeDetailNftDetails({
            nodesData: prev,
            selected,
            tokenId: nftDetails.tokenId,
            nftDetails: nftDetails.parsed,
            storyData: storyData ?? undefined,
          }),
        );
      }
    },
    [options.setNodesData],
  );

  return {
    clearAllCaches,
    clearMetadataUnlockCache,
    captureMetadataCacheRevision,
    cacheValidatedPersonVersion,
    cacheConfirmedPersonVersion,
    persistValidatedPersonVersion,
    invalidateTreeRootCache,
    invalidateByTx,
    bumpEndorsementCount,
    markVersionMinted,
    mergeNodeDetail,
  };
}

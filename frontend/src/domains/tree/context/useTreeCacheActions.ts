import { useCallback } from "react";
import type React from "react";
import { deleteBlob, isIndexedDBSupported } from "../../../shared/cache/persistence";
import type { QueryCache } from "../../../shared/cache/QueryCache";
import { csKey, cuKey, nftKey, storyKey, tvKey, vdKey } from "../../../shared/cache/queryKeys";
import type { NodeData, NodeId } from "../../../shared/model";
import type { EdgeStoreStrict, EdgeStoreUnion } from "../model/treeStore";
import { bumpNodeEndorsementCount } from "../../person/model/nodeState";
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

export function useTreeCacheActions(options: UseTreeCacheActionsOptions) {
  const clearTreeQueryCaches = useCallback(
    (includeNodeDetailKeys: boolean) => {
      options.queryCacheRef.current.clear("tv:");
      options.queryCacheRef.current.clear("cs:");
      options.queryCacheRef.current.clear("cu:");

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
      deleteBlob(`${options.storageNS}::nodesData`).catch(() => {});
      deleteBlob(options.edgesUnionKey).catch(() => {});
      deleteBlob(options.edgesStrictKey).catch(() => {});
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
    options.storageNS,
    options.useIndexedDbCache,
  ]);

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

  const updateTotalVersions = useCallback((personHash: string, totalVersions: number) => {
    options.setNodesData((prev) => applyTotalVersionsToNodes(prev, personHash, totalVersions));
  }, [options.setNodesData]);

  const refreshInvalidatedEdges = useCallback(
    async (invalidation: ReturnType<typeof getInvalidateKeysAfterPersonVersionAdded>) => {
      if (!options.api) {
        options.refresh();
        return;
      }
      const { unionUpserts, strictUpserts, newReachableChildren } = await reloadInvalidatedTreeEdges(
        {
          api: options.api,
          invalidation,
          reachableNodeIds: options.reachableNodeIdsRef.current,
          edgesStrict: options.edgesStrictRef.current,
          childrenPageLimit: options.childrenPageLimit,
          totalVersionsTtlMs: options.totalVersionsTtlMs,
          onTotalVersions: updateTotalVersions,
        },
      );

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
      }
      for (const key of invalidation.nftKeys) {
        options.queryCacheRef.current.clear(key);
      }

      if (invalidation.versionDetailKeys.length > 0) {
        options.setNodesData((prev) => zeroVersionDetailFetchTimes(prev, invalidation.versionDetailKeys));
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

  return {
    clearAllCaches,
    invalidateTreeRootCache,
    invalidateByTx,
    bumpEndorsementCount,
  };
}

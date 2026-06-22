import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useErrorMonitor } from "./useErrorMonitor";
import { useVizOptions } from "./VizOptionsContext";
import { useTreeGraphState } from "./useTreeGraphState";
import { useTreeCacheActions } from "./useTreeCacheActions";
import { useTreeRuntime } from "./useTreeRuntime";
import { createTreeNodeDataAccess } from "../services/treeNodeDataAccess";
import { getTreeQueryPageLimit, isIndexedDbCacheEnabled } from "../../../shared/config/env";
import {
  TreeProviderContexts,
  useTreeDebugData,
  useTreeGraphData,
  useTreeMutations,
  useTreeNodeAccess,
  useTreeStatus,
  type TreeDebugValue,
  type TreeGraphDataValue,
  type TreeMutationsValue,
  type TreeNodeAccessValue,
  type TreeStatusValue,
} from "./treeContexts";
import { TTL } from "../../../shared/cache/ttl";
const EDGE_TTL_MS = TTL.edges;
const TOTAL_VERSIONS_TTL_MS = TTL.totalVersions;
const VERSION_DETAILS_TTL_MS = TTL.versionDetails;
const NFT_DETAILS_TTL_MS = TTL.nftDetails;
const STORY_TTL_MS = TTL.story;
const USE_INDEXEDDB_CACHE = isIndexedDbCacheEnabled();
const QUERY_PAGE_LIMIT = getTreeQueryPageLimit();
const CHILDREN_PAGE_LIMIT = QUERY_PAGE_LIMIT;
const STORY_PAGE_LIMIT = QUERY_PAGE_LIMIT;

export function TreeViewProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { traversal, childrenMode, strictIncludeUnversionedChildren, trustedSourceFilterEnabled } =
    useVizOptions();
  const { errors, push } = useErrorMonitor();
  const runtime = useTreeRuntime();
  const {
    nodesData,
    setNodesData,
    nodesDataRef,
    edgesUnion,
    setEdgesUnion,
    edgesStrict,
    setEdgesStrict,
    edgesStrictRef,
    reachableNodeIds,
    setReachableNodeIds,
    reachableNodeIdsRef,
    loading,
    rootExists,
    progress,
    setProgress,
    contractMessage,
    endorsementsReady,
    trustedFilterActive,
    spouseVersionResolution,
    getDebugStats,
  } = useTreeGraphState({
    rootId: runtime.rootId,
    rootHash: runtime.rootHash,
    rootVersionIndex: runtime.rootVersionIndex,
    provider: runtime.provider,
    contract: runtime.contract,
    api: runtime.api,
    queryCacheRef: runtime.queryCacheRef,
    storageNS: runtime.storageNS,
    edgesUnionKey: runtime.edgesUnionKey,
    edgesStrictKey: runtime.edgesStrictKey,
    refreshTick: runtime.refreshTick,
    traversal,
    childrenMode,
    strictIncludeUnversionedChildren,
    trustedSourceFilterEnabled,
    edgeTtlMs: EDGE_TTL_MS,
    totalVersionsTtlMs: TOTAL_VERSIONS_TTL_MS,
    versionDetailsTtlMs: VERSION_DETAILS_TTL_MS,
    nftDetailsTtlMs: NFT_DETAILS_TTL_MS,
    childrenPageLimit: CHILDREN_PAGE_LIMIT,
    t,
    push,
  });

  const nodeDataAccess = useMemo(
    () =>
      createTreeNodeDataAccess({
        api: runtime.api,
        contract: runtime.contract,
        nftContract: runtime.nftContract,
        contractAddress: runtime.contractAddress,
        provider: runtime.provider,
        nodesDataRef,
        setNodesData,
        storageNS: runtime.storageNS,
        nftDetailsTtlMs: NFT_DETAILS_TTL_MS,
        storyTtlMs: STORY_TTL_MS,
        storyPageLimit: STORY_PAGE_LIMIT,
        storyRevalidateRef: runtime.storyRevalidateRef,
      }),
    [
      runtime.api,
      runtime.contract,
      runtime.nftContract,
      runtime.contractAddress,
      runtime.provider,
      runtime.storageNS,
    ],
  );

  const { getNodeByTokenId, getStoryData, preloadStoryData, getOwnerOf } = nodeDataAccess;

  const {
    clearAllCaches,
    invalidateTreeRootCache,
    invalidateByTx,
    bumpEndorsementCount,
    markVersionMinted,
    mergeNodeDetail,
  } = useTreeCacheActions({
    api: runtime.api,
    contract: runtime.contract,
    contractAddress: runtime.contractAddress,
    eventInterfaceRef: runtime.eventInterfaceRef,
    queryCacheRef: runtime.queryCacheRef,
    nodesDataRef,
    edgesStrictRef,
    reachableNodeIdsRef,
    setNodesData,
    setEdgesUnion,
    setEdgesStrict,
    setReachableNodeIds,
    setProgress,
    refresh: runtime.refresh,
    storageNS: runtime.storageNS,
    edgesUnionKey: runtime.edgesUnionKey,
    edgesStrictKey: runtime.edgesStrictKey,
    useIndexedDbCache: USE_INDEXEDDB_CACHE,
    childrenPageLimit: CHILDREN_PAGE_LIMIT,
    totalVersionsTtlMs: TOTAL_VERSIONS_TTL_MS,
  });

  const graphValue: TreeGraphDataValue = {
    rootId: runtime.rootId,
    rootExists,
    reachableNodeIds,
    endorsementsReady,
    trustedFilterActive,
    spouseVersionResolution,
    nodesData,
    edgesUnion,
    edgesStrict,
  };

  const statusValue: TreeStatusValue = {
    loading,
    progress,
    contractMessage,
    refresh: runtime.refresh,
    invalidateTreeRootCache,
    errors,
    clearAllCaches,
  };

  const nodeAccessValue: TreeNodeAccessValue = {
    getStoryData,
    preloadStoryData,
    getNodeByTokenId,
    getOwnerOf,
  };

  const mutationsValue: TreeMutationsValue = {
    clearAllCaches,
    bumpEndorsementCount,
    invalidateByTx,
    markVersionMinted,
    mergeNodeDetail,
  };

  const debugValue: TreeDebugValue = { getDebugStats };

  return (
    <TreeProviderContexts
      graph={graphValue}
      status={statusValue}
      nodeAccess={nodeAccessValue}
      mutations={mutationsValue}
      debug={debugValue}
    >
      {children}
    </TreeProviderContexts>
  );
}
export { useTreeDebugData, useTreeGraphData, useTreeMutations, useTreeNodeAccess, useTreeStatus };

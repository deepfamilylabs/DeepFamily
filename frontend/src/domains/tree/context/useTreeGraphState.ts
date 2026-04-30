import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readBlob, writeBlob, isIndexedDBSupported } from "../../../shared/cache/persistence";
import type { QueryCache } from "../../../shared/cache/QueryCache";
import { vdKey } from "../../../shared/cache/queryKeys";
import { isIndexedDbCacheEnabled } from "../../../shared/config/env";
import { getRuntimeFamilyTreeConfig } from "../config/familyTreeConfig";
import {
  applyNodeDataBackfills,
  applyNodeEnrichmentPatches,
  fetchNodeEnrichmentBatch,
  isVersionDetailsFresh,
  type NodeData,
  type NodeId,
  planNodeEnrichmentSlice,
} from "../../../shared/model";
import type { EdgeStoreStrict, EdgeStoreUnion } from "../model/treeStore";
import { addPlaceholderNodes, mergeReachableNodeIds } from "../services/treeEdgeState";
import { buildTreeFetchRunKey } from "../services/treeTraversalState";
import {
  applyTreeBuildNodeSnapshots,
  applyTreeBuildStrictSnapshots,
  applyTreeBuildUnionSnapshots,
  runTreeBuildSession,
} from "../services/treeTraversalOrchestrator";
import {
  createTreeEdgeRevalidators,
  createTreeSessionEdgeLoaders,
} from "../services/treeSessionEdges";
import { applyTotalVersionsToNodes, parseTotalVersionsResult } from "../selectors/treeTotals";
import { verifyTreeSessionStartup } from "../services/treeSessionStartup";
import type { TreeDebugStats, TreeProgress } from "./types";

const USE_INDEXEDDB_CACHE = isIndexedDbCacheEnabled();

interface UseTreeGraphStateOptions {
  rootId: NodeId | null;
  rootHash?: string | null;
  rootVersionIndex?: number | string | null;
  provider: any;
  contract: any;
  api: any;
  queryCacheRef: { current: QueryCache };
  storageNS: string;
  edgesUnionKey: string;
  edgesStrictKey: string;
  refreshTick: number;
  traversal: "dfs" | "bfs";
  childrenMode: "strict" | "union";
  strictIncludeUnversionedChildren: boolean;
  edgeTtlMs: number;
  totalVersionsTtlMs: number;
  versionDetailsTtlMs: number;
  nftDetailsTtlMs: number;
  childrenPageLimit: number;
  t: any;
  push: (error: any, meta?: any) => void;
}

export interface TreeGraphStateResult {
  idbHydrated: boolean;
  nodesData: Record<string, NodeData>;
  setNodesData: React.Dispatch<React.SetStateAction<Record<string, NodeData>>>;
  nodesDataRef: React.MutableRefObject<Record<string, NodeData>>;
  edgesUnion: EdgeStoreUnion;
  setEdgesUnion: React.Dispatch<React.SetStateAction<EdgeStoreUnion>>;
  edgesUnionRef: React.MutableRefObject<EdgeStoreUnion>;
  edgesStrict: EdgeStoreStrict;
  setEdgesStrict: React.Dispatch<React.SetStateAction<EdgeStoreStrict>>;
  edgesStrictRef: React.MutableRefObject<EdgeStoreStrict>;
  reachableNodeIds: NodeId[];
  setReachableNodeIds: React.Dispatch<React.SetStateAction<NodeId[]>>;
  reachableNodeIdsRef: React.MutableRefObject<NodeId[]>;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  rootExists: boolean;
  setRootExists: React.Dispatch<React.SetStateAction<boolean>>;
  progress: TreeProgress | undefined;
  setProgress: React.Dispatch<React.SetStateAction<TreeProgress | undefined>>;
  contractMessage: string;
  setContractMessage: React.Dispatch<React.SetStateAction<string>>;
  endorsementsReady: boolean;
  debugStatsRef: React.MutableRefObject<TreeDebugStats>;
  getDebugStats: () => TreeDebugStats;
}

export function useTreeGraphState(options: UseTreeGraphStateOptions): TreeGraphStateResult {
  const [idbHydrated, setIdbHydrated] = useState(
    () => !USE_INDEXEDDB_CACHE || !isIndexedDBSupported(),
  );
  const [nodesData, setNodesData] = useState<Record<string, NodeData>>({});
  const nodesDataRef = useRef(nodesData);
  useEffect(() => {
    nodesDataRef.current = nodesData;
  }, [nodesData]);

  const [edgesUnion, setEdgesUnion] = useState<EdgeStoreUnion>({});
  const edgesUnionRef = useRef(edgesUnion);
  useEffect(() => {
    edgesUnionRef.current = edgesUnion;
  }, [edgesUnion]);

  const [edgesStrict, setEdgesStrict] = useState<EdgeStoreStrict>({});
  const edgesStrictRef = useRef(edgesStrict);
  useEffect(() => {
    edgesStrictRef.current = edgesStrict;
  }, [edgesStrict]);

  const [reachableNodeIds, setReachableNodeIds] = useState<NodeId[]>([]);
  const reachableNodeIdsRef = useRef(reachableNodeIds);
  useEffect(() => {
    reachableNodeIdsRef.current = reachableNodeIds;
  }, [reachableNodeIds]);

  const [loading, setLoading] = useState(false);
  const [rootExists, setRootExists] = useState(false);
  const [progress, setProgress] = useState<TreeProgress | undefined>(undefined);
  const [contractMessage, setContractMessage] = useState("");
  const [endorsementsReady, setEndorsementsReady] = useState(false);

  const fetchRunKeyRef = useRef<string | null>(null);
  const edgeRevalidateRef = useRef(new Set<string>());
  const stageLoggedRef = useRef<Set<string>>(new Set());
  const debugStatsRef = useRef<TreeDebugStats>({
    inflightCount: 0,
    edgeCacheHits: { strict: 0, union: 0 },
    edgeCacheMisses: { strict: 0, union: 0 },
    lastEdgeFetchAt: {},
    totalVersionsCacheHits: 0,
    totalVersionsCacheMisses: 0,
  });

  const getDebugStats = useCallback(
    () => ({
      ...debugStatsRef.current,
      inflightCount: options.queryCacheRef.current.inflightCount(),
    }),
    [options.queryCacheRef],
  );

  useEffect(() => {
    setNodesData({});
    setEdgesUnion({});
    setEdgesStrict({});
  }, [options.storageNS]);

  useEffect(() => {
    if (!USE_INDEXEDDB_CACHE || !isIndexedDBSupported()) {
      setIdbHydrated(true);
      return;
    }
    setIdbHydrated(false);
    let cancelled = false;
    (async () => {
      try {
        const [idbNodes, idbEdgesUnion, idbEdgesStrict] = await Promise.all([
          readBlob<Record<string, NodeData>>(`${options.storageNS}::nodesData`).catch(() => null),
          readBlob<EdgeStoreUnion>(options.edgesUnionKey).catch(() => null),
          readBlob<EdgeStoreStrict>(options.edgesStrictKey).catch(() => null),
        ]);
        if (cancelled) return;
        if (idbNodes && Object.keys(idbNodes).length) {
          setNodesData((prev) => {
            let changed = false;
            const next = { ...prev };
            for (const [k, v] of Object.entries(idbNodes)) {
              if (!next[k]) {
                next[k] = v;
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        }
        if (idbEdgesUnion && Object.keys(idbEdgesUnion).length) {
          setEdgesUnion((prev) => ({ ...idbEdgesUnion, ...prev }));
        }
        if (idbEdgesStrict && Object.keys(idbEdgesStrict).length) {
          setEdgesStrict((prev) => ({ ...idbEdgesStrict, ...prev }));
        }
      } catch {
        // Ignore IDB errors; keep in-memory state only.
      } finally {
        if (!cancelled) setIdbHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [options.edgesStrictKey, options.edgesUnionKey, options.storageNS]);

  useEffect(() => {
    if (!USE_INDEXEDDB_CACHE || !isIndexedDBSupported()) return;
    const handle = setTimeout(() => {
      writeBlob(`${options.storageNS}::nodesData`, nodesData).catch(() => {});
    }, 200);
    return () => clearTimeout(handle);
  }, [nodesData, options.storageNS]);

  useEffect(() => {
    if (!USE_INDEXEDDB_CACHE || !isIndexedDBSupported()) return;
    const handle = setTimeout(() => {
      writeBlob(options.edgesUnionKey, edgesUnion).catch(() => {});
    }, 200);
    return () => clearTimeout(handle);
  }, [edgesUnion, options.edgesUnionKey]);

  useEffect(() => {
    if (!USE_INDEXEDDB_CACHE || !isIndexedDBSupported()) return;
    const handle = setTimeout(() => {
      writeBlob(options.edgesStrictKey, edgesStrict).catch(() => {});
    }, 200);
    return () => clearTimeout(handle);
  }, [edgesStrict, options.edgesStrictKey]);

  useEffect(() => {
    setRootExists(false);
  }, [options.rootId]);

  useEffect(() => {
    if (options.refreshTick === 0) return;
    if (!options.rootId) {
      setReachableNodeIds([]);
      setRootExists(false);
      setProgress(undefined);
      if (typeof options.rootHash === "string" && options.rootHash) {
        setContractMessage(options.t("familyTree.status.rootNotFound"));
      }
      return;
    }
    if (!options.contract) return;
    if (!idbHydrated) return;

    const runKey = buildTreeFetchRunKey({
      rootId: options.rootId,
      childrenMode: options.childrenMode,
      strictIncludeUnversionedChildren: options.strictIncludeUnversionedChildren,
      traversal: options.traversal,
      refreshTick: options.refreshTick,
    });
    if (fetchRunKeyRef.current === runKey) return;

    let cancelled = false;
    const controller = new AbortController();
    const checkAbort = () => {
      if (cancelled || controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
    };

    debugStatsRef.current.edgeCacheHits = { strict: 0, union: 0 };
    debugStatsRef.current.edgeCacheMisses = { strict: 0, union: 0 };
    debugStatsRef.current.lastEdgeFetchAt = {};
    debugStatsRef.current.totalVersionsCacheHits = 0;
    debugStatsRef.current.totalVersionsCacheMisses = 0;
    debugStatsRef.current.lastTotalVersionsFetchAt = undefined;

    const { loadChildrenStrict, loadChildrenUnion } = createTreeSessionEdgeLoaders({
      api: options.api,
      getEdgesStrict: () => edgesStrictRef.current,
      getEdgesUnion: () => edgesUnionRef.current,
      edgeTtlMs: options.edgeTtlMs,
      totalVersionsTtlMs: options.totalVersionsTtlMs,
      childrenPageLimit: options.childrenPageLimit,
      checkAbort,
      onStrictFetched: (fetchedAt) => {
        debugStatsRef.current.lastEdgeFetchAt.strict = fetchedAt;
      },
      onUnionFetched: (fetchedAt) => {
        debugStatsRef.current.lastEdgeFetchAt.union = fetchedAt;
      },
      onTotalVersionsCacheHit: () => {
        debugStatsRef.current.totalVersionsCacheHits += 1;
      },
      onTotalVersionsCacheMiss: () => {
        debugStatsRef.current.totalVersionsCacheMisses += 1;
      },
      onTotalVersionsFetched: (fetchedAt) => {
        debugStatsRef.current.lastTotalVersionsFetchAt = fetchedAt;
      },
      onTotalVersions: (personHash, totalVersions) => {
        setNodesData((prev) => applyTotalVersionsToNodes(prev, personHash, totalVersions));
      },
    });

    const { revalidateStrict, revalidateUnion } = createTreeEdgeRevalidators({
      edgeRevalidate: edgeRevalidateRef.current,
      loadChildrenStrict,
      loadChildrenUnion,
      getReachableNodeIds: () => reachableNodeIdsRef.current,
      setNodesData,
      setReachableNodeIds,
      setEdgesStrict,
      setEdgesUnion,
    });

    (async () => {
      setLoading(true);
      setContractMessage("");
      setProgress(undefined);

      const startup = await verifyTreeSessionStartup({
        provider: options.provider,
        api: options.api,
        rootHash: String(options.rootHash || ""),
        rootVersionIndex: Number(options.rootVersionIndex),
        versionDetailsTtlMs: options.versionDetailsTtlMs,
      });

      if (!startup.ok) {
        if (!cancelled) {
          if (startup.status === "rateLimited") {
            setContractMessage(options.t("familyTree.status.rateLimited"));
          } else if (startup.status === "rootNotFound") {
            setContractMessage(options.t("familyTree.status.rootNotFound"));
          } else if (startup.status === "networkError") {
            setContractMessage(options.t("familyTree.status.networkError"));
          } else {
            setContractMessage(options.t("familyTree.status.contractModeRootNotFound"));
          }
          if (startup.isRootInvalid) setRootExists(false);
          if (startup.stage === "root" && !stageLoggedRef.current.has("root_check")) {
            stageLoggedRef.current.add("root_check");
            options.push(startup.error as any, { stage: "root_check" });
          }
        }
        setLoading(false);
        return;
      }

      setRootExists(true);

      const runtimeCfg = getRuntimeFamilyTreeConfig();
      const hardNodeLimit = runtimeCfg.DEFAULT_HARD_NODE_LIMIT;

      const { visitedIds, progress: nextProgress } = await runTreeBuildSession({
        rootId: options.rootId!,
        traversal: options.traversal,
        childrenMode: options.childrenMode,
        strictIncludeUnversionedChildren: options.strictIncludeUnversionedChildren,
        hardNodeLimit,
        edgeTtlMs: options.edgeTtlMs,
        getCurrentNodes: () => nodesDataRef.current,
        getCurrentEdgesStrict: () => edgesStrictRef.current,
        getCurrentEdgesUnion: () => edgesUnionRef.current,
        loadChildrenStrict,
        loadChildrenUnion,
        checkAbort,
        onStrictCacheHit: () => {
          debugStatsRef.current.edgeCacheHits.strict += 1;
        },
        onStrictCacheMiss: () => {
          debugStatsRef.current.edgeCacheMisses.strict += 1;
        },
        onUnionCacheHit: () => {
          debugStatsRef.current.edgeCacheHits.union += 1;
        },
        onUnionCacheMiss: () => {
          debugStatsRef.current.edgeCacheMisses.union += 1;
        },
        onStrictStale: revalidateStrict,
        onUnionStale: revalidateUnion,
        onProgress: setProgress,
        onCommitNodes: (snapshot) => {
          setNodesData((prev) => applyTreeBuildNodeSnapshots(prev, snapshot));
        },
        onCommitEdgesUnion: (snapshot) => {
          setEdgesUnion((prev) => applyTreeBuildUnionSnapshots(prev, snapshot));
        },
        onCommitEdgesStrict: (snapshot) => {
          setEdgesStrict((prev) => applyTreeBuildStrictSnapshots(prev, snapshot));
        },
      });

      if (!cancelled) {
        setReachableNodeIds(visitedIds);
        setProgress(nextProgress);
        setContractMessage("");
        // Mark this runKey as fully built only on success, so an aborted run
        // (e.g. StrictMode dev double-mount) does not block a re-mount with
        // the same deps from restarting the build.
        fetchRunKeyRef.current = runKey;
      }
      setLoading(false);
    })().catch((error: any) => {
      if (!cancelled && error?.name !== "AbortError") {
        options.push(error, { stage: "build_session" });
      }
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    options.api,
    options.childrenMode,
    options.childrenPageLimit,
    options.contract,
    options.edgeTtlMs,
    options.provider,
    options.push,
    options.refreshTick,
    options.rootHash,
    options.rootId,
    options.rootVersionIndex,
    options.strictIncludeUnversionedChildren,
    options.t,
    options.totalVersionsTtlMs,
    options.traversal,
    options.versionDetailsTtlMs,
    idbHydrated,
  ]);

  const nodePairs = useMemo(() => {
    if (!reachableNodeIds.length) return [] as Array<{ h: string; v: number }>;
    return reachableNodeIds.map((id) => {
      const [personHash, rawVersionIndex] = String(id).split("-v-");
      return { h: personHash, v: Number(rawVersionIndex) };
    });
  }, [reachableNodeIds]);

  useEffect(() => {
    setEndorsementsReady(false);
  }, [options.rootId, options.childrenMode, nodePairs.length]);

  useEffect(() => {
    if (loading || !options.contract || !options.api || nodePairs.length === 0) return;
    let cancelled = false;
    (async () => {
      let snapshot: Record<string, NodeData> | null = null;
      if (USE_INDEXEDDB_CACHE && isIndexedDBSupported()) {
        try {
          snapshot = await readBlob<Record<string, NodeData>>(`${options.storageNS}::nodesData`);
        } catch {
          snapshot = null;
        }
      }

      try {
        const allSatisfied = nodePairs.every((pair) => {
          const id = `${pair.h}-v-${pair.v}`;
          const node = nodesDataRef.current[id] || (snapshot ? snapshot[id] : undefined);
          return isVersionDetailsFresh(node, options.versionDetailsTtlMs);
        });
        if (allSatisfied) {
          if (!cancelled) setEndorsementsReady(true);
          if (snapshot) {
            const { backfills } = planNodeEnrichmentSlice({
              slice: nodePairs,
              snapshot,
              currentNodes: nodesDataRef.current,
              versionDetailsTtlMs: options.versionDetailsTtlMs,
            });
            setNodesData((prev) => applyNodeDataBackfills(prev, backfills));
          }
          return;
        }
      } catch {}

      for (let i = 0; i < nodePairs.length && !cancelled; i += 40) {
        const slice = nodePairs.slice(i, i + 40);
        const { backfills, targets } = planNodeEnrichmentSlice({
          slice,
          snapshot,
          currentNodes: nodesDataRef.current,
          versionDetailsTtlMs: options.versionDetailsTtlMs,
        });
        if (Object.keys(backfills).length > 0) {
          setNodesData((prev) => applyNodeDataBackfills(prev, backfills));
        }
        if (targets.length === 0) continue;
        try {
          const { patches, nftErrors } = await fetchNodeEnrichmentBatch({
            targets,
            api: options.api,
            versionDetailsTtlMs: options.versionDetailsTtlMs,
            nftDetailsTtlMs: options.nftDetailsTtlMs,
            getVersionDetailsFetchedAt: (pair) =>
              options.queryCacheRef.current.getEntry(vdKey(pair.h, pair.v))?.fetchedAt ??
              Date.now(),
            getCurrentNode: (id) => nodesDataRef.current[id],
            readStoryMetadata: async (tokenId) => {
              const metadata = await options.contract.getStoryMetadata(tokenId);
              return {
                totalChunks: Number(metadata.totalChunks),
                totalLength: Number(metadata.totalLength),
                isSealed: Boolean(metadata.isSealed),
                lastUpdateTime: Number(metadata.lastUpdateTime),
                fullStoryHash: metadata.fullStoryHash,
              };
            },
          });

          if (patches.length > 0) {
            setNodesData((prev) => applyNodeEnrichmentPatches(prev, patches));
          }

          if (nftErrors.length > 0 && !stageLoggedRef.current.has("nft_details_batch")) {
            stageLoggedRef.current.add("nft_details_batch");
            options.push((nftErrors[0]?.error ?? new Error("nft_details_batch")) as any, {
              stage: "nft_details_batch",
            });
          }
        } catch (error) {
          if (!stageLoggedRef.current.has("counts_batch")) {
            stageLoggedRef.current.add("counts_batch");
            options.push(error as any, { stage: "counts_batch" });
          }
        }
      }

      if (!cancelled) setEndorsementsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    loading,
    nodePairs,
    options.api,
    options.contract,
    options.nftDetailsTtlMs,
    options.push,
    options.queryCacheRef,
    options.storageNS,
    options.versionDetailsTtlMs,
  ]);

  useEffect(() => {
    if (!options.contract || !options.rootId) return;
    let cancelled = false;
    (async () => {
      const h = options.rootHash;
      const v = Number(options.rootVersionIndex);
      if (!h || !/^0x[0-9a-fA-F]{64}$/.test(h) || !Number.isFinite(v) || v <= 0) return;
      try {
        const out: any = await options.contract.listPersonVersions(h, 0, 0);
        const totalVersions = parseTotalVersionsResult(out);
        if (!Number.isFinite(totalVersions) || totalVersions <= 1) return;
        if (cancelled) return;
        setNodesData((prev) =>
          applyTotalVersionsToNodes(prev, h, totalVersions, {
            ensureNode: { versionIndex: v },
          }),
        );
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [options.contract, options.rootHash, options.rootId, options.rootVersionIndex]);

  return {
    idbHydrated,
    nodesData,
    setNodesData,
    nodesDataRef,
    edgesUnion,
    setEdgesUnion,
    edgesUnionRef,
    edgesStrict,
    setEdgesStrict,
    edgesStrictRef,
    reachableNodeIds,
    setReachableNodeIds,
    reachableNodeIdsRef,
    loading,
    setLoading,
    rootExists,
    setRootExists,
    progress,
    setProgress,
    contractMessage,
    setContractMessage,
    endorsementsReady,
    debugStatsRef,
    getDebugStats,
  };
}

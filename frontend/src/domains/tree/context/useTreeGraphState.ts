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
  makeNodeId,
  type NodeData,
  type NodeId,
  parseNodeId,
  planNodeEnrichmentSlice,
} from "../../../shared/model";
import type { EdgeStoreStrict, EdgeStoreUnion } from "../model/treeStore";
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
import {
  captureTreeNodesPersistenceRevision,
  readTreeNodesSnapshot,
  writeTreeNodesSnapshot,
} from "../services/treeNodesPersistence";
import {
  collectParentRefs,
  resolveBestSpouseVersion,
  runSpouseEnrichment,
} from "../services/spouseEnrichment";
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
  trustedSourceFilterEnabled: boolean;
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
  trustedFilterActive: boolean;
  spouseVersionResolution: Map<string, number>;
  debugStatsRef: React.MutableRefObject<TreeDebugStats>;
  getDebugStats: () => TreeDebugStats;
}

export function useTreeGraphState(options: UseTreeGraphStateOptions): TreeGraphStateResult {
  const storageScopeRef = useRef({ storageNS: options.storageNS, generation: 0 });
  if (storageScopeRef.current.storageNS !== options.storageNS) {
    storageScopeRef.current = {
      storageNS: options.storageNS,
      generation: storageScopeRef.current.generation + 1,
    };
  }
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
  // True when the root version exposes trusted endorsers, so the build session filters
  // out versions not endorsed by a trusted source. The view layer reads this to restrict
  // projection to the reachable (visible) set instead of the raw, unfiltered edge stores.
  const [trustedFilterActive, setTrustedFilterActive] = useState(false);

  // Resolution cache for spouse (co-parent) enrichment: hashLower → resolved version, so an
  // unversioned (v0) co-parent reference maps to a concrete version once resolved. The view layer
  // reads this to align spouse node ids; the refs avoid re-resolving / re-fetching across re-runs.
  const [spouseVersionResolution, setSpouseVersionResolution] = useState<Map<string, number>>(
    () => new Map(),
  );
  const spouseVersionResolutionRef = useRef(spouseVersionResolution);
  useEffect(() => {
    spouseVersionResolutionRef.current = spouseVersionResolution;
  }, [spouseVersionResolution]);
  const spouseUnresolvableRef = useRef<Set<string>>(new Set());
  const spouseEnrichInflightRef = useRef<Set<string>>(new Set());

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
    // Spouse caches are keyed by person hash only, so drop them too: a v0 spouse resolution
    // (or "unresolvable" mark) from the previous chain/contract must not leak into the new scope.
    setSpouseVersionResolution(new Map());
    spouseUnresolvableRef.current = new Set();
    spouseEnrichInflightRef.current = new Set();
  }, [options.storageNS]);

  useEffect(() => {
    if (!USE_INDEXEDDB_CACHE || !isIndexedDBSupported()) {
      setIdbHydrated(true);
      return;
    }
    setIdbHydrated(false);
    let cancelled = false;
    const hydrationScope = options.storageNS;
    const hydrationGeneration = storageScopeRef.current.generation;
    const isCurrentHydration = () =>
      !cancelled &&
      storageScopeRef.current.storageNS === hydrationScope &&
      storageScopeRef.current.generation === hydrationGeneration;
    (async () => {
      try {
        const [idbNodes, idbEdgesUnion, idbEdgesStrict] = await Promise.all([
          readTreeNodesSnapshot(`${options.storageNS}::nodesData`).catch(() => null),
          readBlob<EdgeStoreUnion>(options.edgesUnionKey).catch(() => null),
          readBlob<EdgeStoreStrict>(options.edgesStrictKey).catch(() => null),
        ]);
        if (!isCurrentHydration()) return;
        if (idbNodes && Object.keys(idbNodes).length) {
          setNodesData((prev) => {
            if (!isCurrentHydration()) return prev;
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
          setEdgesUnion((prev) => (isCurrentHydration() ? { ...idbEdgesUnion, ...prev } : prev));
        }
        if (idbEdgesStrict && Object.keys(idbEdgesStrict).length) {
          setEdgesStrict((prev) => (isCurrentHydration() ? { ...idbEdgesStrict, ...prev } : prev));
        }
      } catch {
        // Ignore IDB errors; keep in-memory state only.
      } finally {
        if (isCurrentHydration()) setIdbHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [options.edgesStrictKey, options.edgesUnionKey, options.storageNS]);

  useEffect(() => {
    if (!USE_INDEXEDDB_CACHE || !isIndexedDBSupported()) return;
    const storageKey = `${options.storageNS}::nodesData`;
    const revision = captureTreeNodesPersistenceRevision(storageKey);
    const handle = setTimeout(() => {
      writeTreeNodesSnapshot(storageKey, nodesData, revision).catch(() => {});
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
      trustedSourceFilterEnabled: options.trustedSourceFilterEnabled,
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
          setTrustedFilterActive(false);
        }
        setLoading(false);
        return;
      }

      // Mount the tree view as soon as the root is confirmed to exist — before the trusted-source
      // lookup — so the build session's incremental commits stream in node-by-node again instead
      // of the whole tree only appearing after every node has loaded. A trusted filter that hides
      // the root revokes this below via setRootExists(false).
      if (!cancelled) setRootExists(true);

      const runtimeCfg = getRuntimeFamilyTreeConfig();
      const hardNodeLimit = runtimeCfg.DEFAULT_HARD_NODE_LIMIT;
      const trustedSourceAccounts = options.trustedSourceFilterEnabled
        ? await options.api.listTrustedEndorsersAll(
            String(options.rootHash || ""),
            Number(options.rootVersionIndex),
            { pageLimit: options.childrenPageLimit, checkAbort, ttlMs: options.edgeTtlMs },
          )
        : [];
      const hasTrustedFilter =
        options.trustedSourceFilterEnabled && trustedSourceAccounts.length > 0;
      if (!cancelled) setTrustedFilterActive(hasTrustedFilter);
      const isNodeVisible = hasTrustedFilter
        ? async (nodeId: NodeId) => {
            const parsed = parseNodeId(nodeId);
            return options.api.isVersionEndorsedByAny(
              parsed.personHash,
              parsed.versionIndex,
              trustedSourceAccounts,
              { ttlMs: options.versionDetailsTtlMs },
            );
          }
        : undefined;

      if (isNodeVisible && !(await isNodeVisible(options.rootId!))) {
        if (!cancelled) {
          setRootExists(false);
          setReachableNodeIds([]);
          setProgress({ created: 0, visited: 0, depth: 0 });
          setContractMessage(
            options.t(
              "familyTree.status.rootNotTrustedEndorsed",
              "The current root version is not endorsed by any recommended source.",
            ),
          );
          fetchRunKeyRef.current = runKey;
        }
        setLoading(false);
        return;
      }

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
        isNodeVisible,
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
        // With a trusted-source filter active, the projection restricts rendering to
        // reachableNodeIds; without streaming the visited set it stays empty until the build
        // finishes, collapsing the tree to nothing mid-build and making nodes appear all at once
        // instead of drawing in progressively. Non-filtered builds project straight from the edge
        // stores, so they already draw incrementally and need no early reachable updates.
        onCommitReachable: hasTrustedFilter
          ? (ids) => {
              if (!cancelled) setReachableNodeIds(ids);
            }
          : undefined,
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
    options.trustedSourceFilterEnabled,
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
    const effectScope = options.storageNS;
    const effectGeneration = storageScopeRef.current.generation;
    const isCurrentScope = () =>
      !cancelled &&
      storageScopeRef.current.storageNS === effectScope &&
      storageScopeRef.current.generation === effectGeneration;
    (async () => {
      let snapshot: Record<string, NodeData> | null = null;
      if (USE_INDEXEDDB_CACHE && isIndexedDBSupported()) {
        try {
          snapshot = await readTreeNodesSnapshot(`${effectScope}::nodesData`);
        } catch {
          snapshot = null;
        }
      }
      if (!isCurrentScope()) return;

      try {
        const allSatisfied = nodePairs.every((pair) => {
          const id = `${pair.h}-v-${pair.v}`;
          const node = nodesDataRef.current[id] || (snapshot ? snapshot[id] : undefined);
          return isVersionDetailsFresh(node, options.versionDetailsTtlMs);
        });
        if (allSatisfied) {
          if (!isCurrentScope()) return;
          setEndorsementsReady(true);
          if (snapshot) {
            const { backfills } = planNodeEnrichmentSlice({
              slice: nodePairs,
              snapshot,
              currentNodes: nodesDataRef.current,
              versionDetailsTtlMs: options.versionDetailsTtlMs,
            });
            if (!isCurrentScope()) return;
            setNodesData((prev) =>
              isCurrentScope() ? applyNodeDataBackfills(prev, backfills) : prev,
            );
          }
          return;
        }
      } catch {}

      for (let i = 0; i < nodePairs.length && isCurrentScope(); i += 40) {
        const slice = nodePairs.slice(i, i + 40);
        const { backfills, targets } = planNodeEnrichmentSlice({
          slice,
          snapshot,
          currentNodes: nodesDataRef.current,
          versionDetailsTtlMs: options.versionDetailsTtlMs,
        });
        if (Object.keys(backfills).length > 0) {
          if (!isCurrentScope()) return;
          setNodesData((prev) =>
            isCurrentScope() ? applyNodeDataBackfills(prev, backfills) : prev,
          );
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
            getCurrentNode: (id) => (isCurrentScope() ? nodesDataRef.current[id] : undefined),
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
          if (!isCurrentScope()) return;

          if (patches.length > 0) {
            setNodesData((prev) =>
              isCurrentScope() ? applyNodeEnrichmentPatches(prev, patches) : prev,
            );
          }

          if (
            isCurrentScope() &&
            nftErrors.length > 0 &&
            !stageLoggedRef.current.has("nft_details_batch")
          ) {
            stageLoggedRef.current.add("nft_details_batch");
            options.push((nftErrors[0]?.error ?? new Error("nft_details_batch")) as any, {
              stage: "nft_details_batch",
            });
          }
        } catch (error) {
          if (isCurrentScope() && !stageLoggedRef.current.has("counts_batch")) {
            stageLoggedRef.current.add("counts_batch");
            options.push(error as any, { stage: "counts_batch" });
          }
        }
      }

      if (isCurrentScope()) setEndorsementsReady(true);
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

  // Spouse (co-parent) enrichment: once descendants are loaded, fetch the names of people referenced
  // as a child's other parent but never traversed (married-in spouses). Reuses the same batch fetch
  // as descendants; an unversioned (v0) reference is resolved to a best version, cached so the view
  // layer can map v0 → version. Scans only reachable descendants (one layer), so fetched spouses
  // don't recurse into their own ancestors and re-runs settle once every co-parent is fetched.
  useEffect(() => {
    if (loading || !endorsementsReady || !options.contract || !options.api) return;
    let cancelled = false;
    void runSpouseEnrichment({
      parentRefs: collectParentRefs(nodesDataRef.current, reachableNodeIdsRef.current),
      isFetched: (h, v) =>
        isVersionDetailsFresh(nodesDataRef.current[makeNodeId(h, v)], options.versionDetailsTtlMs),
      resolution: spouseVersionResolutionRef.current,
      unresolvable: spouseUnresolvableRef.current,
      inflight: spouseEnrichInflightRef.current,
      resolveBestVersion: (h) =>
        resolveBestSpouseVersion(h, (hash) =>
          options.api.listVersionEndorsementsAll(hash, { pageLimit: options.childrenPageLimit }),
        ),
      fetchBatch: async (slice) => {
        const { patches } = await fetchNodeEnrichmentBatch({
          targets: slice.map((ref) => ({ h: ref.personHash, v: ref.versionIndex })),
          api: options.api,
          versionDetailsTtlMs: options.versionDetailsTtlMs,
          nftDetailsTtlMs: options.nftDetailsTtlMs,
          getVersionDetailsFetchedAt: () => Date.now(),
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
        return patches;
      },
      applyResolutions: (newResolutions) => {
        setSpouseVersionResolution((prev) => {
          const next = new Map(prev);
          for (const [hashLower, version] of newResolutions) next.set(hashLower, version);
          return next;
        });
      },
      applyPatches: (patches) => {
        setNodesData((prev) => applyNodeEnrichmentPatches(prev, patches));
      },
      reportError: (error, stage) => {
        if (!stageLoggedRef.current.has(stage)) {
          stageLoggedRef.current.add(stage);
          options.push(error as any, { stage });
        }
      },
      isCancelled: () => cancelled,
    });
    return () => {
      cancelled = true;
    };
  }, [
    loading,
    endorsementsReady,
    nodesData,
    reachableNodeIds,
    options.api,
    options.contract,
    options.childrenPageLimit,
    options.nftDetailsTtlMs,
    options.push,
    options.versionDetailsTtlMs,
  ]);

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
    trustedFilterActive,
    spouseVersionResolution,
    debugStatsRef,
    getDebugStats,
  };
}

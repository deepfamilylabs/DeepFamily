import React, { useMemo, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTreeData } from "../context/TreeDataContext";
import { useVizOptions } from "../context/VizOptionsContext";
import { useConfig } from "../context/ConfigContext";
import { isIndexedDBSupported } from "../utils/idbCache";

function formatMs(ms: number) {
  if (!Number.isFinite(ms)) return "-";
  if (ms >= 60_000) return `${Math.round(ms / 1000)}s`;
  return `${ms}ms`;
}

export default function TreeDebugPanel() {
  const { nodesData, edgesUnion, edgesStrict, reachableNodeIds, loading, progress, getDebugStats } =
    useTreeData();
  const { childrenMode, deduplicateChildren, strictIncludeUnversionedChildren, traversal } =
    useVizOptions();
  const { rpcUrl, contractAddress, rootHash, rootVersionIndex } = useConfig();
  const env: any = (import.meta as any).env || {};
  const edgeTTL = Number(env.VITE_DF_EDGE_TTL_MS || 120_000);
  const tvTTL = Number(env.VITE_DF_TV_TTL_MS || 60_000);
  const vdTTL = Number(env.VITE_DF_VD_TTL_MS || 300_000);
  const nftTTL = Number(env.VITE_DF_NFT_TTL_MS || 86_400_000);
  const storyTTL = Number(env.VITE_DF_STORY_TTL_MS || 300_000);
  const queryPageLimit = Number(env.VITE_DF_QUERY_PAGE_LIMIT || 200);
  const idbEnabled =
    env.VITE_USE_INDEXEDDB_CACHE !== "0" && env.VITE_USE_INDEXEDDB_CACHE !== "false";
  const [debugStats, setDebugStats] = useState(() => {
    const snap = getDebugStats();
    return {
      inflightCount: snap.inflightCount,
      edgeCacheHits: { ...snap.edgeCacheHits },
      edgeCacheMisses: { ...snap.edgeCacheMisses },
      lastEdgeFetchAt: { ...snap.lastEdgeFetchAt },
      totalVersionsCacheHits: snap.totalVersionsCacheHits,
      totalVersionsCacheMisses: snap.totalVersionsCacheMisses,
      lastTotalVersionsFetchAt: snap.lastTotalVersionsFetchAt,
    };
  });

  const stats = useMemo(() => {
    const nodeCount = Object.keys(nodesData || {}).length;
    const unionCount = Object.keys(edgesUnion || {}).length;
    const strictCount = Object.keys(edgesStrict || {}).length;
    const reachable = reachableNodeIds?.length || 0;
    return { nodeCount, unionCount, strictCount, reachable };
  }, [edgesStrict, edgesUnion, nodesData, reachableNodeIds]);

  useEffect(() => {
    const handle = window.setInterval(() => {
      const snap = getDebugStats();
      setDebugStats({
        inflightCount: snap.inflightCount,
        edgeCacheHits: { ...snap.edgeCacheHits },
        edgeCacheMisses: { ...snap.edgeCacheMisses },
        lastEdgeFetchAt: { ...snap.lastEdgeFetchAt },
        totalVersionsCacheHits: snap.totalVersionsCacheHits,
        totalVersionsCacheMisses: snap.totalVersionsCacheMisses,
        lastTotalVersionsFetchAt: snap.lastTotalVersionsFetchAt,
      });
    }, 500);
    return () => window.clearInterval(handle);
  }, [getDebugStats]);

  const strictFetchAge = debugStats.lastEdgeFetchAt.strict
    ? Date.now() - debugStats.lastEdgeFetchAt.strict
    : NaN;
  const unionFetchAge = debugStats.lastEdgeFetchAt.union
    ? Date.now() - debugStats.lastEdgeFetchAt.union
    : NaN;
  const tvFetchAge = debugStats.lastTotalVersionsFetchAt
    ? Date.now() - debugStats.lastTotalVersionsFetchAt
    : NaN;

  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="text-xs rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm shadow-sm px-3 py-1.5 space-y-2">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-left text-slate-700 dark:text-slate-200 group"
        aria-expanded={!collapsed}
      >
        <span className="font-semibold group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">Tree Debug</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${collapsed ? "" : "rotate-180"}`} />
      </button>
      {collapsed ? null : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Info
              label="Nodes"
              value={stats.nodeCount}
              title="Total NodeData entries cached for this RPC + contract."
            />
            <Info
              label="Reachable"
              value={stats.reachable}
              title="Nodes reached by the latest build session from the current root."
            />
            <Info
              label="Edges (Union)"
              value={stats.unionCount}
              title="Union edge cache entries keyed by parent hash."
            />
            <Info
              label="Edges (Strict)"
              value={stats.strictCount}
              title="Strict edge cache entries keyed by parent hash + version."
            />
            <Info
              label="Edge TTL"
              value={formatMs(edgeTTL)}
              title="Edge cache time-to-live before considered stale."
            />
            <Info
              label="TV TTL"
              value={formatMs(tvTTL)}
              title="Total-versions cache time-to-live before considered stale."
            />
            <Info
              label="VD TTL"
              value={formatMs(vdTTL)}
              title="Version-details time-to-live before considered stale."
            />
            <Info
              label="NFT TTL"
              value={formatMs(nftTTL)}
              title="NFT-details time-to-live before considered stale."
            />
            <Info
              label="Story TTL"
              value={formatMs(storyTTL)}
              title="Story cache time-to-live before considered stale."
            />
            <Info
              label="Page Limit"
              value={queryPageLimit}
              title="Max items per paginated contract query (capped at 100)."
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Info
              label="Inflight"
              value={debugStats.inflightCount}
              title="Active cached queries currently in progress."
            />
            <Info
              label="Strict hit/miss"
              value={`${debugStats.edgeCacheHits.strict}/${debugStats.edgeCacheMisses.strict}`}
              title="Strict edge cache hits vs misses in this build session."
              mono
            />
            <Info
              label="Union hit/miss"
              value={`${debugStats.edgeCacheHits.union}/${debugStats.edgeCacheMisses.union}`}
              title="Union edge cache hits vs misses in this build session."
              mono
            />
            <Info
              label="Last fetch (S)"
              value={formatMs(strictFetchAge)}
              title="Time since last strict edge fetch."
            />
            <Info
              label="Last fetch (U)"
              value={formatMs(unionFetchAge)}
              title="Time since last union edge fetch."
            />
            <Info
              label="TV hit/miss"
              value={`${debugStats.totalVersionsCacheHits}/${debugStats.totalVersionsCacheMisses}`}
              title="Total-versions cache hits vs misses in this build session."
              mono
            />
            <Info
              label="Last fetch (TV)"
              value={formatMs(tvFetchAge)}
              title="Time since last total-versions fetch."
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Info
              label="Traversal"
              value={traversal}
              title="Build session traversal order (dfs or bfs)."
            />
            <Info
              label="Children"
              value={
                childrenMode +
                (childrenMode === "strict" && strictIncludeUnversionedChildren ? " +v0" : "")
              }
              title="Edge mode used for children: union or strict (+v0 includes parentVersionIndex=0)."
            />
            <Info
              label="Dedup"
              value={deduplicateChildren ? "on" : "off"}
              title="Deduplicate siblings by childHash, selecting best endorsement."
            />
            <Info
              label="Loading"
              value={loading ? "yes" : "no"}
              title="Build session currently running."
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Info label="RPC" value={rpcUrl || "n/a"} title="Current RPC endpoint." mono />
            <Info
              label="Contract"
              value={contractAddress || "n/a"}
              title="Current contract address."
              mono
            />
            <Info
              label="Root"
              value={rootHash ? `${rootHash}#${rootVersionIndex}` : "n/a"}
              title="Current root person hash and version."
              mono
            />
          </div>
          {progress ? (
            <div className="grid grid-cols-3 gap-2">
              <Info
                label="Visited"
                value={progress.visited}
                title="Nodes visited during the latest build session."
              />
              <Info
                label="Depth"
                value={progress.depth}
                title="Maximum depth reached in the latest build session."
              />
              <Info
                label="Created"
                value={progress.created}
                title="Nodes inserted into NodeStore during the latest build session."
              />
            </div>
          ) : null}
          <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span title="Persistent cache backend availability.">IndexedDB:</span>
            <span
              className={`font-mono px-1 rounded ${idbEnabled && isIndexedDBSupported() ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200"}`}
            >
              {idbEnabled && isIndexedDBSupported() ? "enabled" : "disabled"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function Info({
  label,
  value,
  mono,
  title,
}: {
  label: string;
  value: any;
  mono?: boolean;
  title?: string;
}) {
  return (
    <div className="flex flex-col" title={title}>
      <span className="text-[10px] text-slate-500 dark:text-slate-400">{label}</span>
      <span
        className={`text-[11px] text-slate-800 dark:text-slate-200 ${mono ? "font-mono break-all" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

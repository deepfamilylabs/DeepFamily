import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ColorThemeProvider,
  MetadataUnlockControl,
  TreeDebugPanel,
  TreeInteractionProvider,
  useMetadataUnlockScope,
  useTreeGraphData,
  useTreeMutations,
  useTreeNodeAccess,
  useTreeStatus,
  ViewContainer,
} from "../domains/tree";
import {
  EndorseModalProvider,
  NodeDetailProvider,
  useTrustedEndorserAccess,
  useEndorseModal,
  useNodeDetail,
} from "../domains/person";
import { useConfig } from "../domains/config";
import { FamilySettingsDrawer } from "./family/FamilySettingsDrawer";
import { TreePageBar } from "./tree/sections/TreePageBar";
import { TreeStatsPill } from "./tree/ui/TreeStatsPill";
import { isTreeDebugEnabled, shouldPreferFlatTree } from "../shared/config/env";
import { makeNodeId, type NodeKeyMinimal } from "../shared/model";

/**
 * TreePage is intentionally a thin UI shell. The actual "data -> UI" pipeline is:
 *
 * Data (L3) — `frontend/src/domains/tree/context`:
 * - `TreeViewProvider` and the narrow tree hooks own JSON-RPC / on-chain reads for nodes, edges, and details.
 *
 * Caching (L1/L2):
 * - L1 in-memory `QueryCache` (`frontend/src/shared/cache/QueryCache.ts`): TTL + inflight de-dupe.
 * - L2 optional IndexedDB (`frontend/src/shared/cache/persistence.ts`): persisted `nodesData` + edge stores,
 *   hydrated async and then revalidated.
 *
 * Projection (view-model) — `frontend/src/domains/tree/ui/useFamilyTreeViewModel.ts` + `frontend/src/domains/tree/selectors`:
 * - Builds a projected graph via the tree selector layer (`buildViewGraphData`, tree rows, totals).
 *
 * Rendering (UI) — `frontend/src/domains/tree/ui/ViewContainer.tsx`:
 * - Swaps view implementations (Tree/DAG/Virtual), all consuming the same projected graph.
 */
function usePersistedViewMode() {
  const [viewMode, setViewMode] = useState<"dag" | "tree" | "virtual">(() => {
    const preferFlat = shouldPreferFlatTree();
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("df:viewMode");
      if (saved === "dag" || saved === "tree" || saved === "virtual") return saved as any;
    }
    return preferFlat ? "virtual" : "tree";
  });

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("df:viewMode", viewMode);
  }, [viewMode]);

  return { viewMode, setViewMode };
}

function TreeInteractionBridge({ children }: { children: ReactNode }) {
  const { openNode, selected } = useNodeDetail();
  const { openEndorse } = useEndorseModal();

  const copyHash = useCallback((personHash: string) => {
    if (typeof navigator === "undefined") return;
    navigator.clipboard?.writeText(personHash).catch(() => {});
  }, []);

  const interaction = useMemo(
    () => ({
      selectedNode: selected,
      openNode,
      openEndorse,
      copyHash,
    }),
    [copyHash, openEndorse, openNode, selected],
  );

  return <TreeInteractionProvider value={interaction}>{children}</TreeInteractionProvider>;
}

function TreeMetadataUnlockControl(props: ComponentProps<typeof MetadataUnlockControl>) {
  const { selected } = useNodeDetail();
  return (
    <MetadataUnlockControl
      {...props}
      priorityNodeId={selected ? makeNodeId(selected.personHash, selected.versionIndex) : undefined}
    />
  );
}

export default function TreePage() {
  const { viewMode, setViewMode } = usePersistedViewMode();

  const { t } = useTranslation();
  const { rootId, rootExists, nodesData } = useTreeGraphData();
  const { getOwnerOf } = useTreeNodeAccess();
  const { bumpEndorsementCount, invalidateByTx, mergeNodeDetail } = useTreeMutations();
  const {
    loading: loadingContract,
    progress,
    contractMessage,
    refresh,
    clearAllCaches,
  } = useTreeStatus();
  const {
    rootHash,
    rootVersionIndex,
    defaults,
    update,
  } = useConfig();
  const [metadataUnlockOpen, setMetadataUnlockOpen] = useState(false);
  const [metadataUnlockTarget, setMetadataUnlockTarget] = useState<NodeKeyMinimal | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const showDebugPanel = useMemo(() => isTreeDebugEnabled(), []);
  const hasRoot = Boolean(rootId && rootExists);
  // Mirrors the dialog's own tally so the bar button can carry it as a badge.
  const { unlockedCount } = useMetadataUnlockScope();
  // The bar names the genealogy you are looking at. Until the root's metadata is readable that name
  // is still a hash — the same thing the node cards fall back to.
  const rootLabel = useMemo(() => {
    const fullName = (rootId ? nodesData[rootId]?.fullName : "")?.trim();
    if (fullName) return fullName;
    const hash = (rootHash || "").trim();
    return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
  }, [nodesData, rootHash, rootId]);
  const onTrustedEndorsersChanged = useCallback(() => {
    clearAllCaches();
    refresh();
  }, [clearAllCaches, refresh]);
  const trustedEndorserAccess = useTrustedEndorserAccess(onTrustedEndorsersChanged);

  return (
    <ColorThemeProvider>
      <EndorseModalProvider
        onEndorseSuccess={(target, delta, receipt) => {
          bumpEndorsementCount(target.personHash, target.versionIndex, delta);
          invalidateByTx({
            receipt,
            hints: { personHash: target.personHash, versionIndex: target.versionIndex },
          });
        }}
      >
        <NodeDetailProvider
          nodesData={nodesData}
          getOwnerOf={getOwnerOf}
          trustedEndorserAccess={trustedEndorserAccess}
          onRequestMetadataUnlock={(selected) => {
            setMetadataUnlockTarget(selected);
            setMetadataUnlockOpen(true);
          }}
          mergeNodeDetail={mergeNodeDetail}
        >
          <TreeInteractionBridge>
            <div className="relative flex h-[calc(100vh-var(--app-header-h)-var(--app-statusbar-h))] w-full flex-col overflow-hidden bg-surface">
              <TreePageBar
                t={t}
                rootLabel={rootLabel}
                rootVersion={Number(rootVersionIndex || 1)}
                hasRoot={hasRoot}
                peopleCount={progress?.created || 0}
                generationCount={progress?.depth || 0}
                loading={loadingContract}
                unlockedCount={unlockedCount}
                onOpenUnlock={() => {
                  setMetadataUnlockTarget(null);
                  setMetadataUnlockOpen(true);
                }}
                onRefresh={refresh}
                onClearCaches={clearAllCaches}
                configOpen={configOpen}
                onToggleConfig={() => setConfigOpen((value) => !value)}
              />

              {/* Family settings share this push-on-desktop, overlay-on-mobile content row. */}
              <div className="relative flex min-h-0 flex-1 overflow-hidden">
                <FamilySettingsDrawer
                  t={t}
                  open={configOpen}
                  onClose={() => setConfigOpen(false)}
                />

                <div className="relative min-h-0 flex-1 overflow-hidden bg-surface-body">
                  <ViewContainer
                    viewMode={viewMode as any}
                    hasRoot={hasRoot}
                    contractMessage={contractMessage}
                    loading={loadingContract}
                    onViewModeChange={setViewMode}
                    viewModeLabels={{
                      tree: t("familyTree.viewModes.tree"),
                      dag: t("familyTree.viewModes.dag"),
                      virtual: t("familyTree.viewModes.virtual"),
                    }}
                    overlayLeading={
                      <TreeStatsPill
                        t={t}
                        peopleCount={progress?.created || 0}
                        generationCount={progress?.depth || 0}
                        className="md:hidden"
                      />
                    }
                  />
                  <TreeMetadataUnlockControl
                    open={metadataUnlockOpen}
                    target={metadataUnlockTarget}
                    onOpenChange={setMetadataUnlockOpen}
                    showTrigger={false}
                  />
                </div>
              </div>

              {showDebugPanel ? (
                <div className="absolute top-24 right-6 z-40 max-w-sm">
                  <TreeDebugPanel />
                </div>
              ) : null}
            </div>
          </TreeInteractionBridge>
        </NodeDetailProvider>
      </EndorseModalProvider>
    </ColorThemeProvider>
  );
}

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ColorThemeProvider,
  MetadataUnlockControl,
  TreeDebugPanel,
  TreeInteractionProvider,
  useTreeGraphData,
  useTreeMutations,
  useTreeNodeAccess,
  useTreeStatus,
  ViewContainer,
} from "../domains/tree";
import {
  EndorseModalProvider,
  NodeDetailProvider,
  type TrustedEndorserAccess,
  useEndorseModal,
  useNodeDetail,
} from "../domains/person";
import { useConfig } from "../domains/config";
import { useWallet } from "../domains/wallet";
import { TreeConfigDrawer } from "./tree/sections/TreeConfigDrawer";
import { TreePageBar } from "./tree/sections/TreePageBar";
import { TreeStatsPill } from "./tree/ui/TreeStatsPill";
import {
  isForceEnvConfigSyncEnabled,
  isTreeDebugEnabled,
  shouldPreferFlatTree,
} from "../shared/config/env";
import {
  createDeepFamilyContract,
  createDeepFamilyReaderContract,
} from "../shared/clients/contractFactory";
import { getReadonlyProvider } from "../shared/clients/providerRegistry";
import { isMetadataUnlockUsable } from "../shared/model";

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

export default function TreePage() {
  const { viewMode, setViewMode } = usePersistedViewMode();

  const { t } = useTranslation();
  const { rootId, rootExists, nodesData } = useTreeGraphData();
  const { getOwnerOf } = useTreeNodeAccess();
  const { address, signer } = useWallet();
  const { bumpEndorsementCount, invalidateByTx, mergeNodeDetail } = useTreeMutations();
  const {
    loading: loadingContract,
    progress,
    contractMessage,
    refresh,
    clearAllCaches,
  } = useTreeStatus();
  const {
    rpcUrl,
    chainId,
    contractAddress,
    readerAddress,
    rootHash,
    rootVersionIndex,
    defaults,
    update,
  } = useConfig();
  const [metadataUnlockOpen, setMetadataUnlockOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const forceEnvConfigSync = useMemo(() => isForceEnvConfigSyncEnabled(), []);
  const showDebugPanel = useMemo(() => isTreeDebugEnabled(), []);
  const hasRoot = Boolean(rootId && rootExists);
  // Mirrors the dialog's own tally so the bar button can carry it as a badge.
  const unlockedCount = useMemo(
    () => Object.values(nodesData).filter(isMetadataUnlockUsable).length,
    [nodesData],
  );
  // The bar names the genealogy you are looking at. Until the root's metadata is readable that name
  // is still a hash — the same thing the node cards fall back to.
  const rootLabel = useMemo(() => {
    const fullName = (rootId ? nodesData[rootId]?.fullName : "")?.trim();
    if (fullName) return fullName;
    const hash = (rootHash || "").trim();
    return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
  }, [nodesData, rootHash, rootId]);
  const trustedReader = useMemo(() => {
    if (!rpcUrl || !readerAddress) return null;
    try {
      return createDeepFamilyReaderContract(readerAddress, getReadonlyProvider(rpcUrl, chainId));
    } catch {
      return null;
    }
  }, [chainId, readerAddress, rpcUrl]);

  const trustedEndorserAccess = useMemo<TrustedEndorserAccess | undefined>(() => {
    if (!trustedReader) return undefined;
    const pageLimit = 200;
    return {
      connectedAddress: address,
      loadTrustedEndorsers: async (personHash, versionIndex) => {
        const accounts: string[] = [];
        let offset = 0;
        while (true) {
          const out = await trustedReader.listTrustedEndorsers(
            personHash,
            Number(versionIndex),
            offset,
            pageLimit,
          );
          accounts.push(...Array.from(out?.[0] || []).map(String));
          const hasMore = Boolean(out?.[2]);
          const nextOffset = Number(out?.[3] || 0);
          if (!hasMore || nextOffset === offset) break;
          offset = nextOffset;
        }
        return accounts;
      },
      addTrustedEndorser: async (personHash, versionIndex, account) => {
        if (!signer || !contractAddress) throw new Error("Wallet not connected");
        const contract = createDeepFamilyContract(contractAddress, signer);
        const tx = await contract.addTrustedEndorser(personHash, Number(versionIndex), account);
        await tx.wait();
        clearAllCaches();
        refresh();
      },
      removeTrustedEndorser: async (personHash, versionIndex, account) => {
        if (!signer || !contractAddress) throw new Error("Wallet not connected");
        const contract = createDeepFamilyContract(contractAddress, signer);
        const tx = await contract.removeTrustedEndorser(personHash, Number(versionIndex), account);
        await tx.wait();
        clearAllCaches();
        refresh();
      },
    };
  }, [address, clearAllCaches, contractAddress, refresh, signer, trustedReader]);

  useEffect(() => {
    if (!forceEnvConfigSync) return;
    const envRpcUrl = (defaults.rpcUrl || "").trim();
    const envReader = (defaults.readerAddress || "").trim();
    const envRootHash = (defaults.rootHash || "").trim();
    const envRootVersion = Number(defaults.rootVersionIndex);
    const envChainId = Number(defaults.chainId);

    // Nothing to enforce.
    if (!envRpcUrl && !envReader) return;

    const nextUpdate: any = {};
    const normalize = (v: string) => v.trim();
    const normalizeAddr = (v: string) => normalize(v).toLowerCase();
    const normalizeHash = (v: string) => normalize(v).toLowerCase();
    const isValidRootHash = (v: string) => /^0x[a-fA-F0-9]{64}$/.test(v);

    if (envRpcUrl && normalize(envRpcUrl) !== normalize(rpcUrl || ""))
      nextUpdate.rpcUrl = envRpcUrl;
    if (Number.isFinite(envChainId) && envChainId > 0 && envChainId !== Number(chainId || 0)) {
      nextUpdate.chainId = envChainId;
    }
    if (envReader && normalizeAddr(envReader) !== normalizeAddr(readerAddress || "")) {
      nextUpdate.readerAddress = envReader;
      nextUpdate.contractAddress = "";
      nextUpdate.tokenAddress = "";
    }
    const hasEnvRoot = isValidRootHash(envRootHash);
    if (hasEnvRoot && normalizeHash(envRootHash) !== normalizeHash(rootHash || "")) {
      nextUpdate.rootHash = envRootHash;
    }
    if (
      hasEnvRoot &&
      Number.isFinite(envRootVersion) &&
      envRootVersion >= 1 &&
      envRootVersion !== Number(rootVersionIndex || 0)
    ) {
      nextUpdate.rootVersionIndex = envRootVersion;
    }

    if (!Object.keys(nextUpdate).length) return;

    // Important: clear old namespace caches BEFORE updating config.
    clearAllCaches();
    update(nextUpdate);
    refresh();
  }, [
    forceEnvConfigSync,
    defaults.rpcUrl,
    defaults.readerAddress,
    defaults.rootHash,
    defaults.rootVersionIndex,
    defaults.chainId,
    rpcUrl,
    chainId,
    readerAddress,
    rootHash,
    rootVersionIndex,
    clearAllCaches,
    update,
    refresh,
  ]);

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
          onRequestMetadataUnlock={() => setMetadataUnlockOpen(true)}
          mergeNodeDetail={mergeNodeDetail}
        >
          <TreeInteractionBridge>
            <div className="relative flex h-[calc(100vh-4rem)] w-full flex-col overflow-hidden bg-surface">
              <TreePageBar
                t={t}
                rootLabel={rootLabel}
                rootVersion={Number(rootVersionIndex || 1)}
                hasRoot={hasRoot}
                peopleCount={progress?.created || 0}
                generationCount={progress?.depth || 0}
                loading={loadingContract}
                unlockedCount={unlockedCount}
                onOpenUnlock={() => setMetadataUnlockOpen(true)}
                onRefresh={refresh}
                onClearCaches={clearAllCaches}
                configOpen={configOpen}
                onToggleConfig={() => setConfigOpen((value) => !value)}
              />

              {/* Family settings share this push-on-desktop, overlay-on-mobile content row. */}
              <div className="relative flex min-h-0 flex-1 overflow-hidden">
                <TreeConfigDrawer t={t} open={configOpen} onClose={() => setConfigOpen(false)} />

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
                  <MetadataUnlockControl
                    open={metadataUnlockOpen}
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

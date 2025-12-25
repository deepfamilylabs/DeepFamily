import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import ViewContainer from "../components/ViewContainer";
import { useTreeData } from "../context/TreeDataContext";
import { useVizOptions } from "../context/VizOptionsContext";
import { useConfig } from "../context/ConfigContext";
import TreeDebugPanel from "../components/TreeDebugPanel";
import ViewModeSwitch from "../components/ViewModeSwitch";
import { Activity, Layers } from "lucide-react";

function toBool(val: any) {
  return val === "1" || val === "true" || val === true || val === "yes";
}

export default function TreePage() {
  const {
    traversal,
    setTraversal,
    deduplicateChildren,
    setDeduplicateChildren,
    childrenMode,
    setChildrenMode,
    strictIncludeUnversionedChildren,
    setStrictIncludeUnversionedChildren,
  } = useVizOptions();
  const [viewMode, setViewMode] = useState<"dag" | "tree" | "force" | "virtual">(() => {
    const preferFlat = toBool((import.meta as any).env.VITE_USE_FLAT_TREE);
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("df:viewMode");
      if (saved === "dag" || saved === "tree" || saved === "force" || saved === "virtual")
        return saved as any;
    }
    return preferFlat ? "virtual" : "tree";
  });

  const { t, i18n } = useTranslation();
  const {
    rootId,
    rootExists,
    loading: loadingContract,
    progress,
    contractMessage,
    refresh,
    clearAllCaches,
  } = useTreeData();
  const { contractAddress, rootHash, rootVersionIndex, defaults, update } = useConfig();
  const forceEnvConfigSync = useMemo(
    () => toBool((import.meta as any).env.VITE_FORCE_ENV_CONFIG_SYNC),
    [],
  );
  const showDebugPanel = useMemo(() => toBool((import.meta as any).env.VITE_SHOW_DEBUG), []);

  useEffect(() => {
    if (!forceEnvConfigSync) return;
    const envContract = (defaults.contractAddress || "").trim();
    const envRootHash = (defaults.rootHash || "").trim();
    const envRootVersion = defaults.rootVersionIndex;
    if (!envContract) return;

    const matchesContract =
      envContract.toLowerCase() === (contractAddress || "").trim().toLowerCase();
    if (matchesContract) return;

    clearAllCaches();
    const nextUpdate: any = { contractAddress: envContract, rootVersionIndex: envRootVersion };
    if (envRootHash) nextUpdate.rootHash = envRootHash;
    update(nextUpdate);
    refresh();
  }, [
    forceEnvConfigSync,
    defaults.contractAddress,
    defaults.rootHash,
    defaults.rootVersionIndex,
    contractAddress,
    rootHash,
    rootVersionIndex,
    clearAllCaches,
    update,
    refresh,
  ]);

  const triggerRefresh = useCallback(() => refresh(), [refresh]);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("df:viewMode", viewMode);
  }, [viewMode]);

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full overflow-hidden bg-white dark:bg-black">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Top Toolbar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-black z-10">
          <div className="flex items-center gap-4">
            <h2 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2 text-lg">
              <Layers className="w-5 h-5 text-orange-500 dark:text-orange-400" />
              <span>{t("familyTree.title", "Family Tree")}</span>
            </h2>

            {/* Stats Chips */}
            <div className="hidden md:flex items-center gap-3 text-xs font-medium">
              <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" />
                <span>Nodes: {progress?.created || 0}</span>
              </span>
              <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                Depth: {progress?.depth || 0}
              </span>
            </div>
          </div>

          {/* View Mode Switcher */}
          <ViewModeSwitch
            value={viewMode as any}
            onChange={setViewMode}
            labels={{
              tree: t("familyTree.viewModes.tree"),
              dag: t("familyTree.viewModes.dag"),
              force: t("familyTree.viewModes.force"),
              virtual: t("familyTree.viewModes.virtual"),
            }}
          />
        </div>

        {/* Visualization Area */}
        <div className="flex-1 relative bg-slate-50 dark:bg-slate-900/50 overflow-hidden">
          <ViewContainer
            viewMode={viewMode as any}
            hasRoot={!!rootId && rootExists}
            contractMessage={contractMessage}
            loading={loadingContract}
            onViewModeChange={setViewMode}
            viewModeLabels={{
              tree: t("familyTree.viewModes.tree"),
              dag: t("familyTree.viewModes.dag"),
              force: t("familyTree.viewModes.force"),
              virtual: t("familyTree.viewModes.virtual"),
            }}
            hideSwitch={true}
          />
        </div>
      </div>

      {showDebugPanel ? (
        <div className="absolute top-24 right-6 z-40 max-w-sm">
          <TreeDebugPanel />
        </div>
      ) : null}
    </div>
  );
}

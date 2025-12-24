import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import FamilyTreeConfigForm from "../components/FamilyTreeConfigForm";
import ViewContainer from "../components/ViewContainer";
import { useTreeData } from "../context/TreeDataContext";
import { useVizOptions } from "../context/VizOptionsContext";
import { useConfig } from "../context/ConfigContext";
import TreeDebugPanel from "../components/TreeDebugPanel";

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
  const [editingConfig, setEditingConfig] = useState(false);

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
    <div className="space-y-4 text-gray-900 dark:text-gray-100 overflow-visible pb-4 md:pb-0 w-full max-w-full">
      {/* Configuration Card - Minimal Design */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden transition-shadow duration-200 hover:shadow-md dark:hover:shadow-slate-900/50">
        <FamilyTreeConfigForm
          editing={editingConfig}
          setEditing={setEditingConfig}
          locale={i18n.language}
          contractMessage={contractMessage}
          loading={loadingContract}
          onRefresh={triggerRefresh}
          t={t as any}
          traversal={traversal}
          setTraversal={setTraversal}
          childrenMode={childrenMode}
          setChildrenMode={setChildrenMode}
          strictIncludeUnversionedChildren={strictIncludeUnversionedChildren}
          setStrictIncludeUnversionedChildren={setStrictIncludeUnversionedChildren}
          deduplicateChildren={deduplicateChildren}
          setDeduplicateChildren={setDeduplicateChildren}
          progress={progress}
        />
      </div>

      {showDebugPanel ? (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden p-4">
          <TreeDebugPanel />
        </div>
      ) : null}

      {/* Tree Visualization Card - Minimal Design */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden transition-shadow duration-200 hover:shadow-lg dark:hover:shadow-slate-900/60">
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
        />
      </div>
    </div>
  );
}

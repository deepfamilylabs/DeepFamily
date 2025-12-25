import { useState, useEffect, useMemo } from "react";
import { useDebounce } from "../hooks/useDebounce";
import { useTranslation } from "react-i18next";
import { useConfig } from "../context/ConfigContext";
import { formatHashMiddle, shortAddress } from "../types/graph";
import { Clipboard, HelpCircle } from "lucide-react";
import { useTreeData } from "../context/TreeDataContext";
import { useToast } from "./ToastProvider";
import { NETWORK_PRESETS } from "../config/networks";

export interface FamilyTreeConfigFormProps {
  editing: boolean;
  setEditing: (v: boolean) => void;
  // Status bar props
  contractMessage?: string;
  loading?: boolean;
  onRefresh?: () => void;
  t: any;
  // Traversal and stats props
  traversal: "dfs" | "bfs";
  setTraversal: (t: "dfs" | "bfs") => void;
  childrenMode: "union" | "strict";
  setChildrenMode: (v: "union" | "strict") => void;
  strictIncludeUnversionedChildren: boolean;
  setStrictIncludeUnversionedChildren: (v: boolean) => void;
  deduplicateChildren: boolean;
  setDeduplicateChildren: (value: boolean) => void;
  progress?: { created: number; visited: number; depth: number };
  locale?: string;
  alwaysShowExtras?: boolean;
  hideToggle?: boolean;
  hideHeader?: boolean;
}

const LOCALE_NEED_ZH_ROOT = new Set(["ja", "ko", "zh-cn", "zh-tw"]);
const CUSTOM_NETWORKS_KEY = "ft:customNetworks";

type NetworkOption = {
  chainId: number;
  name: string;
  rpcUrl: string;
  isCustom?: boolean;
};

function toBool(val: any) {
  return val === "1" || val === "true" || val === true || val === "yes";
}

export default function FamilyTreeConfigForm({
  editing,
  setEditing,
  contractMessage,
  loading,
  onRefresh,
  t: statusT,
  traversal,
  setTraversal,
  childrenMode,
  setChildrenMode,
  strictIncludeUnversionedChildren,
  setStrictIncludeUnversionedChildren,
  deduplicateChildren,
  setDeduplicateChildren,
  progress,
  locale,
  alwaysShowExtras,
  hideToggle,
  hideHeader,
}: FamilyTreeConfigFormProps) {
  const { t, i18n } = useTranslation();
  const isDev = import.meta.env.DEV;
  const showDeduplicateToggle = useMemo(
    () => toBool((import.meta as any).env.VITE_SHOW_DEDUPLICATE_TOGGLE),
    [],
  );
  const showChildrenModeToggle = useMemo(
    () => toBool((import.meta as any).env.VITE_SHOW_CHILDREN_MODE_TOGGLE),
    [],
  );
  const {
    rpcUrl,
    chainId,
    contractAddress,
    rootHash,
    rootVersionIndex,
    update,
    rootHistory,
    removeRootFromHistory,
    clearRootHistory,
    defaults,
  } = useConfig();
  const { clearAllCaches } = useTreeData();
  const [localRpcUrl, setLocalRpcUrl] = useState(rpcUrl);
  const [localChainId, setLocalChainId] = useState(chainId);
  const [localContractAddress, setLocalContractAddress] = useState(contractAddress);
  const [localRootHash, setLocalRootHash] = useState(rootHash);
  const [localVersion, setLocalVersion] = useState(rootVersionIndex);
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  const [errors, setErrors] = useState<{
    rpc?: string;
    chainId?: string;
    contract?: string;
    root?: string;
  }>({});
  const [customNetworks, setCustomNetworks] = useState<NetworkOption[]>(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_NETWORKS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (n) =>
            n &&
            typeof n.chainId === "number" &&
            typeof n.name === "string" &&
            typeof n.rpcUrl === "string",
        )
        .map((n) => ({ chainId: n.chainId, name: n.name, rpcUrl: n.rpcUrl, isCustom: true }));
    } catch {
      return [];
    }
  });
  const [customName, setCustomName] = useState("");
  const [customChainId, setCustomChainId] = useState<number | "">("");
  const [customRpc, setCustomRpc] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const toast = useToast();
  const copy = async (text: string) => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        try {
          toast.show(t("search.copied"));
        } catch {}
        return;
      }
    } catch {}
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      try {
        toast.show(t("search.copied"));
      } catch {}
    } catch {}
  };

  // sync external changes
  useEffect(() => {
    setLocalRpcUrl(rpcUrl);
    setLocalChainId(chainId);
    setLocalContractAddress(contractAddress);
    setLocalRootHash(rootHash);
    setLocalVersion(rootVersionIndex);
  }, [rpcUrl, chainId, contractAddress, rootHash, rootVersionIndex]);

  // load history when entering edit mode
  useEffect(() => {
    /* history now from global context; nothing to do here */
  }, [editing]);

  // responsive-only: small screens show shortened text; larger screens show full text

  const presetNetworks = useMemo<NetworkOption[]>(
    () =>
      NETWORK_PRESETS.map((n) => ({
        chainId: n.chainId,
        name: t?.(n.nameKey, n.defaultName) || n.defaultName,
        rpcUrl: n.rpcUrl,
      })),
    // Recompute when locale changes
    [t, i18n.language],
  );

  const allNetworks = useMemo<NetworkOption[]>(
    () => [...presetNetworks, ...customNetworks],
    [presetNetworks, customNetworks],
  );

  const inferNetworkSelection = (rpc: string): number | "custom" => {
    const found = allNetworks.find((n) => n.rpcUrl === rpc);
    return found ? found.chainId : "custom";
  };

  const [selectedNetwork, setSelectedNetwork] = useState<number | "custom">(() =>
    inferNetworkSelection(rpcUrl),
  );

  useEffect(() => {
    setSelectedNetwork(inferNetworkSelection(localRpcUrl));
    const found = allNetworks.find((n) => n.rpcUrl === localRpcUrl);
    if (found) setLocalChainId(found.chainId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localRpcUrl, customNetworks, presetNetworks]);

  const hasDiff =
    localRpcUrl !== rpcUrl ||
    localChainId !== chainId ||
    localContractAddress !== contractAddress ||
    localRootHash !== rootHash ||
    localVersion !== rootVersionIndex;

  const getLocalizedDefaultRoot = () => {
    const activeLocale = (locale || "").toLowerCase();
    const preferZhRoot = LOCALE_NEED_ZH_ROOT.has(activeLocale);
    const suffix = preferZhRoot ? "ZH" : "EN";
    const env = (import.meta as any).env as Record<string, string | undefined>;
    const hashKey = `VITE_ROOT_PERSON_HASH_${suffix}`;
    const versionKey = `VITE_ROOT_VERSION_INDEX_${suffix}`;
    const localizedHash = env?.[hashKey];
    const localizedVersion = Number(env?.[versionKey]);

    const safeHash =
      localizedHash && /^0x[a-fA-F0-9]{64}$/.test(localizedHash)
        ? localizedHash
        : defaults.rootHash;
    const safeVersion =
      Number.isFinite(localizedVersion) && localizedVersion > 0
        ? localizedVersion
        : defaults.rootVersionIndex;

    return { hash: safeHash, version: safeVersion };
  };

  const resetToDefaults = () => {
    const localized = getLocalizedDefaultRoot();
    setLocalRpcUrl(defaults.rpcUrl);
    setLocalChainId(defaults.chainId);
    setLocalContractAddress(defaults.contractAddress);
    setLocalRootHash(localized.hash);
    setLocalVersion(localized.version);
  };

  const applyConfigChanges = () => {
    if (!validateAll()) return;
    update({
      rpcUrl: localRpcUrl,
      chainId: localChainId,
      contractAddress: localContractAddress,
      rootHash: localRootHash,
      rootVersionIndex: localVersion,
    });
    setEditing(false);
    // Proactively refresh after saving config
    onRefresh?.();
  };

  const cancel = () => {
    setLocalRpcUrl(rpcUrl);
    setLocalContractAddress(contractAddress);
    setLocalRootHash(rootHash);
    setLocalVersion(rootVersionIndex);
    setEditing(false);
  };

  // version apply (only for non-edit mode)
  const applyVersion = () => {
    if (editing) return; // Don't auto-apply in edit mode
    update({ rootVersionIndex: localVersion });
    // Proactively refresh after changing version
    onRefresh?.();
  };

  // validation helpers
  const isAddress = (v: string) => /^0x[a-fA-F0-9]{40}$/.test(v.trim());
  const isHash32 = (v: string) => /^0x[a-fA-F0-9]{64}$/.test(v.trim());
  const isUrl = (v: string) => /^https?:\/\//i.test(v) || v.startsWith("/");
  const validateAll = () => {
    const next: typeof errors = {};
    if (!isUrl(localRpcUrl)) next.rpc = "familyTree.validation.rpc";
    if (!Number.isFinite(localChainId) || (localChainId || 0) <= 0)
      next.chainId = "familyTree.validation.chainIdInvalid";
    if (!isAddress(localContractAddress)) next.contract = "familyTree.validation.contract";
    if (!isHash32(localRootHash)) next.root = "familyTree.validation.root";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  useEffect(() => {
    if (editing) validateAll();
  }, [editing, localRpcUrl, localChainId, localContractAddress, localRootHash]);

  const saveCustomNetworks = (list: NetworkOption[]) => {
    setCustomNetworks(list);
    try {
      const serialized = list.map(({ chainId, name, rpcUrl }) => ({ chainId, name, rpcUrl }));
      localStorage.setItem(CUSTOM_NETWORKS_KEY, JSON.stringify(serialized));
    } catch {}
  };

  const addCustomNetwork = () => {
    setCustomError(null);
    const chainIdNum = typeof customChainId === "number" ? customChainId : Number(customChainId);
    if (
      !customName.trim() ||
      !Number.isFinite(chainIdNum) ||
      chainIdNum <= 0 ||
      !isUrl(customRpc)
    ) {
      setCustomError(
        t(
          "familyTree.validation.customNetwork",
          "Please enter network name, valid chain ID, and RPC URL",
        ),
      );
      return;
    }
    if (presetNetworks.some((n) => n.chainId === chainIdNum)) {
      setCustomError(
        t("familyTree.validation.chainIdConflict", "Chain ID already exists in built-in networks"),
      );
      return;
    }
    const trimmedRpc = customRpc.trim();
    if (presetNetworks.some((n) => n.rpcUrl === trimmedRpc)) {
      setCustomError(
        t("familyTree.validation.rpcConflict", "RPC already exists in built-in networks"),
      );
      return;
    }
    const newNetwork: NetworkOption = {
      chainId: chainIdNum,
      name: customName.trim(),
      rpcUrl: trimmedRpc,
      isCustom: true,
    };
    const filtered = [
      ...customNetworks.filter((n) => n.chainId !== chainIdNum && n.rpcUrl !== trimmedRpc),
      newNetwork,
    ];
    saveCustomNetworks(filtered);
    setLocalRpcUrl(trimmedRpc);
    setLocalChainId(chainIdNum);
    setSelectedNetwork(chainIdNum);
    setCustomName("");
    setCustomChainId("");
    setCustomRpc("");
    toast.show(t("familyTree.config.customNetworkAdded", "Custom network added"));
  };

  const handleNetworkChange = (value: string) => {
    if (value === "custom") {
      setSelectedNetwork("custom");
      setLocalChainId(0);
      return;
    }
    const chainId = Number(value);
    const network = allNetworks.find((n) => n.chainId === chainId);
    if (network) {
      setSelectedNetwork(chainId);
      setLocalRpcUrl(network.rpcUrl);
      setLocalChainId(network.chainId);
    } else {
      setSelectedNetwork("custom");
    }
  };

  // debounce version change (auto apply after 600ms idle, only in non-edit mode)
  useDebounce(localVersion, 600, (v) => {
    if (!editing && v !== rootVersionIndex) applyVersion();
  });

  // Status badge logic
  const getStatusBadge = () => {
    let bgClass, borderClass, textClass, text;

    if (loading) {
      bgClass =
        "bg-gradient-to-r from-amber-100 to-orange-100 dark:from-amber-900/40 dark:to-orange-900/30";
      borderClass = "border-amber-300/60 dark:border-amber-600/40";
      textClass = "text-amber-700 dark:text-amber-300";
      text = statusT ? statusT("familyTree.status.badge.checking") : "Loading";
    } else if (contractMessage) {
      bgClass =
        "bg-gradient-to-r from-red-100 to-rose-100 dark:from-red-900/40 dark:to-rose-900/30";
      borderClass = "border-red-300/60 dark:border-red-600/40";
      textClass = "text-red-700 dark:text-red-300";
      text = contractMessage;
    } else {
      bgClass =
        "bg-gradient-to-r from-emerald-100 to-green-100 dark:from-emerald-900/40 dark:to-green-900/30";
      borderClass = "border-emerald-300/60 dark:border-emerald-600/40";
      textClass = "text-emerald-700 dark:text-emerald-300";
      text = statusT ? statusT("familyTree.status.badge.ok") : "OK";
    }

    return (
      <span
        className={`inline-flex items-center px-1.5 py-0 rounded-full border text-[10px] font-semibold shadow-sm backdrop-blur-sm ${bgClass} ${borderClass} ${textClass}`}
      >
        {text}
      </span>
    );
  };

  return (
    <div className="text-sm text-slate-600 dark:text-slate-300 p-4">
      {/* Mobile-responsive header layout */}
      <div className="mb-6">
        {/* Header with title and edit buttons - always on same row */}
        <div className="flex items-start justify-between gap-4 mb-4">
          {/* Left side: Title */}
          {!hideHeader && (
            <div className="min-w-0 flex-1">
              <span className="text-lg font-bold text-transparent bg-gradient-to-r from-orange-400 to-red-500 bg-clip-text">
                {t("familyTree.ui.contractModeConfig")}
              </span>
            </div>
          )}

          {/* Right side: Edit/Save/Cancel Buttons - always in top right */}
          {!hideToggle && (
            <div className="flex-shrink-0">
              {editing ? (
                <div className="flex gap-2">
                  <button
                    onClick={resetToDefaults}
                    className="px-3 py-1.5 text-xs rounded-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-md hover:shadow-lg transition-all duration-200 font-semibold"
                    title={t("familyTree.config.resetToDefaults")}
                  >
                    {t("familyTree.config.reset")}
                  </button>
                  <button
                    onClick={applyConfigChanges}
                    disabled={!hasDiff}
                    className={`px-3 py-1.5 text-xs rounded-full transition-all duration-200 font-semibold ${hasDiff ? "bg-gradient-to-r from-orange-400 to-red-500 hover:from-orange-500 hover:to-red-600 text-white shadow-md hover:shadow-lg" : "bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed"}`}
                  >
                    {t("familyTree.ui.save")}
                  </button>
                  <button
                    onClick={cancel}
                    className="px-3 py-1.5 text-xs rounded-full bg-slate-600 dark:bg-slate-500 text-white hover:bg-slate-700 dark:hover:bg-slate-600 transition-all duration-200 shadow-md hover:shadow-lg font-semibold"
                  >
                    {t("familyTree.ui.cancel")}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setEditing(true)}
                  className="px-3 py-1.5 text-xs rounded-full bg-gradient-to-r from-orange-400 to-red-500 text-white hover:from-orange-500 hover:to-red-600 transition-all duration-200 shadow-md hover:shadow-lg font-semibold"
                >
                  {t("familyTree.ui.edit")}
                </button>
              )}
            </div>
          )}
          {hideToggle && editing && (
            <div className="flex gap-2">
              <button
                onClick={resetToDefaults}
                className="px-3 py-1.5 text-xs rounded-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-md hover:shadow-lg transition-all duration-200 font-semibold"
                title={t("familyTree.config.resetToDefaults")}
              >
                {t("familyTree.config.reset")}
              </button>
              <button
                onClick={applyConfigChanges}
                disabled={!hasDiff}
                className={`px-3 py-1.5 text-xs rounded-full transition-all duration-200 font-semibold ${hasDiff ? "bg-gradient-to-r from-orange-400 to-red-500 hover:from-orange-500 hover:to-red-600 text-white shadow-md hover:shadow-lg" : "bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed"}`}
              >
                {t("familyTree.ui.save")}
              </button>
            </div>
          )}
        </div>

        {/* Status Badge and Action Buttons Row - only show in non-editing mode */}
        {!editing && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Left: Status Badge */}
            <div className="flex items-center">{getStatusBadge()}</div>

            {/* Right: Action Buttons */}
            <div className="flex items-center gap-2">
              {onRefresh && (
                <button
                  onClick={onRefresh}
                  className="inline-flex items-center justify-center h-7 px-3 gap-1.5 rounded-full border border-slate-300/60 dark:border-slate-600/60 bg-white/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:bg-orange-50 dark:hover:bg-slate-700/80 hover:text-orange-600 dark:hover:text-orange-400 hover:border-orange-300 dark:hover:border-orange-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 dark:focus-visible:ring-orange-400/60 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md backdrop-blur-sm group flex-shrink-0 text-xs whitespace-nowrap font-medium"
                  disabled={loading}
                  title={statusT ? statusT("familyTree.actions.refresh") : "Refresh"}
                  aria-label={statusT ? statusT("familyTree.actions.refresh") : "Refresh"}
                >
                  <svg
                    className={`w-3.5 h-3.5 ${loading ? "animate-spin" : "group-hover:rotate-180"} transition-transform duration-300 flex-shrink-0`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                  </svg>
                  <span className="truncate">
                    {statusT ? statusT("familyTree.actions.refresh") : "Refresh"}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  clearAllCaches();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all duration-200 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800 hover:bg-rose-100 hover:border-rose-300 hover:text-rose-800 dark:hover:bg-rose-800/40 dark:hover:border-rose-600 dark:hover:text-rose-200 hover:shadow-md active:bg-rose-200 dark:active:bg-rose-700/50 shadow-sm flex-shrink-0 whitespace-nowrap"
              >
                <svg
                  className="w-3.5 h-3.5 flex-shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
                <span className="truncate">{t("familyTree.config.clearAndRefresh", "Clear")}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {editing ? (
        <div className="space-y-4">
          {/* RPC and Contract in same row */}
          <div className="flex flex-col gap-4">
            <div className="flex-1">
              <label className="block text-slate-700 dark:text-slate-300 mb-2 font-semibold">
                {t("familyTree.config.rpc")}:
              </label>
              <div className="space-y-2">
                <div className="flex flex-col gap-2">
                  <select
                    value={selectedNetwork === "custom" ? "custom" : String(selectedNetwork)}
                    onChange={(e) => handleNetworkChange(e.target.value)}
                    className="w-full px-3 pr-5 py-2 text-sm rounded-2xl border bg-white/90 dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 transition-all duration-200 backdrop-blur-sm shadow-sm border-slate-300 dark:border-slate-600 focus:border-orange-500 focus:ring-orange-500/60 dark:focus:border-orange-400 dark:focus:ring-orange-400/60 hover:border-orange-400 dark:hover:border-orange-500"
                  >
                    {presetNetworks.map((n) => (
                      <option key={n.chainId} value={n.chainId}>
                        {n.name}
                      </option>
                    ))}
                    {customNetworks.length > 0 && (
                      <optgroup label={t("familyTree.config.customNetworks", "Custom")}>
                        {customNetworks.map((n) => (
                          <option key={`custom-${n.chainId}`} value={n.chainId}>
                            {n.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <option value="custom">
                      {t("familyTree.config.customNetwork", "Custom network")}
                    </option>
                  </select>
                  <input
                    type="text"
                    value={localRpcUrl}
                    readOnly
                    className={`flex-1 px-3 py-2 text-sm font-mono rounded-2xl border bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all duration-200 backdrop-blur-sm shadow-sm ${errors.rpc ? "border-red-400 focus:border-red-500 focus:ring-red-500/60 dark:border-red-500" : "border-slate-300 dark:border-slate-600 focus:border-orange-500 focus:ring-orange-500/60 dark:focus:border-orange-400 dark:focus:ring-orange-400/60 hover:border-orange-400 dark:hover:border-orange-500"}`}
                  />
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {t("familyTree.config.chainId", "Chain ID")}:{" "}
                  {localChainId || t("common.na", "N/A")}
                </div>
                {selectedNetwork === "custom" && (
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/50 p-3 space-y-2">
                    <div className="grid grid-cols-1 gap-2">
                      <input
                        type="text"
                        placeholder={t("familyTree.config.customNetworkName", "Network name")}
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                        className="px-3 py-2 text-sm rounded-xl border bg-white/90 dark:bg-slate-900/70 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all duration-200 border-slate-300 dark:border-slate-600 focus:border-orange-500 focus:ring-orange-500/60 dark:focus:border-orange-400 dark:focus:ring-orange-400/60"
                      />
                      <input
                        type="number"
                        placeholder={t("familyTree.config.chainId", "Chain ID")}
                        value={customChainId}
                        onChange={(e) =>
                          setCustomChainId(e.target.value === "" ? "" : Number(e.target.value))
                        }
                        className="px-3 py-2 text-sm rounded-xl border bg-white/90 dark:bg-slate-900/70 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all duration-200 border-slate-300 dark:border-slate-600 focus:border-orange-500 focus:ring-orange-500/60 dark:focus:border-orange-400 dark:focus:ring-orange-400/60"
                      />
                      <input
                        type="text"
                        placeholder="https://"
                        value={customRpc}
                        onChange={(e) => setCustomRpc(e.target.value)}
                        className="px-3 py-2 text-sm rounded-xl border bg-white/90 dark:bg-slate-900/70 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all duration-200 border-slate-300 dark:border-slate-600 focus:border-orange-500 focus:ring-orange-500/60 dark:focus:border-orange-400 dark:focus:ring-orange-400/60"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {t(
                            "familyTree.config.addCustomNetworkHint",
                            "Fill in and save to reuse later",
                          )}
                        </div>
                        {!isDev && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {t(
                              "familyTree.config.customNetworkCspHint",
                              "In preview/production, the RPC origin must be allowlisted by CSP (connect-src). If it fails to connect, add the origin via DEEP_CSP_CONNECT_SRC when running preview/build.",
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={addCustomNetwork}
                        className="px-3 py-1.5 text-xs rounded-full bg-gradient-to-r from-orange-400 to-red-500 hover:from-orange-500 hover:to-red-600 text-white font-semibold shadow-sm hover:shadow-md transition-all duration-200"
                      >
                        {t("familyTree.config.addCustomNetwork", "Save custom")}
                      </button>
                    </div>
                    {customError && (
                      <div className="text-red-500 dark:text-red-400 text-xs font-medium">
                        {customError}
                      </div>
                    )}
                  </div>
                )}
                {errors.rpc && (
                  <div className="text-red-500 dark:text-red-400 text-xs font-medium">
                    {t(errors.rpc, "RPC format error")}
                  </div>
                )}
              </div>
            </div>
            <div className="flex-1">
              <label className="block text-slate-700 dark:text-slate-300 mb-2 font-semibold">
                {t("familyTree.config.contract")}:
              </label>
              <input
                type="text"
                value={localContractAddress}
                onChange={(e) => setLocalContractAddress(e.target.value)}
                className={`w-full px-3 py-2 text-sm font-mono rounded-2xl border bg-white/90 dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all duration-200 backdrop-blur-sm shadow-sm ${errors.contract ? "border-red-400 focus:border-red-500 focus:ring-red-500/60 dark:border-red-500" : "border-slate-300 dark:border-slate-600 focus:border-orange-500 focus:ring-orange-500/60 dark:focus:border-orange-400 dark:focus:ring-orange-400/60 hover:border-orange-400 dark:hover:border-orange-500"}`}
              />
              {errors.contract && (
                <div className="text-red-500 dark:text-red-400 text-xs mt-1.5 font-medium">
                  {t(errors.contract, "Contract address format error")}
                </div>
              )}
            </div>
          </div>
          {/* Root Hash and Version in same row */}
          <div className="flex flex-col gap-4">
            <div className="flex-1">
              <label className="block text-slate-700 dark:text-slate-300 mb-2 font-semibold">
                {t("familyTree.config.root")}:
              </label>
              <input
                type="text"
                value={localRootHash}
                onChange={(e) => setLocalRootHash(e.target.value)}
                className={`w-full px-3 py-2 text-sm font-mono rounded-2xl border bg-white/90 dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all duration-200 backdrop-blur-sm shadow-sm ${errors.root ? "border-red-400 focus:border-red-500 focus:ring-red-500/60 dark:border-red-500" : "border-slate-300 dark:border-slate-600 focus:border-orange-500 focus:ring-orange-500/60 dark:focus:border-orange-400 dark:focus:ring-orange-400/60 hover:border-orange-400 dark:hover:border-orange-500"}`}
              />
              {errors.root && (
                <div className="text-red-500 dark:text-red-400 text-xs mt-1.5 font-medium">
                  {t(errors.root, "Root Hash format error")}
                </div>
              )}
            </div>
            <div>
              <label className="block text-slate-700 dark:text-slate-300 mb-2 font-semibold">
                {t("familyTree.ui.versionNumber")}:
              </label>
              <div className="inline-flex items-center rounded-2xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-sm h-[38px] overflow-hidden">
                <button
                  className="w-8 h-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors duration-150 text-sm font-medium"
                  onClick={() => setLocalVersion((v) => Math.max(1, (v || 1) - 1))}
                  aria-label="Decrease version"
                >
                  -
                </button>
                <input
                  type="number"
                  min={1}
                  value={localVersion}
                  onChange={(e) => setLocalVersion(Math.max(1, Number(e.target.value)))}
                  className="w-24 h-full text-sm text-center border-0 border-l border-r border-slate-300 dark:border-slate-600 bg-transparent text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-0 font-medium"
                />
                <button
                  className="w-8 h-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors duration-150 text-sm font-medium"
                  onClick={() => setLocalVersion((v) => (v || 1) + 1)}
                  aria-label="Increase version"
                >
                  +
                </button>
              </div>
            </div>
          </div>
          {rootHistory.length > 0 && (
            <div className="mt-2">
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                {t("familyTree.config.rootHistory", "Root hash history")}
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                {rootHistory.map((h) => (
                  <div key={h} className="inline-flex items-center gap-1 max-w-full">
                    <button
                      type="button"
                      onClick={() => setLocalRootHash(h)}
                      className="px-2 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-600 bg-slate-100 dark:bg-slate-700/50 text-slate-700 dark:text-slate-200 hover:border-emerald-500 dark:hover:border-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors duration-150 font-mono text-[11px] shadow-sm truncate max-w-[240px]"
                      title={h}
                    >
                      {formatHashMiddle(h)}
                    </button>
                    <button
                      type="button"
                      aria-label={t("familyTree.actions.remove", "Remove")}
                      className="w-4 h-4 inline-flex items-center justify-center rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors duration-150"
                      onClick={() => removeRootFromHistory(h)}
                      title={t("familyTree.actions.remove", "Remove") as string}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-1">
                <button
                  type="button"
                  onClick={clearRootHistory}
                  className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 underline"
                >
                  {t("familyTree.actions.clearAll", "Clear all")}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2 text-slate-700 dark:text-slate-300">
          {/* RPC and Contract - responsive layout */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                {t("familyTree.config.rpc")}:
              </span>
              <span
                className="font-mono text-xs text-blue-600 dark:text-blue-400 break-all text-right"
                title={rpcUrl}
              >
                {rpcUrl}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                {t("familyTree.config.contract")}:
              </span>
              <div className="inline-flex items-center gap-1">
                <span
                  className="font-mono text-xs text-blue-600 dark:text-blue-400 whitespace-nowrap sm:whitespace-normal sm:break-all"
                  title={contractAddress}
                >
                  <span className="inline sm:hidden">{shortAddress(contractAddress)}</span>
                  <span className="hidden sm:inline">{contractAddress}</span>
                </span>
                {contractAddress && (
                  <button
                    onClick={() => copy(contractAddress)}
                    aria-label={t("search.copy", "Copy")}
                    className="shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700/70 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                    title={t("search.copy", "Copy") as string}
                  >
                    <Clipboard size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Compact version controls - only show in non-editing mode */}
      {!editing && (
        <div className="mt-4 pt-3 border-t border-slate-200/60 dark:border-slate-700/60 space-y-2">
          {/* Root and Version - responsive layout */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                {t("familyTree.config.root")}:
              </span>
              <div className="flex-1 min-w-0 flex justify-end">
                <div className="inline-flex items-center gap-1 max-w-full">
                  <span
                    className="block overflow-hidden font-mono text-xs text-blue-600 dark:text-blue-400 whitespace-nowrap sm:whitespace-normal sm:break-all"
                    title={rootHash}
                  >
                    <span className="inline sm:hidden">{formatHashMiddle(rootHash)}</span>
                    <span className="hidden sm:inline">{rootHash}</span>
                  </span>
                  {rootHash && (
                    <button
                      onClick={() => copy(rootHash)}
                      aria-label={t("search.copy", "Copy")}
                      className="shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700/70 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                      title={t("search.copy", "Copy") as string}
                    >
                      <Clipboard size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                {t("familyTree.ui.versionNumber")}:
              </span>
              <div className="inline-flex items-center rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-sm">
                <button
                  className="w-6 h-6 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-l-md transition-colors duration-150 text-sm font-medium"
                  onClick={() => setLocalVersion((v) => Math.max(1, (v || 1) - 1))}
                  aria-label="Decrease version"
                >
                  -
                </button>
                <input
                  type="number"
                  min={1}
                  value={localVersion}
                  onChange={(e) => setLocalVersion(Math.max(1, Number(e.target.value)))}
                  onBlur={applyVersion}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") applyVersion();
                  }}
                  className="w-12 h-6 text-xs text-center border-0 border-l border-r border-slate-300 dark:border-slate-600 bg-transparent text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-0 font-medium"
                />
                <button
                  className="w-6 h-6 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-r-md transition-colors duration-150 text-sm font-medium"
                  onClick={() => setLocalVersion((v) => (v || 1) + 1)}
                  aria-label="Increase version"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Divider and bottom controls - only show in non-editing mode */}
      {(!editing || alwaysShowExtras) && (
        <>
          <div className="border-t border-slate-200/60 dark:border-slate-700/60 mt-4"></div>

          {/* Bottom section - two rows */}
          <div className="mt-4 space-y-3">
            {/* First row: Traversal mode and Stats */}
            <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4 text-xs">
              {/* Left: Traversal */}
              <div className="flex items-center justify-between w-full gap-2 relative">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                    {statusT ? statusT("familyTree.ui.traversal") : "Traversal"}:
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveTooltip(activeTooltip === "traversal" ? null : "traversal")
                    }
                    className="text-slate-400 hover:text-orange-500 dark:hover:text-orange-400 transition-colors focus:outline-none"
                  >
                    <HelpCircle size={14} />
                  </button>
                </div>
                <div className="inline-flex rounded-2xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 overflow-hidden">
                  <button
                    type="button"
                    aria-label={statusT ? statusT("familyTree.ui.traversalDFS") : "DFS"}
                    onClick={() => setTraversal("dfs")}
                    className={`px-3 py-1.5 text-xs transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 dark:focus-visible:ring-orange-400/60 font-medium ${traversal === "dfs" ? "bg-gradient-to-r from-orange-400 to-red-500 text-white shadow-md" : "bg-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"}`}
                  >
                    DFS
                  </button>
                  <div className="relative border-l border-slate-300 dark:border-slate-600">
                    <button
                      type="button"
                      aria-label={statusT ? statusT("familyTree.ui.traversalBFS") : "BFS"}
                      onClick={() => setTraversal("bfs")}
                      className={`px-3 py-1.5 text-xs transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 dark:focus-visible:ring-orange-400/60 font-medium ${traversal === "bfs" ? "bg-gradient-to-r from-orange-400 to-red-500 text-white shadow-md" : "bg-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"}`}
                    >
                      BFS
                    </button>
                  </div>
                </div>
                {activeTooltip === "traversal" && (
                  <div className="absolute -top-8 left-0 z-[9999] whitespace-nowrap rounded bg-slate-900/90 dark:bg-slate-950/90 text-white px-2 py-1 text-[10px] shadow-lg animate-in fade-in zoom-in-95 duration-200">
                    {traversal === "dfs"
                      ? statusT
                        ? statusT("familyTree.ui.traversalDFS")
                        : "Depth First Search"
                      : statusT
                        ? statusT("familyTree.ui.traversalBFS")
                        : "Breadth First Search"}
                  </div>
                )}
              </div>
            </div>

            {showChildrenModeToggle || showDeduplicateToggle ? (
              <>
                <div className="border-t border-slate-200/60 dark:border-slate-700/60"></div>
                <div className="space-y-2">
                  {showChildrenModeToggle ? (
                    <div className="flex items-center justify-between gap-2 flex-shrink-0 relative">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {statusT
                            ? statusT("familyTree.ui.childrenMode", "Children Mode")
                            : "Children Mode"}
                          :
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setActiveTooltip(
                              activeTooltip === "childrenMode" ? null : "childrenMode",
                            )
                          }
                          className="text-slate-400 hover:text-orange-500 dark:hover:text-orange-400 transition-colors focus:outline-none"
                        >
                          <HelpCircle size={14} />
                        </button>
                      </div>
                      <div className="inline-flex rounded-2xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 overflow-hidden">
                        <button
                          type="button"
                          aria-label="Union children mode"
                          onClick={() => setChildrenMode("union")}
                          className={`px-3 py-1.5 text-xs transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 dark:focus-visible:ring-orange-400/60 font-medium ${
                            childrenMode === "union"
                              ? "bg-gradient-to-r from-orange-400 to-red-500 text-white shadow-md"
                              : "bg-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                          }`}
                        >
                          Union
                        </button>
                        <div className="relative group border-l border-slate-300 dark:border-slate-600">
                          <button
                            type="button"
                            aria-label="Strict children mode"
                            onClick={() => setChildrenMode("strict")}
                            className={`px-3 py-1.5 text-xs transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 dark:focus-visible:ring-orange-400/60 font-medium ${
                              childrenMode === "strict"
                                ? "bg-gradient-to-r from-orange-400 to-red-500 text-white shadow-md"
                                : "bg-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                            }`}
                          >
                            Strict
                          </button>
                        </div>
                      </div>
                      {activeTooltip === "childrenMode" && (
                        <div className="absolute -top-8 left-0 z-[9999] whitespace-nowrap rounded bg-slate-900/90 dark:bg-slate-950/90 text-white px-2 py-1 text-[10px] shadow-lg animate-in fade-in zoom-in-95 duration-200">
                          {childrenMode === "strict"
                            ? statusT
                              ? statusT(
                                  "familyTree.ui.childrenModeTooltip.strict",
                                  "Strict: only children attached to this parent version",
                                )
                              : "Strict: only children attached to this parent version"
                            : statusT
                              ? statusT(
                                  "familyTree.ui.childrenModeTooltip.union",
                                  "Union: merge children across all parent versions",
                                )
                              : "Union: merge children across all parent versions"}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {showChildrenModeToggle && childrenMode === "strict" ? (
                    <div className="flex items-center justify-between gap-2 flex-shrink-0 relative">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {statusT
                            ? statusT("familyTree.ui.strictIncludeV0", "Include v0")
                            : "Include v0"}
                          :
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setActiveTooltip(activeTooltip === "includeV0" ? null : "includeV0")
                          }
                          className="text-slate-400 hover:text-orange-500 dark:hover:text-orange-400 transition-colors focus:outline-none"
                        >
                          <HelpCircle size={14} />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setStrictIncludeUnversionedChildren(!strictIncludeUnversionedChildren)
                        }
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 dark:focus-visible:ring-orange-400/60 ${
                          strictIncludeUnversionedChildren
                            ? "bg-gradient-to-r from-orange-400 to-red-500"
                            : "bg-slate-300 dark:bg-slate-600"
                        }`}
                        aria-label={
                          statusT
                            ? statusT("familyTree.ui.strictIncludeV0", "Toggle include v0")
                            : "Toggle include v0"
                        }
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                            strictIncludeUnversionedChildren
                              ? "translate-x-[18px]"
                              : "translate-x-0.5"
                          }`}
                        />
                      </button>
                      {activeTooltip === "includeV0" && (
                        <div className="absolute -top-8 left-0 z-[9999] whitespace-nowrap rounded bg-slate-900/90 dark:bg-slate-950/90 text-white px-2 py-1 text-[10px] shadow-lg animate-in fade-in zoom-in-95 duration-200">
                          {strictIncludeUnversionedChildren
                            ? statusT
                              ? statusT(
                                  "familyTree.ui.strictIncludeV0Tooltip.on",
                                  "Strict + v0: include unversioned children (parentVersionIndex=0)",
                                )
                              : "Strict + v0: include unversioned children (parentVersionIndex=0)"
                            : statusT
                              ? statusT(
                                  "familyTree.ui.strictIncludeV0Tooltip.off",
                                  "Strict only: exactly parentVersionIndex you selected",
                                )
                              : "Strict only: exactly parentVersionIndex you selected"}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {showDeduplicateToggle ? (
                    <div className="flex items-center justify-between gap-2 flex-shrink-0 relative">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {statusT
                            ? statusT("familyTree.ui.deduplicateChildren")
                            : "Deduplicate Children"}
                          :
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setActiveTooltip(activeTooltip === "deduplicate" ? null : "deduplicate")
                          }
                          className="text-slate-400 hover:text-orange-500 dark:hover:text-orange-400 transition-colors focus:outline-none"
                        >
                          <HelpCircle size={14} />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDeduplicateChildren(!deduplicateChildren)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 dark:focus-visible:ring-orange-400/60 ${
                          deduplicateChildren
                            ? "bg-gradient-to-r from-orange-400 to-red-500"
                            : "bg-slate-300 dark:bg-slate-600"
                        }`}
                        aria-label={
                          statusT
                            ? statusT("familyTree.ui.deduplicateChildren")
                            : "Toggle deduplicate children"
                        }
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                            deduplicateChildren ? "translate-x-[18px]" : "translate-x-0.5"
                          }`}
                        />
                      </button>
                      {activeTooltip === "deduplicate" && (
                        <div className="absolute -top-8 left-0 z-[9999] whitespace-nowrap rounded bg-slate-900/90 dark:bg-slate-950/90 text-white px-2 py-1 text-[10px] shadow-lg animate-in fade-in zoom-in-95 duration-200">
                          {deduplicateChildren
                            ? statusT
                              ? statusT("familyTree.ui.deduplicateChildrenTooltip.enabled")
                              : "Highest endorsed version only"
                            : statusT
                              ? statusT("familyTree.ui.deduplicateChildrenTooltip.disabled")
                              : "Show all versions"}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

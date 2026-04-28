import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfig } from "../../context";
import { NETWORK_PRESETS } from "../../../../shared/config";
import {
  getLocalizedRootHash,
  getLocalizedRootVersionIndex,
  isDevMode,
  shouldShowChildrenModeToggle,
  shouldShowDeduplicateToggle,
} from "../../../../shared/config/env";
import { useToast } from "../../../../shared/ui";
import { useTreeMutations, useVizOptions } from "../../../tree";
import { isAddress, isHash32, isUrl } from "../../model";
import type { NetworkOption, NetworkSelection } from "../../model";
import { loadCustomNetworks, saveCustomNetworks } from "../../services";

const LOCALE_NEED_ZH_ROOT = new Set(["zh-cn"]);

type FormErrors = {
  rpc?: string;
  chainId?: string;
  contract?: string;
  root?: string;
};

type TooltipKey = "traversal" | "childrenMode" | "includeV0" | "deduplicate";

export type FamilyTreeConfigFormController = ReturnType<typeof useFamilyTreeConfigForm>;

export function useFamilyTreeConfigForm() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
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
  const {
    traversal,
    setTraversal,
    childrenMode,
    setChildrenMode,
    strictIncludeUnversionedChildren,
    setStrictIncludeUnversionedChildren,
    deduplicateChildren,
    setDeduplicateChildren,
  } = useVizOptions();
  const { clearAllCaches } = useTreeMutations();

  const isDev = isDevMode();
  const showChildrenModeToggle = useMemo(() => shouldShowChildrenModeToggle(), []);
  const showDeduplicateToggle = useMemo(() => shouldShowDeduplicateToggle(), []);

  const [localRpcUrl, setLocalRpcUrl] = useState(rpcUrl);
  const [localChainId, setLocalChainId] = useState(chainId);
  const [localContractAddress, setLocalContractAddress] = useState(contractAddress);
  const [localRootHash, setLocalRootHash] = useState(rootHash);
  const [localVersion, setLocalVersion] = useState(rootVersionIndex);
  const [errors, setErrors] = useState<FormErrors>({});
  const [activeTooltip, setActiveTooltip] = useState<TooltipKey | null>(null);

  const [customNetworks, setCustomNetworks] = useState<NetworkOption[]>(() => loadCustomNetworks());
  const [customName, setCustomName] = useState("");
  const [customChainId, setCustomChainId] = useState<number | "">("");
  const [customRpc, setCustomRpc] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

  useEffect(() => {
    setLocalRpcUrl(rpcUrl);
    setLocalChainId(chainId);
    setLocalContractAddress(contractAddress);
    setLocalRootHash(rootHash);
    setLocalVersion(rootVersionIndex);
  }, [rpcUrl, chainId, contractAddress, rootHash, rootVersionIndex]);

  const presetNetworks = useMemo<NetworkOption[]>(
    () =>
      NETWORK_PRESETS.map((n) => ({
        chainId: n.chainId,
        name: t(n.nameKey, n.defaultName) || n.defaultName,
        rpcUrl: n.rpcUrl,
      })),
    [t, i18n.language],
  );

  const allNetworks = useMemo<NetworkOption[]>(
    () => [...presetNetworks, ...customNetworks],
    [presetNetworks, customNetworks],
  );

  const inferNetworkSelection = useCallback(
    (rpc: string): NetworkSelection => {
      const found = allNetworks.find((n) => n.rpcUrl === rpc);
      return found ? found.chainId : "custom";
    },
    [allNetworks],
  );

  const [selectedNetwork, setSelectedNetwork] = useState<NetworkSelection>(() =>
    inferNetworkSelection(rpcUrl),
  );
  const [isNetworkDropdownOpen, setIsNetworkDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsNetworkDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setSelectedNetwork(inferNetworkSelection(localRpcUrl));
    const found = allNetworks.find((n) => n.rpcUrl === localRpcUrl);
    if (found) setLocalChainId(found.chainId);
  }, [localRpcUrl, allNetworks, inferNetworkSelection]);

  const validateAll = useCallback(() => {
    const next: FormErrors = {};
    if (!isUrl(localRpcUrl)) next.rpc = "familyTree.validation.rpc";
    if (!Number.isFinite(localChainId) || (localChainId || 0) <= 0)
      next.chainId = "familyTree.validation.chainIdInvalid";
    if (!isAddress(localContractAddress)) next.contract = "familyTree.validation.contract";
    if (!isHash32(localRootHash)) next.root = "familyTree.validation.root";
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [localRpcUrl, localChainId, localContractAddress, localRootHash]);

  useEffect(() => {
    validateAll();
  }, [validateAll]);

  const hasDiff =
    localRpcUrl !== rpcUrl ||
    localChainId !== chainId ||
    localContractAddress !== contractAddress ||
    localRootHash !== rootHash ||
    localVersion !== rootVersionIndex;

  const getLocalizedDefaultRoot = useCallback(() => {
    const activeLocale = (i18n.language || "").toLowerCase();
    const preferZhRoot = LOCALE_NEED_ZH_ROOT.has(activeLocale);
    const suffix = preferZhRoot ? "ZH" : "EN";
    const localizedHash = getLocalizedRootHash(suffix);
    const localizedVersion = getLocalizedRootVersionIndex(suffix);

    const safeHash =
      localizedHash && /^0x[a-fA-F0-9]{64}$/.test(localizedHash)
        ? localizedHash
        : defaults.rootHash;
    const safeVersion =
      Number.isFinite(localizedVersion) && localizedVersion > 0
        ? localizedVersion
        : defaults.rootVersionIndex;

    return { hash: safeHash, version: safeVersion };
  }, [i18n.language, defaults.rootHash, defaults.rootVersionIndex]);

  const resetToDefaults = useCallback(() => {
    const localized = getLocalizedDefaultRoot();
    setLocalRpcUrl(defaults.rpcUrl);
    setLocalChainId(defaults.chainId);
    setLocalContractAddress(defaults.contractAddress);
    setLocalRootHash(localized.hash);
    setLocalVersion(localized.version);
  }, [defaults, getLocalizedDefaultRoot]);

  const applyConfigChanges = useCallback(() => {
    if (!validateAll()) return;
    update({
      rpcUrl: localRpcUrl,
      chainId: localChainId,
      contractAddress: localContractAddress,
      rootHash: localRootHash,
      rootVersionIndex: localVersion,
    });
  }, [
    update,
    validateAll,
    localRpcUrl,
    localChainId,
    localContractAddress,
    localRootHash,
    localVersion,
  ]);

  const persistCustomNetworks = useCallback((list: NetworkOption[]) => {
    setCustomNetworks(list);
    saveCustomNetworks(list);
  }, []);

  const handleNetworkChange = useCallback(
    (value: string) => {
      if (value === "custom") {
        setSelectedNetwork("custom");
        setLocalChainId(0);
        return;
      }
      const id = Number(value);
      const network = allNetworks.find((n) => n.chainId === id);
      if (network) {
        setSelectedNetwork(id);
        setLocalRpcUrl(network.rpcUrl);
        setLocalChainId(network.chainId);
      } else {
        setSelectedNetwork("custom");
      }
    },
    [allNetworks],
  );

  const addCustomNetwork = useCallback(() => {
    setCustomError(null);
    const idNum = typeof customChainId === "number" ? customChainId : Number(customChainId);
    if (!customName.trim() || !Number.isFinite(idNum) || idNum <= 0 || !isUrl(customRpc)) {
      setCustomError(
        t(
          "familyTree.validation.customNetwork",
          "Please enter network name, valid chain ID, and RPC URL",
        ),
      );
      return;
    }
    if (presetNetworks.some((n) => n.chainId === idNum)) {
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
      chainId: idNum,
      name: customName.trim(),
      rpcUrl: trimmedRpc,
      isCustom: true,
    };
    const next = [
      ...customNetworks.filter((n) => n.chainId !== idNum && n.rpcUrl !== trimmedRpc),
      newNetwork,
    ];
    persistCustomNetworks(next);
    setLocalRpcUrl(trimmedRpc);
    setLocalChainId(idNum);
    setSelectedNetwork(idNum);
    setCustomName("");
    setCustomChainId("");
    setCustomRpc("");
    toast.show(t("familyTree.config.customNetworkAdded", "Custom network added"));
  }, [
    customChainId,
    customName,
    customNetworks,
    customRpc,
    persistCustomNetworks,
    presetNetworks,
    t,
    toast,
  ]);

  const toggleTooltip = useCallback((key: TooltipKey) => {
    setActiveTooltip((prev) => (prev === key ? null : key));
  }, []);

  return {
    isDev,
    showChildrenModeToggle,
    showDeduplicateToggle,

    actions: {
      reset: resetToDefaults,
      save: applyConfigChanges,
      hasDiff,
      clearAllCaches,
    },

    network: {
      selected: selectedNetwork,
      isOpen: isNetworkDropdownOpen,
      setOpen: setIsNetworkDropdownOpen,
      dropdownRef,
      presets: presetNetworks,
      custom: customNetworks,
      onChange: handleNetworkChange,
      rpcUrl: localRpcUrl,
      chainId: localChainId,
      rpcError: errors.rpc,
    },

    customForm: {
      visible: selectedNetwork === "custom",
      name: customName,
      chainId: customChainId,
      rpc: customRpc,
      error: customError,
      showCspHint: !isDev,
      setName: setCustomName,
      setChainId: setCustomChainId,
      setRpc: setCustomRpc,
      submit: addCustomNetwork,
    },

    contract: {
      value: localContractAddress,
      onChange: setLocalContractAddress,
      error: errors.contract,
    },

    root: {
      value: localRootHash,
      onChange: setLocalRootHash,
      error: errors.root,
    },

    version: {
      value: localVersion,
      onChange: setLocalVersion,
      decrement: () => setLocalVersion((v) => Math.max(1, (v || 1) - 1)),
      increment: () => setLocalVersion((v) => (v || 1) + 1),
    },

    history: {
      items: rootHistory,
      onSelect: setLocalRootHash,
      onRemove: removeRootFromHistory,
      onClearAll: clearRootHistory,
    },

    traversal: {
      value: traversal,
      onChange: setTraversal,
      tooltipOpen: activeTooltip === "traversal",
      onToggleTooltip: () => toggleTooltip("traversal"),
    },

    children: {
      mode: childrenMode,
      onModeChange: setChildrenMode,
      modeTooltipOpen: activeTooltip === "childrenMode",
      onToggleModeTooltip: () => toggleTooltip("childrenMode"),
      includeUnversioned: strictIncludeUnversionedChildren,
      onIncludeUnversionedChange: setStrictIncludeUnversionedChildren,
      includeV0TooltipOpen: activeTooltip === "includeV0",
      onToggleIncludeV0Tooltip: () => toggleTooltip("includeV0"),
    },

    deduplicate: {
      value: deduplicateChildren,
      onChange: setDeduplicateChildren,
      tooltipOpen: activeTooltip === "deduplicate",
      onToggleTooltip: () => toggleTooltip("deduplicate"),
    },
  } as const;
}

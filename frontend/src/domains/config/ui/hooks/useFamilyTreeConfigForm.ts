import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfig } from "../../context";
import { NETWORK_PRESETS } from "../../../../shared/config";
import {
  isDevMode,
  shouldShowDeduplicateToggle,
  shouldShowNodeModeToggle,
  shouldShowTrustedSourceFilterToggle,
} from "../../../../shared/config/env";
import { useToast } from "../../../../shared/ui";
import { useTreeMutations, useVizOptions } from "../../../tree";
import { usePersonVersionOptions } from "../../../transactions/hooks/usePersonVersionOptions";
import { isAddress, isHash32, isUrl, reconcileRootVersionSelection } from "../../model";
import type { NetworkOption, NetworkSelection } from "../../model";
import { getLocalizedDefaultRoot, loadCustomNetworks, saveCustomNetworks } from "../../services";

type FormErrors = {
  rpc?: string;
  chainId?: string;
  contract?: string;
  root?: string;
  version?: string;
};

export type FamilyTreeConfigFormController = ReturnType<typeof useFamilyTreeConfigForm>;

export function useFamilyTreeConfigForm() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const {
    rpcUrl,
    chainId,
    readerAddress,
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
    trustedSourceFilterEnabled,
    setTrustedSourceFilterEnabled,
  } = useVizOptions();
  const { clearAllCaches } = useTreeMutations();

  const isDev = isDevMode();
  const showNodeModeToggle = useMemo(() => shouldShowNodeModeToggle(), []);
  const showDeduplicateToggle = useMemo(() => shouldShowDeduplicateToggle(), []);
  const showTrustedSourceFilterToggle = useMemo(() => shouldShowTrustedSourceFilterToggle(), []);

  const [localRpcUrl, setLocalRpcUrl] = useState(rpcUrl);
  const [localChainId, setLocalChainId] = useState(chainId);
  const [localReaderAddress, setLocalReaderAddress] = useState(readerAddress);
  const [localRootHash, setLocalRootHash] = useState(rootHash);
  const [localVersion, setLocalVersion] = useState(rootVersionIndex);
  const [errors, setErrors] = useState<FormErrors>({});

  const [customNetworks, setCustomNetworks] = useState<NetworkOption[]>(() => loadCustomNetworks());
  const [customName, setCustomName] = useState("");
  const [customChainId, setCustomChainId] = useState<number | "">("");
  const [customRpc, setCustomRpc] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

  // The hash the version index was last decided for, so an arriving lookup only
  // preselects a version for a hash the user has not already answered. Seeded
  // with the saved root: its stored index is that answer.
  const decidedVersionHashRef = useRef<string | null>(rootHash || null);

  useEffect(() => {
    setLocalRpcUrl(rpcUrl);
    setLocalChainId(chainId);
    setLocalReaderAddress(readerAddress);
    setLocalRootHash(rootHash);
    setLocalVersion(rootVersionIndex);
    decidedVersionHashRef.current = rootHash || null;
  }, [rpcUrl, chainId, readerAddress, rootHash, rootVersionIndex]);

  // Reads through the saved connection, not the unsaved one being edited above:
  // a hash is looked up against the network the app is currently talking to.
  const rootVersionLookup = usePersonVersionOptions(isHash32(localRootHash) ? localRootHash : null);

  const rootHashIsValid = isHash32(localRootHash);
  const hadValidRootHashRef = useRef(rootHashIsValid);

  useEffect(() => {
    const hadValid = hadValidRootHashRef.current;
    hadValidRootHashRef.current = rootHashIsValid;
    // Only on the transition out of a valid hash. The index belonged to the
    // hash that was just erased, so it must not linger as a bare "Version 1"
    // over whatever is typed next.
    if (rootHashIsValid || !hadValid) return;
    decidedVersionHashRef.current = null;
    setLocalVersion(0);
  }, [rootHashIsValid]);

  useEffect(() => {
    const update = reconcileRootVersionSelection(rootVersionLookup, decidedVersionHashRef.current);
    if (!update) return;
    decidedVersionHashRef.current = update.decidedForHash;
    setLocalVersion(update.versionIndex);
  }, [rootVersionLookup]);

  const handleVersionChange = useCallback(
    (value: number) => {
      // Freeze the decision for this hash so a still-running lookup cannot
      // overwrite what was just chosen by hand.
      decidedVersionHashRef.current = rootVersionLookup.personHash ?? localRootHash;
      setLocalVersion(Math.max(1, value));
    },
    [localRootHash, rootVersionLookup.personHash],
  );

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
    if (!isAddress(localReaderAddress)) next.contract = "familyTree.validation.reader";
    if (!isHash32(localRootHash)) next.root = "familyTree.validation.root";
    // 0 is the picker's "nothing chosen" state, which a cleared hash leaves
    // behind; the tree cannot be loaded from it.
    if (!Number.isFinite(localVersion) || (localVersion || 0) < 1)
      next.version = "familyTree.validation.version";
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [localRpcUrl, localChainId, localReaderAddress, localRootHash, localVersion]);

  useEffect(() => {
    validateAll();
  }, [validateAll]);

  const hasDiff =
    localRpcUrl !== rpcUrl ||
    localChainId !== chainId ||
    localReaderAddress !== readerAddress ||
    localRootHash !== rootHash ||
    localVersion !== rootVersionIndex;

  const getLocalizedFormDefaultRoot = useCallback(() => {
    return getLocalizedDefaultRoot(i18n.language, {
      rootHash: defaults.rootHash,
      rootVersionIndex: defaults.rootVersionIndex,
    });
  }, [i18n.language, defaults.rootHash, defaults.rootVersionIndex]);

  const resetToDefaults = useCallback(() => {
    const localized = getLocalizedFormDefaultRoot();
    setLocalRpcUrl(defaults.rpcUrl);
    setLocalChainId(defaults.chainId);
    setLocalReaderAddress(defaults.readerAddress);
    setLocalRootHash(localized.hash);
    setLocalVersion(localized.version);
    // The defaults name their own version; the lookup for that hash must not
    // replace it.
    decidedVersionHashRef.current = localized.hash || null;
  }, [defaults, getLocalizedFormDefaultRoot]);

  const applyConfigChanges = useCallback(() => {
    if (!validateAll()) return;
    update({
      rpcUrl: localRpcUrl,
      chainId: localChainId,
      readerAddress: localReaderAddress,
      contractAddress: "",
      tokenAddress: "",
      rootHash: localRootHash,
      rootVersionIndex: localVersion,
    });
  }, [
    update,
    validateAll,
    localRpcUrl,
    localChainId,
    localReaderAddress,
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
    toast.success(t("familyTree.config.customNetworkAdded", "Custom network added"));
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

  return {
    isDev,
    showNodeModeToggle,
    showDeduplicateToggle,
    showTrustedSourceFilterToggle,

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
      value: localReaderAddress,
      onChange: setLocalReaderAddress,
      error: errors.contract,
    },

    root: {
      value: localRootHash,
      onChange: setLocalRootHash,
      error: errors.root,
    },

    version: {
      value: localVersion,
      onChange: handleVersionChange,
      lookup: rootVersionLookup,
      error: errors.version,
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
    },

    children: {
      mode: childrenMode,
      onModeChange: setChildrenMode,
      includeUnversioned: strictIncludeUnversionedChildren,
      onIncludeUnversionedChange: setStrictIncludeUnversionedChildren,
    },

    deduplicate: {
      value: deduplicateChildren,
      onChange: setDeduplicateChildren,
    },

    trustedSourceFilter: {
      value: trustedSourceFilterEnabled,
      onChange: setTrustedSourceFilterEnabled,
    },
  } as const;
}

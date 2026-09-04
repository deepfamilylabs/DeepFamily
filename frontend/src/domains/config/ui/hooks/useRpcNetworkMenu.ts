import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NETWORK_PRESETS } from "../../../../shared/config";
import { getChainEntryReaderAddress, isDevMode } from "../../../../shared/config/env";
import { useToast } from "../../../../shared/ui";
import { useConfig } from "../../context";
import { isAddress, isUrl } from "../../model";
import type { NetworkOption, NetworkSelection } from "../../model";
import { getChainReader, loadCustomNetworks, saveCustomNetworks } from "../../services";

/**
 * Which chain the app reads from, as a menu.
 *
 * This used to be staged inside the family settings drawer and applied on save,
 * sitting beside the reader address and the root hash. But it is not a property
 * of a family — it is which network the whole app is talking to, which is what
 * the status bar reports — so it now lives next to that readout and applies the
 * moment a network is picked.
 *
 * Picking one clears the resolved module addresses the way the settings save
 * always did: they belong to the chain being left, and `ConfigProvider`
 * re-derives them from the reader against the new RPC. The reader itself is
 * per-chain too, so it travels with the switch — see `readerFor`.
 */
export function useRpcNetworkMenu() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { rpcUrl, chainId, defaults, update } = useConfig();

  const [customNetworks, setCustomNetworks] = useState<NetworkOption[]>(() => loadCustomNetworks());
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customChainId, setCustomChainId] = useState<number | "">("");
  const [customRpc, setCustomRpc] = useState("");
  const [customReader, setCustomReader] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

  const presets = useMemo<NetworkOption[]>(
    () =>
      NETWORK_PRESETS.map((n) => ({
        chainId: n.chainId,
        name: t(n.nameKey, n.defaultName) || n.defaultName,
        rpcUrl: n.rpcUrl,
      })),
    [t, i18n.language],
  );

  const allNetworks = useMemo<NetworkOption[]>(
    () => [...presets, ...customNetworks],
    [presets, customNetworks],
  );

  /** `"custom"` when the saved RPC belongs to no known network — an env default, say. */
  const selected = useMemo<NetworkSelection>(() => {
    const found = allNetworks.find((n) => n.rpcUrl === rpcUrl);
    return found ? found.chainId : "custom";
  }, [allNetworks, rpcUrl]);

  /**
   * The entry reader to use on a chain, best knowledge first: one that has
   * actually resolved there before, then an address the build was given for it,
   * then the unsuffixed env pair — which describes whichever chain
   * `VITE_RPC_URL` points at, and nothing else.
   *
   * `null` means nothing is known, and the reader in config is left alone rather
   * than replaced by a guess.
   */
  const readerFor = useCallback(
    (targetChainId: number): string | null => {
      // A custom network's own declaration comes first: it is the only place
      // that address is written down, and editing it has to take effect —
      // otherwise a correction would lose to whatever resolved before it.
      const declared = customNetworks.find((n) => n.chainId === targetChainId)?.readerAddress;
      if (declared) return declared;
      const remembered = getChainReader(targetChainId);
      if (remembered) return remembered;
      const fromEnv = getChainEntryReaderAddress(targetChainId);
      if (fromEnv) return fromEnv;
      if (targetChainId === defaults.chainId && defaults.readerAddress) {
        return defaults.readerAddress;
      }
      return null;
    },
    [customNetworks, defaults.chainId, defaults.readerAddress],
  );

  const switchTo = useCallback(
    (targetRpcUrl: string, targetChainId: number, explicitReader?: string) => {
      const reader = explicitReader || readerFor(targetChainId);
      update({
        rpcUrl: targetRpcUrl,
        chainId: targetChainId,
        contractAddress: "",
        tokenAddress: "",
        ...(reader ? { readerAddress: reader } : {}),
      });
    },
    [readerFor, update],
  );

  const select = useCallback(
    (id: number) => {
      const network = allNetworks.find((n) => n.chainId === id);
      if (!network || network.rpcUrl === rpcUrl) return;
      switchTo(network.rpcUrl, network.chainId);
    },
    [allNetworks, rpcUrl, switchTo],
  );

  const addCustomNetwork = useCallback(() => {
    setCustomError(null);
    const idNum = typeof customChainId === "number" ? customChainId : Number(customChainId);
    if (
      !customName.trim() ||
      !Number.isFinite(idNum) ||
      idNum <= 0 ||
      !isUrl(customRpc) ||
      !isAddress(customReader)
    ) {
      setCustomError(
        t(
          "familyTree.validation.customNetwork",
          "Please enter network name, valid chain ID, RPC URL and contract address",
        ),
      );
      return false;
    }
    if (presets.some((n) => n.chainId === idNum)) {
      setCustomError(
        t("familyTree.validation.chainIdConflict", "Chain ID already exists in built-in networks"),
      );
      return false;
    }
    const trimmedRpc = customRpc.trim();
    if (presets.some((n) => n.rpcUrl === trimmedRpc)) {
      setCustomError(
        t("familyTree.validation.rpcConflict", "RPC already exists in built-in networks"),
      );
      return false;
    }

    const trimmedReader = customReader.trim();
    const newNetwork: NetworkOption = {
      chainId: idNum,
      name: customName.trim(),
      rpcUrl: trimmedRpc,
      readerAddress: trimmedReader,
      isCustom: true,
    };
    const next = [
      ...customNetworks.filter((n) => n.chainId !== idNum && n.rpcUrl !== trimmedRpc),
      newNetwork,
    ];
    setCustomNetworks(next);
    saveCustomNetworks(next);
    // Adding one is asking for it: switching separately afterwards is a step
    // with no decision in it.
    // `customNetworks` in `readerFor` is still the list from before this render,
    // so hand the new address over directly rather than hoping it is found.
    switchTo(trimmedRpc, idNum, trimmedReader);
    setCustomName("");
    setCustomChainId("");
    setCustomRpc("");
    setCustomReader("");
    setIsAddOpen(false);
    toast.success(t("familyTree.config.customNetworkAdded", "Custom network added"));
    return true;
  }, [
    customChainId,
    customName,
    customNetworks,
    customReader,
    customRpc,
    presets,
    switchTo,
    t,
    toast,
  ]);

  return {
    presets,
    custom: customNetworks,
    selected,
    chainId,
    rpcUrl,
    select,
    addForm: {
      isOpen: isAddOpen,
      toggle: () => {
        setIsAddOpen((open) => !open);
        setCustomError(null);
      },
      name: customName,
      chainId: customChainId,
      rpc: customRpc,
      reader: customReader,
      error: customError,
      // In dev the RPC origin is whatever Vite lets through; a built preview is
      // where a stray origin gets blocked by CSP, so that is where to warn.
      showCspHint: !isDevMode(),
      setName: setCustomName,
      setChainId: setCustomChainId,
      setRpc: setCustomRpc,
      setReader: setCustomReader,
      submit: addCustomNetwork,
    },
  } as const;
}

export type RpcNetworkMenuController = ReturnType<typeof useRpcNetworkMenu>;

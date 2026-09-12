import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NETWORK_PRESETS } from "../../../../shared/config";
import { isDevMode } from "../../../../shared/config/env";
import { useToast } from "../../../../shared/ui";
import { useConfig } from "../../context";
import { isAddress, isUrl } from "../../model";
import type { NetworkOption, NetworkSelection } from "../../model";
import { loadCustomNetworks, resolveEntryReaderForChain, saveCustomNetworks } from "../../services";

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
 * re-derives them from the reader against the new RPC. The reader and the root
 * are per-chain too — see `switchTo`.
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
   * The entry reader for a chain, derived — never remembered. `""` means the
   * build knows none for it, which the menu shows on the row and `switchTo`
   * applies as-is.
   */
  const readerFor = useCallback(
    (targetChainId: number): string =>
      resolveEntryReaderForChain(targetChainId, {
        customNetworks,
        envChainId: defaults.chainId,
        envReaderAddress: defaults.readerAddress,
      }),
    [customNetworks, defaults.chainId, defaults.readerAddress],
  );

  /** Whether a row can actually be read through, for the menu to mark. */
  const isConfigured = useCallback(
    (targetChainId: number): boolean => Boolean(readerFor(targetChainId)),
    [readerFor],
  );

  const switchTo = useCallback(
    (targetRpcUrl: string, targetChainId: number, explicitReader?: string) => {
      update({
        rpcUrl: targetRpcUrl,
        chainId: targetChainId,
        contractAddress: "",
        tokenAddress: "",
        // Applied even when empty: the previous chain's entrypoint is not a
        // stand-in for this one, and keeping it would report a misconfigured
        // network as one whose contract has gone missing.
        readerAddress: explicitReader || readerFor(targetChainId),
        // A person hash names a record on one chain. Carrying it across would
        // ask the new chain about a root it has never heard of, so the root is
        // dropped and picked again — from history, or from the env defaults
        // when this is the chain the build describes.
        rootHash: "",
        rootVersionIndex: 1,
      });
    },
    [readerFor, update],
  );

  const select = useCallback(
    (id: number) => {
      const network = allNetworks.find((n) => n.chainId === id);
      if (!network || network.rpcUrl === rpcUrl) return;
      switchTo(network.rpcUrl, network.chainId, network.readerAddress);
    },
    [allNetworks, rpcUrl, switchTo],
  );

  /**
   * Forget a custom network. The connection is left alone: deleting a row from
   * a list is not a request to be disconnected from whatever it named, and the
   * status bar keeps reporting the chain in use as an unlisted one.
   */
  const remove = useCallback(
    (targetChainId: number) => {
      const next = customNetworks.filter((n) => n.chainId !== targetChainId);
      if (next.length === customNetworks.length) return;
      setCustomNetworks(next);
      saveCustomNetworks(next);
      toast.success(t("familyTree.config.customNetworkRemoved", "Custom network removed"));
    },
    [customNetworks, t, toast],
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
    remove,
    readerFor,
    isConfigured,
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

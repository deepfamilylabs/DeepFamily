import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { NETWORK_PRESETS } from "../../../../shared/config";
import { useConfig } from "../../context";
import { loadCustomNetworks } from "../../services";

/**
 * What to call the chain the app is reading from.
 *
 * Every message about a missing reader or root is about one particular chain,
 * and "this network" only lands where the network is already on screen. The
 * family settings panel no longer names it anywhere — the picker moved out — so
 * the messages have to carry the name themselves.
 *
 * Custom networks count: they are the ones whose name nobody else knows.
 */
export function useNetworkName(): string {
  const { chainId } = useConfig();
  const { t, i18n } = useTranslation();

  return useMemo(() => {
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      return t("statusBar.unknownNetwork", "Unknown network");
    }
    const preset = NETWORK_PRESETS.find((entry) => entry.chainId === chainId);
    if (preset) return t(preset.nameKey, preset.defaultName);
    const custom = loadCustomNetworks().find((entry) => entry.chainId === chainId);
    if (custom) return custom.name;
    // A chain reached through a saved RPC that matches nothing on file: its
    // number is the only name anyone has for it.
    return t("familyTree.config.unnamedNetwork", "chain {{chainId}}", { chainId });
  }, [chainId, t, i18n.language]);
}

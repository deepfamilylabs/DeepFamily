import { useEffect, useId, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { ZeroAddress } from "ethers";
import { useTranslation } from "react-i18next";
import { ThemedSelect } from "../../transactions/ui/shared/ThemedSelect";
import type { ShieldedAsset } from "../services/shieldedAssetRegistry";
import { PanelButton } from "./inheritanceControls";

export type ShieldedAssetToolbarProps = {
  selectedAddress: string;
  deepTokenAddress: string;
  nativeSymbol: string;
  importedAssets: readonly ShieldedAsset[];
  disabled: boolean;
  onSelect: (address: string) => void;
  importAddress: string;
  onImportAddressChange: (address: string) => void;
  onImport: () => void;
  importing?: boolean;
};

export function ShieldedAssetToolbar({
  selectedAddress,
  deepTokenAddress,
  nativeSymbol,
  importedAssets,
  disabled,
  onSelect,
  importAddress,
  onImportAddressChange,
  onImport,
  importing = false,
}: ShieldedAssetToolbarProps) {
  const { t } = useTranslation();
  const labelId = useId();
  const importId = useId();
  const [expanded, setExpanded] = useState(false);
  const importSubmitted = useRef(false);
  const controlsDisabled = disabled || importing;
  const assets = importedAssets.filter(
    (asset) =>
      asset.address.toLowerCase() !== ZeroAddress &&
      asset.address.toLowerCase() !== deepTokenAddress.toLowerCase(),
  );
  const selectedValue = [
    deepTokenAddress,
    ZeroAddress,
    ...assets.map((asset) => asset.address),
  ].find((address) => address.toLowerCase() === selectedAddress.toLowerCase());

  useEffect(() => {
    if (importSubmitted.current && !importAddress.trim()) {
      importSubmitted.current = false;
      setExpanded(false);
    }
  }, [importAddress]);

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <span
          id={labelId}
          className="sr-only sm:not-sr-only sm:shrink-0 sm:text-xs sm:text-ink-muted"
        >
          {t("shielded.assets.label")}
        </span>
        <ThemedSelect
          className="min-w-0 flex-1 sm:w-40 sm:flex-none"
          labelledBy={labelId}
          value={selectedValue ?? selectedAddress}
          disabled={controlsDisabled}
          onChange={onSelect}
          options={[
            { value: deepTokenAddress, label: "DEEP" },
            { value: ZeroAddress, label: nativeSymbol },
            ...assets.map((asset) => ({
              value: asset.address,
              label: `${asset.symbol} · ${asset.address.slice(0, 6)}…${asset.address.slice(-4)}`,
            })),
          ]}
        />
        <button
          type="button"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-alt hover:text-ink focus:outline-hidden focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
          aria-expanded={expanded}
          aria-label={t(expanded ? "shielded.assets.cancel" : "shielded.assets.add")}
          aria-controls={expanded ? importId : undefined}
          disabled={controlsDisabled}
          onClick={() => {
            importSubmitted.current = false;
            setExpanded((current) => !current);
          }}
        >
          {expanded ? (
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">
            {t(expanded ? "shielded.assets.cancel" : "shielded.assets.add")}
          </span>
        </button>
      </div>
      {expanded ? (
        <form
          id={importId}
          className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(event) => {
            event.preventDefault();
            if (controlsDisabled || !importAddress.trim()) return;
            importSubmitted.current = true;
            onImport();
          }}
        >
          <input
            type="text"
            aria-label={t("shielded.assets.tokenAddress")}
            placeholder={t("shielded.assets.tokenAddress")}
            className="h-9 w-full min-w-0 rounded-lg border border-hairline bg-surface px-3 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-primary/30 disabled:opacity-50 sm:max-w-lg sm:flex-1"
            value={importAddress}
            disabled={controlsDisabled}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => onImportAddressChange(event.target.value)}
          />
          <PanelButton
            type="submit"
            size="compact"
            className="self-start"
            busy={importing}
            disabled={controlsDisabled || !importAddress.trim()}
          >
            {t("shielded.assets.import")}
          </PanelButton>
        </form>
      ) : null}
    </div>
  );
}

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { ZeroAddress } from "ethers";
import { useTranslation } from "react-i18next";
import type { ShieldedAsset } from "../services/shieldedAssetRegistry";
import { PanelButton } from "./inheritanceControls";

export type ShieldedAssetToolbarProps = {
  selectedAddress: string;
  deepTokenAddress: string;
  nativeSymbol: string;
  importedAssets: readonly (Omit<ShieldedAsset, "decimals"> & { decimals: number | null })[];
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
  const selectId = useId();
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
        <label htmlFor={selectId} className="shrink-0 text-xs text-ink-muted">
          {t("shielded.assets.label")}
        </label>
        <div className="relative min-w-0 flex-1 sm:max-w-48">
          <select
            id={selectId}
            className="h-9 w-full min-w-0 appearance-none rounded-lg border border-hairline-strong bg-surface pl-3 pr-9 text-sm font-medium text-ink focus:outline-hidden focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
            value={selectedValue ?? selectedAddress}
            disabled={controlsDisabled}
            onChange={(event) => onSelect(event.target.value)}
          >
            <option value={deepTokenAddress}>DEEP</option>
            <option value={ZeroAddress}>{nativeSymbol}</option>
            {assets.map((asset) => (
              <option key={asset.address} value={asset.address}>
                {asset.symbol} · {asset.address.slice(0, 6)}…{asset.address.slice(-4)}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted"
            aria-hidden="true"
          />
        </div>
        <button
          type="button"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-alt hover:text-ink focus:outline-hidden focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
          aria-expanded={expanded}
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
          {t(expanded ? "shielded.assets.cancel" : "shielded.assets.add")}
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

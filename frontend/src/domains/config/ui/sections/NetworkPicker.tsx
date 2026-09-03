import { ChevronDown, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RefObject } from "react";
import { Field } from "./ConfigControls";
import type { NetworkOption, NetworkSelection } from "../../model";

export interface NetworkPickerProps {
  selected: NetworkSelection;
  isOpen: boolean;
  setOpen: (v: boolean) => void;
  dropdownRef: RefObject<HTMLDivElement>;
  presets: NetworkOption[];
  custom: NetworkOption[];
  rpcUrl: string;
  chainId: number;
  rpcError?: string;
  onChange: (value: string) => void;
}

/**
 * Network, chain id and RPC URL as one field: the chain id rides in the trigger
 * and the URL stands under it as the hint, so picking a network shows what it
 * resolved to without a second read-only input to explain.
 */
export default function NetworkPicker({
  selected,
  isOpen,
  setOpen,
  dropdownRef,
  presets,
  custom,
  rpcUrl,
  chainId,
  rpcError,
  onChange,
}: NetworkPickerProps) {
  const { t } = useTranslation();
  const findOption = (id: NetworkSelection) =>
    presets.find((n) => n.chainId === id) || custom.find((n) => n.chainId === id);

  const itemClass =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors";
  const itemActive = "bg-primary/10 font-medium text-orange-700 dark:text-orange-300";
  const itemIdle = "text-ink hover:bg-surface-muted";

  const label = t("familyTree.config.rpc");
  const currentName =
    selected === "custom"
      ? t("familyTree.config.customNetwork", "Custom network")
      : findOption(selected)?.name || t("familyTree.config.unknownNetwork", "Unknown");

  const renderOption = (key: string, name: string, active: boolean, value: string) => (
    <button
      key={key}
      type="button"
      onClick={() => {
        onChange(value);
        setOpen(false);
      }}
      className={`${itemClass} ${active ? itemActive : itemIdle}`}
    >
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {active ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
    </button>
  );

  return (
    <Field
      label={label}
      hint={<span className="break-all font-mono">{rpcUrl}</span>}
      error={rpcError ? t(rpcError, "RPC format error") : undefined}
      errorProps={{ id: "config-rpc-error", role: "alert" }}
    >
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setOpen(!isOpen)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={label}
          className={`flex h-10 w-full items-center gap-2 rounded-[10px] border bg-surface px-3 text-left text-xs text-ink transition-colors hover:border-hairline-strong ${
            rpcError ? "border-danger" : "border-hairline"
          }`}
        >
          <span className="min-w-0 flex-1 truncate">{currentName}</span>
          <span className="shrink-0 font-mono text-[11px] text-ink-subtle">
            {chainId || t("common.na", "N/A")}
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-ink-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
        </button>

        {isOpen ? (
          <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-[10px] border border-hairline bg-surface p-1 shadow-lg">
            {presets.map((n) =>
              renderOption(String(n.chainId), n.name, selected === n.chainId, String(n.chainId)),
            )}

            {custom.length > 0 ? (
              <>
                <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
                  {t("familyTree.config.customNetworks", "Custom")}
                </div>
                {custom.map((n) =>
                  renderOption(
                    `custom-${n.chainId}`,
                    n.name,
                    selected === n.chainId,
                    String(n.chainId),
                  ),
                )}
              </>
            ) : null}

            <div className="my-1 h-px bg-hairline" aria-hidden />

            {renderOption(
              "custom",
              t("familyTree.config.customNetwork", "Custom network"),
              selected === "custom",
              "custom",
            )}
          </div>
        ) : null}
      </div>
    </Field>
  );
}

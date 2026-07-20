import { ChevronDown, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RefObject } from "react";
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

  const buttonClass = `w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors text-left`;
  const itemActive = "bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400";
  const itemIdle =
    "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50";

  return (
    <div className="space-y-2">
      <label className="block text-slate-700 dark:text-slate-300 mb-2 font-semibold">
        {t("familyTree.config.rpc")}:
      </label>
      <div className="flex flex-col gap-2">
        <div className="relative w-full" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setOpen(!isOpen)}
            className="w-full px-3 py-1.5 text-xs rounded-xl border bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 transition-all duration-200 shadow-xs border-slate-300 dark:border-slate-600 focus:border-orange-500 focus:ring-orange-500/60 dark:focus:border-orange-400 dark:focus:ring-orange-400/60 hover:border-orange-400 dark:hover:border-orange-500 flex items-center justify-between"
          >
            <span className="truncate">
              {selected === "custom"
                ? t("familyTree.config.customNetwork", "Custom network")
                : findOption(selected)?.name ||
                  t("familyTree.config.unknownNetwork", "Unknown")}
            </span>
            <ChevronDown
              className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${
                isOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {isOpen && (
            <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-h-60 overflow-y-auto custom-scrollbar overflow-x-hidden">
              <div className="p-1 space-y-0.5">
                {presets.map((n) => (
                  <button
                    key={n.chainId}
                    type="button"
                    onClick={() => {
                      onChange(String(n.chainId));
                      setOpen(false);
                    }}
                    className={`${buttonClass} ${selected === n.chainId ? itemActive : itemIdle}`}
                  >
                    <span className="truncate">{n.name}</span>
                    {selected === n.chainId && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                ))}

                {custom.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mt-2 mb-1">
                      {t("familyTree.config.customNetworks", "Custom")}
                    </div>
                    {custom.map((n) => (
                      <button
                        key={`custom-${n.chainId}`}
                        type="button"
                        onClick={() => {
                          onChange(String(n.chainId));
                          setOpen(false);
                        }}
                        className={`${buttonClass} ${
                          selected === n.chainId ? itemActive : itemIdle
                        }`}
                      >
                        <span className="truncate">{n.name}</span>
                        {selected === n.chainId && (
                          <Check className="w-3.5 h-3.5 shrink-0" />
                        )}
                      </button>
                    ))}
                  </>
                )}

                <div className="h-px bg-slate-100 dark:bg-slate-700/50 my-1.5 mx-2" />

                <button
                  type="button"
                  onClick={() => {
                    onChange("custom");
                    setOpen(false);
                  }}
                  className={`${buttonClass} ${selected === "custom" ? itemActive : itemIdle}`}
                >
                  <span className="truncate">
                    {t("familyTree.config.customNetwork", "Custom network")}
                  </span>
                  {selected === "custom" && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              </div>
            </div>
          )}
        </div>

        <input
          type="text"
          value={rpcUrl}
          readOnly
          className={`flex-1 px-3 py-1.5 text-xs font-mono rounded-xl border bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all duration-200 shadow-xs ${
            rpcError
              ? "border-red-400 focus:border-red-500 focus:ring-red-500/60 dark:border-red-500"
              : "border-slate-300 dark:border-slate-600 focus:border-orange-500 focus:ring-orange-500/60 dark:focus:border-orange-400 dark:focus:ring-orange-400/60 hover:border-orange-400 dark:hover:border-orange-500"
          }`}
        />
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400">
        {t("familyTree.config.chainId", "Chain ID")}: {chainId || t("common.na", "N/A")}
      </div>
      {rpcError && (
        <div className="text-red-500 dark:text-red-400 text-xs font-medium">
          {t(rpcError, "RPC format error")}
        </div>
      )}
    </div>
  );
}

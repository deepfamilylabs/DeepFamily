import {
  generateRandomIdentitySaltHex,
  type IdentitySaltMode,
} from "../../../../../shared/crypto/identityHash";
import type { AddVersionT } from "../model/addVersionTypes";

interface IdentityRecoveryModePanelProps {
  t: AddVersionT;
  mode: IdentitySaltMode;
  recoverySaltHex: string;
  onModeChange: (mode: IdentitySaltMode) => void;
  onRecoverySaltHexChange: (value: string) => void;
  title: string;
  hint: string;
  saltLabel: string;
  saltPlaceholder: string;
  notice?: string;
  compact?: boolean;
}

export function IdentityRecoveryModePanel({
  t,
  mode,
  recoverySaltHex,
  onModeChange,
  onRecoverySaltHexChange,
  title,
  hint,
  saltLabel,
  saltPlaceholder,
  notice,
  compact = false,
}: IdentityRecoveryModePanelProps) {
  return (
    <div
      className={`${compact ? "rounded-xl" : "rounded-2xl"} border border-blue-100 dark:border-blue-900/30 bg-blue-50/30 dark:bg-blue-900/10 p-4 space-y-4`}
    >
      <div className="space-y-1">
        <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h4>
        <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{hint}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onModeChange("deterministic")}
          className={`rounded-xl border px-4 py-3 text-left transition-all ${
            mode === "deterministic"
              ? "border-blue-500 bg-white dark:bg-gray-800 shadow-sm"
              : "border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40"
          }`}
        >
          <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
            {t("addVersion.identityModeStandard", "Standard")}
          </div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {t(
              "addVersion.identityModeStandardHint",
              "Deterministic identity salt. No recovery salt input required.",
            )}
          </div>
        </button>
        <button
          type="button"
          onClick={() => {
            onModeChange("random");
            onRecoverySaltHexChange(recoverySaltHex || generateRandomIdentitySaltHex());
          }}
          className={`rounded-xl border px-4 py-3 text-left transition-all ${
            mode === "random"
              ? "border-blue-500 bg-white dark:bg-gray-800 shadow-sm"
              : "border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40"
          }`}
        >
          <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
            {t("addVersion.identityModeEnhanced", "Enhanced")}
          </div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {t(
              "addVersion.identityModeEnhancedHint",
              "Random identity salt plus recovery. Reuse the same salt when minting or adding later versions.",
            )}
          </div>
        </button>
      </div>

      {mode === "random" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
              {saltLabel}
            </label>
            <button
              type="button"
              onClick={() => onRecoverySaltHexChange(generateRandomIdentitySaltHex())}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              {t("addVersion.regenerateRecoverySalt", "Generate New Salt")}
            </button>
          </div>
          <input
            type="text"
            value={recoverySaltHex}
            onChange={(event) => onRecoverySaltHexChange(event.target.value)}
            className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 text-xs font-mono text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
            placeholder={saltPlaceholder}
          />
          {notice && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">{notice}</p>
          )}
        </div>
      )}
    </div>
  );
}

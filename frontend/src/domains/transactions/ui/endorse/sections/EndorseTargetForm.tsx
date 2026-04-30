import { AlertCircle } from "lucide-react";
import { getFieldErrorA11y } from "../../../../../shared/ui";
import type { EndorseT } from "../model/endorseTypes";

export interface EndorseTargetFormProps {
  t: EndorseT;
  personHash: string;
  versionIndex: number;
  hashInputInvalid: boolean;
  hasValidTarget: boolean;
  isTargetValidOnChain: boolean;
  displayName: string;
  currentEndorsementCount: number;
  onPersonHashChange: (value: string) => void;
  onVersionIndexChange: (value: number) => void;
}

export function EndorseTargetForm({
  t,
  personHash,
  versionIndex,
  hashInputInvalid,
  hasValidTarget,
  isTargetValidOnChain,
  displayName,
  currentEndorsementCount,
  onPersonHashChange,
  onVersionIndexChange,
}: EndorseTargetFormProps) {
  const personHashA11y = getFieldErrorA11y({
    invalid: hashInputInvalid,
    errorId: "endorse-person-hash-error",
  });

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50">
        {t("endorse.targetVersion", "Target Version")}
      </h3>

      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-2xl border border-gray-100 dark:border-gray-800 p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 space-y-2">
            <label className="block text-sm font-bold text-gray-900 dark:text-gray-100">
              {t("endorse.personHash", "Person Hash")} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={personHash}
              onChange={(event) => onPersonHashChange(event.target.value)}
              {...personHashA11y.fieldProps}
              className={`w-full h-11 rounded-xl border bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 font-mono transition-all outline-none ${
                hashInputInvalid
                  ? "border-red-500 focus:border-red-500 focus:ring-4 focus:ring-red-500/10 dark:border-red-500"
                  : "border-gray-200 dark:border-gray-700 focus:border-orange-500 dark:focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10"
              }`}
              placeholder={t("search.versionsQuery.placeholder", "Search by person hash")}
            />
            {hashInputInvalid && (
              <div
                {...personHashA11y.errorProps}
                className="flex items-center gap-2 text-xs font-medium text-red-600 dark:text-red-400 p-2 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-100 dark:border-red-900/30"
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {t(
                  "endorse.invalidPersonHashFormat",
                  "Person hash must be 0x-prefixed 32-byte hex (64 hex chars).",
                )}
              </div>
            )}
            {!hashInputInvalid && hasValidTarget && (
              <div className="pt-2 animate-fadeIn">
                {isTargetValidOnChain ? (
                  <div className="flex flex-wrap items-center gap-3">
                    {displayName && (
                      <div className="font-bold text-gray-900 dark:text-gray-100 px-2 py-1 bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm text-sm">
                        {displayName}
                      </div>
                    )}
                    <div className="flex items-center gap-2 px-2 py-1 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-100 dark:border-orange-900/30">
                      <span className="text-xs font-bold uppercase tracking-wider text-orange-700 dark:text-orange-300">
                        {t("endorse.currentEndorsements", "Endorsements")}
                      </span>
                      <span className="text-sm font-bold font-mono text-orange-800 dark:text-orange-200">
                        {currentEndorsementCount}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-100 dark:border-amber-900/30">
                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                    <div className="space-y-0.5">
                      <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
                        {t("endorse.invalidTarget", "Invalid person hash or version index")}
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        {t(
                          "endorse.invalidTargetDesc",
                          "Please verify the hash and index refer to an existing version",
                        )}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="w-full sm:w-32 space-y-2">
            <label className="block text-sm font-bold text-gray-900 dark:text-gray-100">
              {t("endorse.versionIndex", "Version Index")} <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min="1"
              value={versionIndex}
              onChange={(event) => onVersionIndexChange(parseInt(event.target.value) || 1)}
              className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-orange-500 dark:focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 outline-none transition-all"
              placeholder="1"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

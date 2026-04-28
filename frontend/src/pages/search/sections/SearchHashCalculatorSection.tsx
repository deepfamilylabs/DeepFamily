import { PersonHashCalculator } from "../../../domains/person";
import type { SearchPageController } from "../hooks/useSearchPageController";
import { SectionCard } from "../ui/SearchPageUi";

export function SearchHashCalculatorSection({ search }: { search: SearchPageController }) {
  const { t } = search;
  const hash = search.hash;

  return (
    <SectionCard
      title={t("search.hashCalculator.title")}
      isOpen={search.openSections.hash}
      onToggle={() => search.toggle("hash")}
    >
      <div className="space-y-4">
        <div className="w-full">
          <PersonHashCalculator
            ref={hash.hashCalcRef}
            showTitle={false}
            collapsible={false}
            className="border-0 shadow-none bg-transparent p-0"
            identityMode={hash.identityMode}
            identitySaltHex={hash.identityMode === "random" ? hash.recoverySaltHex : undefined}
            onPublicFormChange={hash.onPublicFormChange}
          />
        </div>
        {hash.hasPassphrase && (
          <div className="rounded-2xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/30 dark:bg-blue-900/10 p-4 space-y-4">
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                {t("search.hashCalculator.identityMode", "Identity Recovery Mode")}
              </h4>
              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                {t(
                  "search.hashCalculator.identityModeHint",
                  "Standard mode recomputes the identity salt from public fields. Enhanced mode uses a recovery salt you must keep to reproduce the same identity on another device.",
                )}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={hash.useDeterministicIdentityMode}
                className={`rounded-xl border px-4 py-3 text-left transition-all ${
                  hash.identityMode === "deterministic"
                    ? "border-blue-500 bg-white dark:bg-gray-800 shadow-sm"
                    : "border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40"
                }`}
              >
                <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  {t("search.hashCalculator.identityModeStandard", "Standard")}
                </div>
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  {t(
                    "search.hashCalculator.identityModeStandardHint",
                    "Deterministic identity salt. No recovery salt input required.",
                  )}
                </div>
              </button>
              <button
                type="button"
                onClick={hash.useRandomIdentityMode}
                className={`rounded-xl border px-4 py-3 text-left transition-all ${
                  hash.identityMode === "random"
                    ? "border-blue-500 bg-white dark:bg-gray-800 shadow-sm"
                    : "border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40"
                }`}
              >
                <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  {t("search.hashCalculator.identityModeEnhanced", "Enhanced")}
                </div>
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  {t(
                    "search.hashCalculator.identityModeEnhancedHint",
                    "Random identity salt plus recovery. Reuse the same salt when you need to reproduce the same identity hash later.",
                  )}
                </div>
              </button>
            </div>

            {hash.identityMode === "random" && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
                    {t("search.hashCalculator.identityRecoverySalt", "Recovery Salt")}
                  </label>
                  <button
                    type="button"
                    onClick={hash.regenerateRecoverySalt}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    {t("search.hashCalculator.regenerateRecoverySalt", "Generate New Salt")}
                  </button>
                </div>
                <input
                  type="text"
                  value={hash.recoverySaltHex}
                  onChange={(event) => hash.setRecoverySaltHex(event.target.value)}
                  className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 text-xs font-mono text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                  placeholder={t(
                    "search.hashCalculator.identityRecoverySaltPlaceholder",
                    "Paste saved recovery salt or keep the generated value",
                  )}
                />
                <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                  {t(
                    "search.hashCalculator.identityRecoverySaltNotice",
                    "If this is a brand-new enhanced identity, keep the generated salt. If the identity already exists, replace it with the saved recovery salt before comparing hashes.",
                  )}
                </p>
              </div>
            )}
          </div>
        )}
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("search.hashCalculator.description")}
        </p>
      </div>
    </SectionCard>
  );
}

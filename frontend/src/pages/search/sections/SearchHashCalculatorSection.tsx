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
            onPublicFormChange={hash.onPublicFormChange}
          />
        </div>
        {hash.hasPassphrase && (
          <p className="rounded-xl border border-blue-100 bg-blue-50/30 p-3 text-xs text-gray-600 dark:border-blue-900/30 dark:bg-blue-900/10 dark:text-gray-400">
            {t(
              "search.hashCalculator.deterministicIdentityNotice",
              "Identity suite 1 always derives its salt deterministically from the canonical identity fields. No recovery salt is stored or accepted.",
            )}
          </p>
        )}
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("search.hashCalculator.description")}
        </p>
      </div>
    </SectionCard>
  );
}

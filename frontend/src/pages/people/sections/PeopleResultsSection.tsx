import { Users } from "lucide-react";
import { PersonStoryCard, type EndorseSuccessHandler } from "../../../domains/person";
import { PageContainer } from "../../../shared/ui";
import type { PeoplePageController } from "../hooks/usePeoplePageController";
import type { PeoplePageT } from "../model/peoplePageModel";

interface PeopleResultsSectionProps {
  t: PeoplePageT;
  projectionEnabled: boolean;
  loading: boolean;
  filters: PeoplePageController["filters"];
  results: PeoplePageController["results"];
  modal: PeoplePageController["modal"];
  preloadStoryData?: (tokenId: string) => void;
  onEndorseSuccess?: EndorseSuccessHandler;
}

export function PeopleResultsSection({
  t,
  projectionEnabled,
  loading,
  filters,
  results,
  modal,
  preloadStoryData,
  onEndorseSuccess,
}: PeopleResultsSectionProps) {
  const isLoading = !projectionEnabled || loading;

  return (
    <PageContainer className="pb-24" noPadding>
      {isLoading ? (
        <PeopleSkeletonGrid />
      ) : results.filteredPeople.length === 0 ? (
        <PeopleEmptyState t={t} filters={filters} />
      ) : (
        <>
          <div className="grid gap-6 px-4 sm:px-6 lg:px-8 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {results.visiblePeople.map((person) => (
              <PersonStoryCard
                key={person.id}
                person={person}
                onOpen={modal.openPerson}
                preloadStoryData={preloadStoryData}
                onEndorseSuccess={onEndorseSuccess}
              />
            ))}
          </div>
          {results.hasMore ? (
            <div className="mt-10 px-4 sm:px-6 lg:px-8">
              <div ref={results.loadMoreSentinelRef} className="h-1 w-full" />
              <div className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <div className="w-4 h-4 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
                <span>{t("common.loadingMore", "Loading more...")}</span>
              </div>
            </div>
          ) : null}
        </>
      )}
    </PageContainer>
  );
}

function PeopleSkeletonGrid() {
  return (
    <div className="grid gap-6 px-4 sm:px-6 lg:px-8 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="h-[520px] rounded-[2rem] border border-gray-200/80 dark:border-gray-800 bg-white/70 dark:bg-gray-900/40 animate-pulse"
        />
      ))}
    </div>
  );
}

function PeopleEmptyState({
  t,
  filters,
}: {
  t: PeoplePageT;
  filters: PeoplePageController["filters"];
}) {
  return (
    <div className="text-center py-32">
      <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gray-50 dark:bg-gray-900 mb-6">
        <Users className="w-10 h-10 text-gray-300 dark:text-gray-600" strokeWidth={1.5} />
      </div>
      <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
        {t("people.noResults", "No stories found")}
      </h3>
      <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-8">
        {t("people.noResultsDesc", "Try adjusting your search terms or filters")}
      </p>
      {filters.hasVisibleFilters && (
        <button
          type="button"
          onClick={filters.clearFilters}
          className="px-8 py-3 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-full font-medium hover:bg-orange-600 dark:hover:bg-orange-400 transition-colors"
        >
          {t("people.resetFilters", "Reset filters")}
        </button>
      )}
    </div>
  );
}

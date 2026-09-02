import { AlertCircle, RefreshCw, Users } from "lucide-react";
import { PersonStoryCard, type EndorseSuccessHandler } from "../../../domains/person";
import { PageContainer } from "../../../shared/ui";
import type { PeoplePageController } from "../hooks/usePeoplePageController";
import type { PeoplePageT } from "../model/peoplePageModel";
import { PeopleListHeader, PeopleListRow } from "../ui/PeopleListRow";

interface PeopleResultsSectionProps {
  t: PeoplePageT;
  projectionEnabled: boolean;
  loading: boolean;
  error?: string;
  retry?: () => void;
  filters: PeoplePageController["filters"];
  view: PeoplePageController["view"];
  results: PeoplePageController["results"];
  modal: PeoplePageController["modal"];
  preloadStoryData?: (tokenId: string) => void;
  onEndorseSuccess?: EndorseSuccessHandler;
}

export function PeopleResultsSection({
  t,
  projectionEnabled,
  loading,
  error,
  retry,
  filters,
  view,
  results,
  modal,
  preloadStoryData,
  onEndorseSuccess,
}: PeopleResultsSectionProps) {
  const isLoading = !projectionEnabled || loading;

  return (
    <PageContainer className="pt-5 pb-24">
      {isLoading ? (
        <PeopleSkeleton mode={view.mode} />
      ) : results.filteredPeople.length === 0 ? (
        error ? (
          <PeopleLoadError t={t} message={error} onRetry={retry} />
        ) : (
          <PeopleEmptyState t={t} filters={filters} />
        )
      ) : (
        <>
          {view.mode === "grid" ? (
            <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
          ) : (
            <div className="rounded-[20px] border border-hairline bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_20px_-14px_rgba(15,23,42,0.16)] dark:shadow-none overflow-hidden">
              <PeopleListHeader t={t} />
              {results.visiblePeople.map((person, index) => (
                <PeopleListRow
                  key={person.id}
                  t={t}
                  person={person}
                  isFirst={index === 0}
                  onOpen={modal.openPerson}
                  preloadStoryData={preloadStoryData}
                />
              ))}
            </div>
          )}

          {results.hasMore ? (
            <div className="mt-8">
              <div ref={results.loadMoreSentinelRef} className="h-1 w-full" />
              <div className="flex items-center justify-center gap-2 text-sm text-ink-muted">
                <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <span>{t("common.loadingMore", "Loading more...")}</span>
              </div>
            </div>
          ) : null}
        </>
      )}
    </PageContainer>
  );
}

function PeopleSkeleton({ mode }: { mode: PeoplePageController["view"]["mode"] }) {
  if (mode === "list") {
    return (
      <div className="rounded-[20px] border border-hairline bg-surface overflow-hidden">
        <div className="h-9 bg-surface-alt border-b border-hairline" />
        {Array.from({ length: 10 }).map((_, index) => (
          <div
            key={index}
            className={`flex items-center gap-3 h-13 px-5 animate-pulse ${
              index === 0 ? "" : "border-t border-hairline"
            }`}
          >
            <div className="w-6.5 h-6.5 rounded-full bg-surface-muted shrink-0" />
            <div className="h-3 w-40 rounded-md bg-surface-muted" />
            <div className="flex-1" />
            <div className="h-3 w-16 rounded-md bg-surface-muted hidden sm:block" />
            <div className="h-3 w-10 rounded-md bg-surface-muted" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <div
          key={index}
          className="h-[220px] p-[18px] rounded-3xl border border-hairline bg-surface animate-pulse"
        >
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-full bg-surface-muted shrink-0" />
            <div className="flex-1 pt-1 space-y-2">
              <div className="h-3.5 w-3/4 rounded-md bg-surface-muted" />
              <div className="h-2.5 w-1/2 rounded-md bg-surface-muted" />
            </div>
          </div>
          <div className="mt-3.5 space-y-2">
            <div className="h-2.5 w-3/5 rounded-md bg-surface-muted" />
            <div className="h-2.5 w-full rounded-md bg-surface-muted" />
            <div className="h-2.5 w-4/5 rounded-md bg-surface-muted" />
          </div>
          <div className="mt-4 pt-3 border-t border-hairline flex items-center justify-between">
            <div className="h-2.5 w-24 rounded-md bg-surface-muted" />
            <div className="w-[30px] h-[30px] rounded-full bg-surface-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function PeopleLoadError({
  t,
  message,
  onRetry,
}: {
  t: PeoplePageT;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-[20px] border border-hairline bg-surface py-20 px-8 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-danger/10 border border-danger/20">
        <AlertCircle className="w-7 h-7 text-danger" strokeWidth={1.5} />
      </div>
      <h3 className="mt-4 text-[17px] font-bold text-ink">
        {t("people.loadFailed", "Could not load people")}
      </h3>
      <p className="mt-1.5 text-sm text-ink-muted max-w-md mx-auto break-words">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 h-9 px-6 bg-ink text-surface rounded-full text-sm font-medium hover:bg-primary-hover hover:text-white transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          {t("common.retry", "Retry")}
        </button>
      )}
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
    <div className="rounded-[20px] border border-hairline bg-surface py-20 px-8 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-surface-alt border border-hairline">
        <Users className="w-7 h-7 text-hairline-strong" strokeWidth={1.5} />
      </div>
      <h3 className="mt-4 text-[17px] font-bold text-ink">
        {t("people.noResults", "No stories found")}
      </h3>
      <p className="mt-1.5 text-sm text-ink-muted max-w-md mx-auto">
        {t("people.noResultsDesc", "Try adjusting your search terms or filters")}
      </p>
      {filters.hasVisibleFilters && (
        <button
          type="button"
          onClick={filters.clearFilters}
          className="mt-5 inline-flex items-center h-9 px-6 bg-ink text-surface rounded-full text-sm font-medium hover:bg-primary-hover hover:text-white transition-colors"
        >
          {t("people.resetFilters", "Reset filters")}
        </button>
      )}
    </div>
  );
}

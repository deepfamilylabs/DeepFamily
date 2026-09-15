import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import type { PersonPageController } from "../hooks/usePersonPageController";

const BAR = "rounded-md bg-surface-muted";

/** Shaped like the loaded page — the same grid and rhythm — so nothing jumps when data lands. */
export function PersonLoadingState() {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="grid animate-pulse items-start gap-7 motion-reduce:animate-none xl:grid-cols-[248px_minmax(0,1fr)_256px]"
    >
      <span className="sr-only">{t("storyRecordsModal.loading", "Loading story records...")}</span>
      <div className="hidden h-[420px] rounded-[20px] bg-surface-muted xl:block" />

      <div className="min-w-0">
        <div className={`h-2.5 w-14 ${BAR}`} />
        <div className={`mt-3 h-8 w-40 sm:h-9 ${BAR}`} />
        <div className="mt-5 flex gap-4">
          <div className={`h-[34px] w-24 ${BAR}`} />
          <div className={`h-[34px] w-20 ${BAR}`} />
          <div className={`h-[34px] w-11 ${BAR}`} />
        </div>
        <div className="mt-7 flex flex-col gap-3">
          <div className={`h-3 w-full ${BAR}`} />
          <div className={`h-3 w-[94%] ${BAR}`} />
          <div className={`h-3 w-[97%] ${BAR}`} />
          <div className={`h-3 w-[58%] ${BAR}`} />
        </div>
        <div className="mt-11 flex items-center gap-3">
          <div className="h-[29px] w-[29px] rounded-full bg-surface-muted" />
          <div className={`h-4 w-24 ${BAR}`} />
        </div>
        <div className="ml-11 mt-4 flex flex-col gap-3">
          <div className={`h-3 w-full ${BAR}`} />
          <div className={`h-3 w-[70%] ${BAR}`} />
        </div>
      </div>

      <div className="hidden h-[300px] rounded-[18px] bg-surface-muted xl:block" />
    </div>
  );
}

/** Stands in for the whole page: why it could not load, a retry and a way back side by side. */
export function PersonErrorAlert({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();

  if (!person.error) return null;

  return (
    <div
      role="alert"
      className="flex flex-col gap-4 rounded-2xl border border-danger/25 bg-danger/6 p-5 sm:flex-row sm:items-start"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-danger/12 text-danger">
        <AlertTriangle size={18} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{t("person.fetchFailed", "Failed to load token")}</p>
        <p className="mt-0.5 break-words text-[13.5px] text-ink-muted">{person.error}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={person.retry}
          className="inline-flex h-9 items-center rounded-full bg-danger px-4 text-[13px] font-semibold text-white transition-colors hover:bg-danger/90 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-danger/40 dark:text-surface-body"
        >
          {t("common.retry", "Retry")}
        </button>
        <button
          type="button"
          onClick={person.goBack}
          className="inline-flex h-9 items-center rounded-full border border-hairline-strong bg-surface px-4 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-alt focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          {t("common.goBack", "Go Back")}
        </button>
      </div>
    </div>
  );
}

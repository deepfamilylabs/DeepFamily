import { useTranslation } from "react-i18next";
import type { PersonPageController } from "../hooks/usePersonPageController";

export function PersonLoadingState() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
      <div className="animate-pulse w-full max-w-4xl px-4">
        <div className="h-6 bg-gray-200 rounded-sm w-1/3 mb-6" />
        <div className="space-y-3">
          <div className="h-4 bg-gray-200 rounded-sm" />
          <div className="h-4 bg-gray-200 rounded-sm w-5/6" />
          <div className="h-4 bg-gray-200 rounded-sm w-2/3" />
        </div>
      </div>
    </div>
  );
}

export function PersonErrorAlert({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();

  if (!person.error) return null;

  return (
    <div className="pb-4">
      <div
        role="alert"
        className="mb-6 flex flex-col sm:flex-row sm:items-start gap-4 rounded-xl border border-red-300 dark:border-red-700/50 bg-red-50/80 dark:bg-red-900/30 p-5 shadow-xs"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-red-700 dark:text-red-300 mb-1">
            {t("person.fetchFailed", "Failed to load token")}
          </p>
          <p className="text-sm text-red-600 dark:text-red-200 wrap-break-word">{person.error}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={person.retry}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 hover:bg-red-700 text-white shadow-xs"
          >
            {t("common.retry", "Retry")}
          </button>
          <button
            onClick={person.goBack}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-800/40 bg-white dark:bg-transparent"
          >
            {t("common.goBack", "Go Back")}
          </button>
        </div>
      </div>
    </div>
  );
}

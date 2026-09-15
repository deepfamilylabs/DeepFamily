import { useId } from "react";
import { AlertTriangle } from "lucide-react";
import { TransactionButton } from "./TransactionButton";
import { CopyValueButton } from "./TransactionSuccessSummary";
import { useFocusOnMount } from "./useFocusOnMount";

type ErrorResult = {
  type: string;
  message: string;
  details: string;
};

/** Codes that name no cause of their own; showing them only adds noise. */
const UNINFORMATIVE_TYPES = new Set(["UNKNOWN_ERROR", "VALIDATION_ERROR"]);

/**
 * What a failed transaction leaves the user with, shaped like the success summary.
 *
 * The earlier panel gave the error code, the message and the raw details three
 * equal red boxes, code first — so a generic "UNKNOWN_ERROR" was the loudest
 * thing on screen and the one concrete cause came last. The message leads now,
 * the concrete cause follows with a copy button for reporting it, and a code is
 * shown only when it says something the message does not.
 */
export function TransactionErrorResult({
  t,
  title,
  error,
  typeLabel,
  detailsLabel,
  retry,
}: {
  t: (key: string, fallback: string) => string;
  title: string;
  error: ErrorResult;
  typeLabel: string;
  detailsLabel: string;
  retry?: {
    label: string;
    onClick: () => void;
  };
}) {
  const panelRef = useFocusOnMount<HTMLDivElement>();
  const titleId = useId();
  const details = error.details && error.details !== error.message ? error.details : "";
  const code = error.type && !UNINFORMATIVE_TYPES.has(error.type) ? error.type : "";
  const report = [code, details || error.message].filter(Boolean).join(": ");

  return (
    <div
      ref={panelRef}
      role="alert"
      aria-live="assertive"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="rounded-xl border border-danger/25 bg-danger/10 outline-hidden animate-fade-in"
    >
      <div className="flex items-start gap-3 p-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-danger">
          <AlertTriangle className="h-4 w-4 text-white" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-sm font-semibold leading-8 text-ink">
            {title}
          </h3>
          <p className="text-[13px] leading-relaxed text-ink">{error.message}</p>
        </div>
      </div>

      {details || code ? (
        <dl className="space-y-2 border-t border-danger/20 px-4 py-3">
          {details ? (
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-3">
              <dt className="shrink-0 text-xs leading-5 text-ink-muted sm:w-20">{detailsLabel}</dt>
              <dd className="flex min-w-0 flex-1 items-start gap-1.5">
                <span className="min-w-0 flex-1 font-mono text-xs leading-5 text-ink [overflow-wrap:anywhere]">
                  {details}
                </span>
                <CopyValueButton
                  label={`${t("common.copy", "Copy")} ${detailsLabel}`}
                  value={report}
                />
              </dd>
            </div>
          ) : null}
          {code ? (
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-3">
              <dt className="shrink-0 text-xs leading-5 text-ink-muted sm:w-20">{typeLabel}</dt>
              <dd className="min-w-0 flex-1 font-mono text-xs leading-5 text-ink-muted [overflow-wrap:anywhere]">
                {code}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {/* Secondary: the footer already carries the view's primary action. */}
      {retry ? (
        <div className="border-t border-danger/20 px-4 py-3">
          <TransactionButton
            variant="secondary"
            onClick={retry.onClick}
            className="w-full sm:w-auto"
          >
            {retry.label}
          </TransactionButton>
        </div>
      ) : null}
    </div>
  );
}

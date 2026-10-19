import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2 } from "lucide-react";

export type ShieldedProgressStage =
  | "preparing"
  | "proving"
  | "checkingGas"
  | "submitting"
  | "confirming";

/** The stages a pool action reports while it is proven and sent. */
export const SHIELDED_ACTION_STAGES = [
  "proving",
  "checkingGas",
  "submitting",
  "confirming",
] as const;
/** An ERC-20 approval is only sent and confirmed. */
export const SHIELDED_APPROVAL_STAGES = ["submitting", "confirming"] as const;

const CARD_SHADOW =
  "shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_40px_-26px_rgba(15,23,42,0.22)] dark:shadow-none";
/** The same card on a wide screen, where a compact receipt stops being a bar. */
const WIDE_CARD =
  "lg:gap-5 lg:rounded-[20px] lg:border lg:p-6 lg:shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_40px_-26px_rgba(15,23,42,0.22)] lg:dark:shadow-none";

/**
 * The live result of the task beside its form. On a phone a compact receipt
 * becomes a bar pinned above the status bar, keeping its total and action in reach.
 */
export function ShieldedTaskReceipt({
  label,
  compact = false,
  headline,
  details,
  notices,
  action,
}: {
  label: string;
  /** Pin to the bottom of a phone screen and leave the details to wider screens. */
  compact?: boolean;
  headline: ReactNode;
  details?: ReactNode;
  notices?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      className={`min-w-0 flex-[1_1_21rem] ${
        compact
          ? "sticky bottom-[var(--app-statusbar-h)] z-20 -mx-4 sm:-mx-6 lg:bottom-auto lg:top-6 lg:mx-0"
          : "lg:sticky lg:top-6"
      }`}
    >
      <div
        className={`flex flex-col border-hairline bg-surface ${
          compact
            ? `gap-3 border-t px-4 pb-4 pt-3.5 shadow-[0_-12px_28px_-20px_rgba(15,23,42,0.3)] sm:px-6 ${WIDE_CARD}`
            : `gap-5 rounded-[20px] border p-5 sm:p-6 ${CARD_SHADOW}`
        }`}
      >
        {headline}
        {details ? (
          <div className={`flex-col gap-5 ${compact ? "hidden lg:flex" : "flex"}`}>{details}</div>
        ) : null}
        {notices}
        {action}
      </div>
    </aside>
  );
}

/** The amount the task moves, with what it means beneath it. */
export function ReceiptHeadline({
  value,
  symbol,
  caption,
  sub,
  muted = false,
  compact = false,
}: {
  value: string;
  symbol: string;
  caption?: ReactNode;
  sub?: ReactNode;
  muted?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? "flex flex-row-reverse items-end justify-between gap-3 lg:flex-col lg:items-stretch lg:justify-start lg:gap-2"
          : "flex flex-col gap-2"
      }
    >
      <p className="flex shrink-0 flex-wrap items-baseline gap-x-2">
        <span
          className={`font-display font-extrabold leading-none tracking-[-0.01em] tabular-nums ${
            muted ? "text-ink-subtle" : "text-ink"
          } ${compact ? "text-[34px] lg:text-[52px]" : "text-[44px] sm:text-[52px]"}`}
        >
          {value}
        </span>
        <span className="text-sm font-medium text-ink-muted">{symbol}</span>
      </p>
      {caption || sub ? (
        <div className="min-w-0 space-y-1">
          {caption ? <p className="text-sm leading-normal text-ink/80">{caption}</p> : null}
          {sub ? <p className="text-[13px] text-ink-muted">{sub}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function ReceiptRows({ rows }: { rows: readonly { label: string; value: ReactNode }[] }) {
  return (
    <dl className="flex flex-col gap-2.5 border-t border-hairline/70 pt-4 text-[13px]">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4">
          <dt className="shrink-0 text-ink-muted">{row.label}</dt>
          <dd className="min-w-0 break-words text-right font-medium tabular-nums text-ink">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export type ShieldedPeriodSegment = "next" | "funded" | "selected" | "claimable" | "upcoming";

const SEGMENT_CLASS: Record<ShieldedPeriodSegment, string> = {
  next: "bg-primary",
  funded: "bg-orange-200 dark:bg-orange-400/30",
  selected: "bg-primary",
  claimable: "bg-orange-300 dark:bg-orange-400/45",
  upcoming: "bg-surface-muted",
};

/** One segment per period; colours differ in lightness, so they read without hue. */
export function ShieldedPeriodBar({
  segments,
  more,
}: {
  segments: readonly ShieldedPeriodSegment[];
  more?: number;
}) {
  return (
    <div aria-hidden="true" className="flex items-center gap-[3px]">
      {segments.map((segment, index) => (
        <span
          key={index}
          className={`h-5 min-w-0.5 flex-1 rounded-[4px] ${SEGMENT_CLASS[segment]}`}
        />
      ))}
      {more ? <span className="ml-1 text-xs tabular-nums text-ink-muted">+{more}</span> : null}
    </div>
  );
}

/** The proving and sending stages of the step in progress, in order. */
export function ShieldedProgressList({
  stage,
  stages = SHIELDED_ACTION_STAGES,
}: {
  stage: ShieldedProgressStage | null;
  stages?: readonly ShieldedProgressStage[];
}) {
  const { t } = useTranslation();
  const current = stage ? stages.indexOf(stage) : -1;
  return (
    <ol className="flex flex-col gap-2.5">
      {stages.map((item, index) => {
        const state = index < current ? "done" : index === current ? "active" : "pending";
        return (
          <li
            key={item}
            aria-current={state === "active" ? "step" : undefined}
            className={`flex items-center gap-2.5 text-[13px] ${
              state === "active"
                ? "font-semibold text-orange-800 dark:text-orange-300"
                : state === "done"
                  ? "text-ink/80"
                  : "text-ink-muted"
            }`}
          >
            {state === "done" ? (
              <CheckCircle2
                className="h-[18px] w-[18px] shrink-0 text-success"
                aria-hidden="true"
              />
            ) : state === "active" ? (
              <Loader2
                className="h-[18px] w-[18px] shrink-0 animate-spin text-orange-600 dark:text-orange-300"
                aria-hidden="true"
              />
            ) : (
              <span
                aria-hidden="true"
                className="h-[18px] w-[18px] shrink-0 rounded-full border-2 border-hairline-strong"
              />
            )}
            {t(`shielded.stages.${item}`)}
          </li>
        );
      })}
    </ol>
  );
}

import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import type { WalletNoteView } from "../../../shared/workers/walletWorkerTypes";
import { SECONDS_PER_DAY, formatShieldedTimestamp } from "../model/shieldedBudgetPeriod";
import { formatShieldedAmount } from "../model/shieldedDisplay";
import { CHOICE_INPUT, TaskHeader, TaskSection, choiceCardClass } from "./inheritanceControls";

/** Up to this many upcoming periods are listed; a longer schedule shows its last one after a gap. */
const UPCOMING_ROWS = 6;

export type ShieldedClaimScheduleRow =
  | { kind: "claimable"; index: string; period: bigint; dueAt: bigint }
  | { kind: "upcoming"; period: bigint; dueAt: bigint }
  | { kind: "gap" };

/** The period that can be claimed now, then the funded periods after it. */
export function buildShieldedClaimSchedule(
  budget: WalletNoteView,
  now: bigint,
): ShieldedClaimScheduleRow[] {
  const rate = BigInt(budget.rate ?? "0");
  const step = BigInt(budget.periodDays ?? "0") * SECONDS_PER_DAY;
  const start = BigInt(budget.eligibleFrom ?? "0");
  if (rate <= 0n || step <= 0n) return [];
  const dueAt = (index: bigint) => start + (index + 1n) * step;
  let count = BigInt(budget.amount) / rate;
  const rows: ShieldedClaimScheduleRow[] = [];
  let next: bigint;
  if (budget.claimPeriod !== undefined) {
    const index = BigInt(budget.claimPeriod);
    rows.push({
      kind: "claimable",
      index: budget.claimPeriod,
      period: index + 1n,
      dueAt: dueAt(index),
    });
    count -= 1n;
    next = index + 1n;
  } else {
    // Every period that has fallen due is claimed; the next one falls due later.
    next = now > start ? (now - start) / step : 0n;
  }
  const upcoming = (offset: bigint): ShieldedClaimScheduleRow => ({
    kind: "upcoming",
    period: next + offset + 1n,
    dueAt: dueAt(next + offset),
  });
  if (count <= BigInt(UPCOMING_ROWS)) {
    for (let offset = 0n; offset < count; offset += 1n) rows.push(upcoming(offset));
  } else {
    for (let offset = 0n; offset < BigInt(UPCOMING_ROWS - 1); offset += 1n)
      rows.push(upcoming(offset));
    rows.push({ kind: "gap" }, upcoming(count - 1n));
  }
  return rows;
}

export interface ShieldedClaimComposerProps {
  titleId: string;
  symbol: string;
  decimals: number;
  busy: boolean;
  /** Recovered budgets, or null before the first recovery. */
  budgets: readonly WalletNoteView[] | null;
  now: bigint;
  claimHandle: string;
  onClaimChange: (value: string) => void;
  claimPeriods: string[];
  onClaimPeriodsChange: (value: string[]) => void;
}

/** Choose a budget, then the due period to claim along its schedule. */
export function ShieldedClaimComposer(props: ShieldedClaimComposerProps) {
  const { t } = useTranslation();
  const { symbol, decimals, busy, titleId, now } = props;
  const budgets = props.budgets ?? [];
  const selectedBudget =
    budgets.find((budget) => budget.handle === props.claimHandle) ??
    budgets.find((budget) => budget.claimPeriod !== undefined) ??
    budgets[0];
  const schedule = selectedBudget ? buildShieldedClaimSchedule(selectedBudget, now) : [];
  const date = (seconds: bigint) =>
    formatShieldedTimestamp(seconds, "date") ?? t("shielded.dateOutOfRange", { symbol });
  const periodLabel = (period: bigint) =>
    t("shielded.claimPeriodOption", {
      symbol,
      period: String(period),
      amount: formatShieldedAmount(selectedBudget?.rate ?? "0", decimals),
    });
  const toggle = (index: string, checked: boolean) =>
    props.onClaimPeriodsChange(checked ? [index] : []);

  return (
    <>
      <TaskHeader
        id={titleId}
        title={t("shielded.actions.claim", { symbol })}
        description={t("shielded.descriptions.claim", { symbol })}
      />
      <TaskSection
        id={`${titleId}-budget`}
        step={1}
        title={t("shielded.fields.budgetNote", { symbol })}
      >
        {budgets.length === 0 ? (
          <p role="status" className="rounded-xl bg-surface-alt px-3.5 py-3 text-sm text-ink-muted">
            {t(
              props.budgets ? "shielded.claimOverview.noFunds" : "shielded.claimOverview.checking",
              {
                symbol,
              },
            )}
          </p>
        ) : (
          <fieldset
            disabled={busy}
            className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(13.75rem,100%),1fr))] gap-2"
          >
            {budgets.map((budget, index) => {
              const selected = budget.handle === selectedBudget?.handle;
              return (
                <label
                  key={budget.handle}
                  className={`flex items-start gap-3 p-3.5 ${choiceCardClass(selected, busy)}`}
                >
                  <input
                    type="radio"
                    name={`${titleId}-budget`}
                    value={budget.handle}
                    className={`${CHOICE_INPUT} mt-0.5`}
                    checked={selected}
                    onChange={() => props.onClaimChange(budget.handle)}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-semibold text-ink">
                      {t("shielded.budgetOption", {
                        symbol,
                        index: index + 1,
                        amount: formatShieldedAmount(budget.amount, decimals),
                      })}
                    </span>
                    <span className="text-[13px] text-ink-muted">
                      {t("shielded.periodDaysSummary", { symbol, days: budget.periodDays ?? "—" })}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
      </TaskSection>

      {/* With nothing to list, the receipt alone states why no period can be claimed. */}
      {selectedBudget && schedule.length > 0 ? (
        <TaskSection
          id={`${titleId}-periods`}
          step={2}
          title={t("shielded.claimPeriodsLabel", { symbol })}
        >
          <fieldset disabled={busy} className="relative flex min-w-0 flex-col gap-1.5">
            <span
              aria-hidden="true"
              className="absolute bottom-6 left-[15px] top-6 w-0.5 rounded-full bg-hairline"
            />
            {schedule.map((row, rowIndex) => {
              const listed = schedule
                .slice(0, rowIndex)
                .filter(
                  (item): item is Exclude<ShieldedClaimScheduleRow, { kind: "gap" }> =>
                    item.kind !== "gap",
                );
              const previous = listed[listed.length - 1];
              const divider =
                row.kind === "upcoming" &&
                row.dueAt > now &&
                (!previous || previous.kind === "claimable" || previous.dueAt <= now);
              if (row.kind === "gap") {
                return (
                  <div key="gap" aria-hidden="true" className="flex items-center gap-2.5 py-0.5">
                    <span className="flex w-8 shrink-0 justify-center text-ink-subtle">⋯</span>
                  </div>
                );
              }
              if (row.kind === "claimable") {
                const checked = props.claimPeriods.includes(row.index);
                const label = periodLabel(row.period);
                return (
                  <label
                    key={`claimable-${row.index}`}
                    className="relative flex cursor-pointer items-center gap-2.5"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center">
                      <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-surface ring-4 ring-surface">
                        <input
                          type="checkbox"
                          aria-label={label}
                          className={`${CHOICE_INPUT} h-[18px] w-[18px] rounded`}
                          checked={checked}
                          onChange={(event) => toggle(row.index, event.target.checked)}
                        />
                      </span>
                    </span>
                    <span
                      className={`flex min-h-[54px] min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-xl border-[1.5px] px-3.5 py-2 ${
                        checked
                          ? "border-orange-300 bg-orange-50 dark:border-orange-400/50 dark:bg-orange-400/10"
                          : "border-hairline bg-surface"
                      }`}
                    >
                      <span className="text-sm font-semibold tabular-nums text-ink">{label}</span>
                      <span className="text-xs tabular-nums text-ink-muted">
                        {t("shielded.claimPeriodDue", { symbol, date: date(row.dueAt) })}
                      </span>
                    </span>
                  </label>
                );
              }
              return (
                <Fragment key={`upcoming-${row.period}`}>
                  {divider ? (
                    <div className="flex items-center gap-2.5 pb-0.5 pt-2">
                      <span aria-hidden="true" className="w-8 shrink-0" />
                      <span className="text-xs font-semibold text-ink-muted">
                        {t("shielded.claimOverview.notDue", { symbol })}
                      </span>
                    </div>
                  ) : null}
                  <div className="relative flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 shrink-0 items-center justify-center"
                    >
                      <span className="h-3 w-3 rounded-full border-2 border-hairline-strong bg-surface ring-4 ring-surface" />
                    </span>
                    <span className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-xl bg-surface-alt px-3.5 py-1.5">
                      <span className="text-sm tabular-nums text-ink/80">
                        {periodLabel(row.period)}
                      </span>
                      <span className="text-xs tabular-nums text-ink-muted">
                        {t("shielded.claimPeriodDue", { symbol, date: date(row.dueAt) })}
                      </span>
                    </span>
                  </div>
                </Fragment>
              );
            })}
          </fieldset>
        </TaskSection>
      ) : null}
    </>
  );
}

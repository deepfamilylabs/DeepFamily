import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import type {
  ShieldedClaimSummary,
  ShieldedKeySlot,
  ShieldedNoteSummary,
  ShieldedWalletSummary,
} from "../../../shared/workers/shieldedAssetWorkerTypes";
import { formatShieldedTimestamp } from "../model/shieldedBudgetPeriod";
import { formatShieldedAmount } from "../model/shieldedDisplay";
import {
  CHOICE_INPUT,
  TaskHeader,
  TaskSection,
  WarningNotice,
  choiceCardClass,
} from "./inheritanceControls";

const SECONDS_PER_DAY = 86_400n;
/** Up to this many upcoming periods are listed; a longer schedule shows its last one after a gap. */
const UPCOMING_ROWS = 6;

export type ShieldedClaimScheduleRow =
  | { kind: "claimable"; index: string; period: bigint; dueAt?: bigint }
  | { kind: "upcoming"; period: bigint; dueAt: bigint }
  | { kind: "gap" };

/** Claimable periods, then the funded periods that are not due yet. */
export function buildShieldedClaimSchedule(
  claim: ShieldedClaimSummary,
  budget?: ShieldedNoteSummary,
): ShieldedClaimScheduleRow[] {
  const claimable = [...claim.periodIndices]
    .sort((first, second) => (BigInt(first) < BigInt(second) ? -1 : 1))
    .map(
      (index): ShieldedClaimScheduleRow => ({
        kind: "claimable",
        index,
        period: BigInt(index) + 1n,
        dueAt:
          budget?.eligibleFrom !== undefined && budget.periodDays !== undefined
            ? BigInt(budget.eligibleFrom) +
              (BigInt(index) + 1n) * BigInt(budget.periodDays) * SECONDS_PER_DAY
            : undefined,
      }),
    );
  if (
    claim.nextDueAt === undefined ||
    claim.nextPeriodIndex === undefined ||
    claim.futurePeriods === undefined ||
    claim.periodDays === undefined
  )
    return claimable;
  const count = BigInt(claim.futurePeriods);
  const first = BigInt(claim.nextPeriodIndex);
  const step = BigInt(claim.periodDays) * SECONDS_PER_DAY;
  const upcoming = (offset: bigint): ShieldedClaimScheduleRow => ({
    kind: "upcoming",
    period: first + offset + 1n,
    dueAt: BigInt(claim.nextDueAt!) + offset * step,
  });
  const rows: ShieldedClaimScheduleRow[] = [];
  if (count <= BigInt(UPCOMING_ROWS)) {
    for (let offset = 0n; offset < count; offset += 1n) rows.push(upcoming(offset));
  } else {
    for (let offset = 0n; offset < BigInt(UPCOMING_ROWS - 1); offset += 1n)
      rows.push(upcoming(offset));
    rows.push({ kind: "gap" }, upcoming(count - 1n));
  }
  return [...claimable, ...rows];
}

/** The budget note a claim draws from, which carries its start time and interval. */
export function findShieldedClaimBudget(
  wallet: ShieldedWalletSummary | null,
  claim: ShieldedClaimSummary | undefined,
): ShieldedNoteSummary | undefined {
  return wallet?.notes.find(
    (note) => note.kind === "budget" && !!claim?.budgets.includes(note.commitment),
  );
}

export interface ShieldedClaimComposerProps {
  titleId: string;
  symbol: string;
  decimals: number;
  busy: boolean;
  wallet: ShieldedWalletSummary | null;
  slot: ShieldedKeySlot;
  identityReady: boolean;
  /** Claims from a funds-key budget need the original funds key unlocked. */
  independentKeyReady: boolean;
  claimHandle: string;
  onClaimChange: (value: string) => void;
  claimPeriods: string[];
  onClaimPeriodsChange: (value: string[]) => void;
}

/** Choose a budget, then the due periods to claim along its schedule. */
export function ShieldedClaimComposer(props: ShieldedClaimComposerProps) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`shielded.walletKeys.${key}`);
  const { symbol, decimals, busy, wallet, titleId } = props;
  const claims = wallet?.claims.filter((claim) => claim.slot === props.slot) ?? [];
  const defaultClaim = claims.find((claim) => claim.status === "claimable") ?? claims[0];
  const selectedClaim = claims.find((claim) => claim.handle === props.claimHandle) ?? defaultClaim;
  const budgets =
    wallet?.notes.filter((note) => note.kind === "budget" && note.slot === props.slot) ?? [];
  const claimUnavailable =
    !!props.claimHandle && !claims.some((claim) => claim.handle === props.claimHandle);
  const claimSelectionUnavailable =
    !!selectedClaim &&
    props.claimPeriods.some((index) => !selectedClaim.periodIndices.includes(index));
  const schedule = selectedClaim
    ? buildShieldedClaimSchedule(selectedClaim, findShieldedClaimBudget(wallet, selectedClaim))
    : [];
  const date = (seconds: bigint | undefined) =>
    seconds === undefined
      ? undefined
      : (formatShieldedTimestamp(seconds, "date") ?? t("shielded.dateOutOfRange", { symbol }));
  const periodLabel = (period: bigint) =>
    t("shielded.claimPeriodOption", {
      symbol,
      period: String(period),
      amount: formatShieldedAmount(selectedClaim?.amountPerPeriod ?? "0", decimals),
    });
  const toggle = (index: string, checked: boolean) =>
    props.onClaimPeriodsChange(
      checked
        ? [...props.claimPeriods, index].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
        : props.claimPeriods.filter((value) => value !== index),
    );

  const header = (
    <TaskHeader
      id={titleId}
      title={t("shielded.actions.claim", { symbol })}
      description={t("shielded.descriptions.claim", { symbol })}
    >
      {!props.identityReady ? (
        <div className="pt-3">
          <WarningNotice>{tr("fundsRestoredIdentityHint")}</WarningNotice>
        </div>
      ) : null}
    </TaskHeader>
  );

  // Unlocking or creating keys belongs to the funds key card above.
  if (props.slot === "asset" && !props.independentKeyReady) {
    return (
      <>
        {header}
        <div className="mt-6">
          <WarningNotice>{tr("claimFundsKeyRequired")}</WarningNotice>
        </div>
      </>
    );
  }

  const status = !wallet
    ? t("shielded.claimOverview.checking", { symbol })
    : budgets.length === 0
      ? t("shielded.claimOverview.noFunds", { symbol })
      : t("shielded.claimOverview.ineligible", { symbol });

  return (
    <>
      {header}
      <TaskSection
        id={`${titleId}-budget`}
        step={1}
        title={t("shielded.fields.budgetNote", { symbol })}
      >
        {claims.length === 0 ? (
          <p role="status" className="rounded-xl bg-surface-alt px-3.5 py-3 text-sm text-ink-muted">
            {status}
          </p>
        ) : (
          <fieldset
            disabled={busy}
            className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(13.75rem,100%),1fr))] gap-2"
          >
            {claims.map((claim, index) => {
              const notes = budgets.filter((note) => claim.budgets.includes(note.commitment));
              const remaining = notes.reduce((sum, note) => sum + BigInt(note.amount), 0n);
              const selected = claim.handle === selectedClaim?.handle;
              return (
                <label
                  key={claim.handle}
                  className={`flex items-start gap-3 p-3.5 ${choiceCardClass(selected, busy)}`}
                >
                  <input
                    type="radio"
                    name={`${titleId}-budget`}
                    value={claim.handle}
                    className={`${CHOICE_INPUT} mt-0.5`}
                    checked={selected}
                    onChange={() => props.onClaimChange(claim.handle)}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-semibold text-ink">
                      {t("shielded.budgetOption", {
                        symbol,
                        index: index + 1,
                        amount: formatShieldedAmount(
                          claim.totalRemaining !== undefined
                            ? claim.totalRemaining
                            : notes.length
                              ? remaining
                              : claim.amount,
                          decimals,
                        ),
                      })}
                    </span>
                    <span className="text-[13px] text-ink-muted">
                      {t("shielded.periodDaysSummary", {
                        symbol,
                        days: claim.periodDays ?? notes[0]?.periodDays ?? "—",
                      })}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        {claimUnavailable || claimSelectionUnavailable ? (
          <WarningNotice>
            {t("shielded.claimSelectionUnavailable", { symbol })}
            <button
              type="button"
              disabled={busy}
              className="ml-2 font-medium text-orange-700 hover:underline dark:text-orange-300"
              onClick={() => {
                props.onClaimChange(defaultClaim?.handle ?? "");
                props.onClaimPeriodsChange(defaultClaim?.periodIndices ?? []);
              }}
            >
              {t("shielded.reselectClaim", { symbol })}
            </button>
          </WarningNotice>
        ) : null}
      </TaskSection>

      {/* With nothing to list, the receipt alone states why no period can be claimed. */}
      {selectedClaim && schedule.length > 0 ? (
        <TaskSection
          id={`${titleId}-periods`}
          step={2}
          title={t("shielded.claimPeriodsLabel", { symbol })}
          trailing={
            selectedClaim.periodIndices.length > 0 ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-ink-muted">
                  {t("shielded.claimPeriodsHint", { symbol })}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  className="h-8 shrink-0 rounded-lg border border-hairline-strong bg-surface px-2.5 text-[13px] font-semibold text-orange-800 transition-colors hover:bg-surface-alt disabled:opacity-50 dark:text-orange-300"
                  onClick={() => props.onClaimPeriodsChange(selectedClaim.periodIndices)}
                >
                  {t("shielded.selectAllClaimPeriods", { symbol })}
                </button>
              </div>
            ) : undefined
          }
        >
          <fieldset disabled={busy} className="relative flex min-w-0 flex-col gap-1.5">
            <span
              aria-hidden="true"
              className="absolute bottom-6 left-[15px] top-6 w-0.5 rounded-full bg-hairline"
            />
            {schedule.map((row, rowIndex) => {
              const previous = schedule[rowIndex - 1];
              const divider =
                row.kind === "upcoming" && (!previous || previous.kind === "claimable");
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
                      {row.dueAt !== undefined ? (
                        <span className="text-xs tabular-nums text-ink-muted">
                          {t("shielded.claimPeriodDue", { symbol, date: date(row.dueAt) })}
                        </span>
                      ) : null}
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

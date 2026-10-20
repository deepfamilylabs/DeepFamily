import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatShieldedTimestamp } from "../model/shieldedBudgetPeriod";
import { formatShieldedAmount } from "../model/shieldedDisplay";
import {
  ReceiptHeadline,
  ReceiptRows,
  ShieldedPeriodBar,
  ShieldedTaskReceipt,
  type ShieldedPeriodSegment,
} from "./ShieldedTaskReceipt";

const SECONDS_PER_DAY = 86_400n;
/** Longer schedules draw their first segments and count the rest. */
const MAX_SEGMENTS = 60;

/** The current wallet's balance, and what it becomes once the task confirms. */
function balanceFlow(
  available: bigint | undefined,
  change: bigint | undefined,
  decimals: number,
  symbol: string,
): string {
  if (available === undefined) return "—";
  const before = formatShieldedAmount(available, decimals);
  if (!change || available + change < 0n) return `${before} ${symbol}`;
  return `${before} → ${formatShieldedAmount(available + change, decimals)} ${symbol}`;
}

type WalletContext = {
  symbol: string;
  decimals: number;
  walletName: string;
  /** The current wallet's spendable balance, once recovered. */
  available?: bigint;
  notices?: ReactNode;
  action?: ReactNode;
};

/** A new budget: its total, its schedule from the first period to the last, and its parties. */
export function ShieldedFundReceipt({
  symbol,
  decimals,
  walletName,
  available,
  notices,
  action,
  rate,
  periods,
  days,
  startsAt,
  heirName,
  versionLabel,
  entryLabel,
}: WalletContext & {
  rate?: bigint;
  periods?: bigint;
  days?: bigint;
  /** Estimated start of a new arrangement; an existing arrangement keeps its own clock. */
  startsAt?: bigint;
  heirName?: string;
  versionLabel?: string;
  entryLabel: string;
}) {
  const { t } = useTranslation();
  const valid =
    rate !== undefined && rate > 0n && periods !== undefined && periods > 0n && days !== undefined;
  const total = valid ? rate * periods : undefined;
  const shown = valid ? Number(periods > BigInt(MAX_SEGMENTS) ? BigInt(MAX_SEGMENTS) : periods) : 0;
  const segments = Array.from(
    { length: shown },
    (_, index): ShieldedPeriodSegment => (index === 0 ? "next" : "funded"),
  );
  const periodLabel = (period: bigint) =>
    t("shielded.claimPeriodOption", {
      symbol,
      period: String(period),
      amount: formatShieldedAmount(rate ?? 0n, decimals),
    });
  const dueLabel = (period: bigint) =>
    startsAt !== undefined && days !== undefined
      ? t("shielded.claimPeriodDue", {
          symbol,
          date:
            formatShieldedTimestamp(startsAt + period * days * SECONDS_PER_DAY, "date") ??
            t("shielded.dateOutOfRange", { symbol }),
        })
      : null;
  return (
    <ShieldedTaskReceipt
      compact
      label={t("shielded.spendReview.preview", { action: t("shielded.actions.fund", { symbol }) })}
      headline={
        <ReceiptHeadline
          compact
          value={total !== undefined ? formatShieldedAmount(total, decimals) : "—"}
          muted={total === undefined}
          symbol={symbol}
          caption={
            valid
              ? t("shielded.fundingPreview", {
                  symbol,
                  periods: String(periods),
                  days: String(days),
                  rate: formatShieldedAmount(rate, decimals),
                })
              : undefined
          }
        />
      }
      details={
        <>
          {valid ? (
            <div className="space-y-2.5">
              <ShieldedPeriodBar
                segments={segments}
                more={
                  periods > BigInt(MAX_SEGMENTS)
                    ? Number(periods - BigInt(MAX_SEGMENTS))
                    : undefined
                }
              />
              <div className="flex justify-between gap-3 text-xs leading-normal">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{periodLabel(1n)}</p>
                  {dueLabel(1n) ? <p className="text-ink-muted">{dueLabel(1n)}</p> : null}
                </div>
                {periods > 1n ? (
                  <div className="min-w-0 text-right">
                    <p className="font-medium text-ink">{periodLabel(periods)}</p>
                    {dueLabel(periods) ? (
                      <p className="text-ink-muted">{dueLabel(periods)}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          <ReceiptRows
            rows={[
              { label: t("shielded.fields.heirPersonHash", { symbol }), value: heirName ?? "—" },
              { label: t("shielded.fields.familyVersion", { symbol }), value: versionLabel ?? "—" },
              { label: t("shielded.fundingModeLabel", { symbol }), value: entryLabel },
            ]}
          />
          <ReceiptRows
            rows={[
              { label: t("shielded.walletKeys.currentWallet"), value: walletName },
              {
                label: t("shielded.balanceAmount", { symbol }),
                value: balanceFlow(
                  available,
                  total === undefined ? undefined : -total,
                  decimals,
                  symbol,
                ),
              },
            ]}
          />
        </>
      }
      notices={notices}
      action={action}
    />
  );
}

/** The periods chosen for a claim, their total, and when the next one falls due. */
export function ShieldedClaimReceipt({
  symbol,
  decimals,
  walletName,
  available,
  notices,
  action,
  total,
  status,
  nextDue,
  segments,
  budgetName,
  periods,
}: WalletContext & {
  total: bigint;
  status: string;
  nextDue?: string;
  segments: readonly ShieldedPeriodSegment[];
  budgetName?: string;
  /** Chosen period numbers, one-based. */
  periods: readonly string[];
}) {
  const { t } = useTranslation();
  return (
    <ShieldedTaskReceipt
      compact
      label={t("shielded.spendReview.preview", { action: t("shielded.actions.claim", { symbol }) })}
      headline={
        <ReceiptHeadline
          compact
          value={formatShieldedAmount(total, decimals)}
          muted={total === 0n}
          symbol={symbol}
          caption={<span role="status">{status}</span>}
          sub={nextDue}
        />
      }
      details={
        <>
          {segments.length > 0 ? <ShieldedPeriodBar segments={segments} /> : null}
          <ReceiptRows
            rows={[
              { label: t("shielded.fields.budgetNote", { symbol }), value: budgetName ?? "—" },
              {
                label: t("shielded.claimPeriodsLabel", { symbol }),
                value: periods.length ? (
                  <span className="inline-flex flex-wrap justify-end gap-1">
                    {periods.map((period) => (
                      <span
                        key={period}
                        className="min-w-6 rounded-md bg-orange-100 px-1.5 text-center text-xs font-semibold text-orange-800 dark:bg-orange-400/15 dark:text-orange-300"
                      >
                        {period}
                      </span>
                    ))}
                  </span>
                ) : (
                  "—"
                ),
              },
            ]}
          />
          <ReceiptRows
            rows={[
              { label: t("shielded.walletKeys.currentWallet"), value: walletName },
              {
                label: t("shielded.balanceAmount", { symbol }),
                value: balanceFlow(available, total, decimals, symbol),
              },
            ]}
          />
        </>
      }
      notices={notices}
      action={action}
    />
  );
}

/** A deposit from the ordinary wallet into the current private wallet. */
export function ShieldedShieldReceipt({
  symbol,
  decimals,
  walletName,
  available,
  notices,
  action,
  amount,
}: WalletContext & { amount?: bigint }) {
  const { t } = useTranslation();
  return (
    <ShieldedTaskReceipt
      compact
      label={t("shielded.spendReview.preview", {
        action: t("shielded.actions.shield", { symbol }),
      })}
      headline={
        <ReceiptHeadline
          compact
          value={amount ? formatShieldedAmount(amount, decimals) : "—"}
          muted={!amount}
          symbol={symbol}
          caption={t("shielded.actionTitles.shield", { symbol })}
        />
      }
      details={
        <ReceiptRows
          rows={[
            { label: t("shielded.walletKeys.currentWallet"), value: walletName },
            {
              label: t("shielded.balanceAmount", { symbol }),
              value: balanceFlow(available, amount, decimals, symbol),
            },
          ]}
        />
      }
      notices={notices}
      action={action}
    />
  );
}

/**
 * A private transfer or withdrawal. Before review it summarises the request; the
 * Worker's plan then replaces it with every step, its progress and its decision.
 */
export function ShieldedSpendReceipt({
  spendAction,
  symbol,
  decimals,
  walletName,
  available,
  notices,
  action,
  amount,
  recipient,
  selection,
  review,
}: WalletContext & {
  spendAction: "privateTransfer" | "unshield";
  amount?: bigint;
  recipient?: ReactNode;
  /** The permitted balances, as the picker summarises them. */
  selection?: string;
  review?: ReactNode;
}) {
  const { t } = useTranslation();
  const label = t("shielded.spendReview.preview", {
    action: t(`shielded.actions.${spendAction}`, { symbol }),
  });
  if (review) return <ShieldedTaskReceipt wide label={label} headline={review} notices={notices} />;
  return (
    <ShieldedTaskReceipt
      compact
      wide
      label={label}
      headline={
        <ReceiptHeadline
          compact
          value={amount ? formatShieldedAmount(amount, decimals) : "—"}
          muted={!amount}
          symbol={symbol}
          caption={t(`shielded.spendReview.amountLabels.${spendAction}`)}
          sub={selection}
        />
      }
      details={
        <>
          <ReceiptRows
            rows={[{ label: t("shielded.spendReview.recipient"), value: recipient ?? "—" }]}
          />
          <ReceiptRows
            rows={[
              { label: t("shielded.walletKeys.currentWallet"), value: walletName },
              {
                label: t("shielded.balanceAmount", { symbol }),
                value: balanceFlow(
                  available,
                  amount === undefined ? undefined : -amount,
                  decimals,
                  symbol,
                ),
              },
            ]}
          />
        </>
      }
      notices={notices}
      action={action}
    />
  );
}

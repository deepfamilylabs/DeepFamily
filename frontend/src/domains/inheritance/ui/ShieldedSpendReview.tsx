import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { formatShieldedAmount } from "../model/shieldedDisplay";
import { PanelButton } from "./inheritanceControls";
import { ShieldedProgressList, type ShieldedProgressStage } from "./ShieldedTaskReceipt";

export interface ShieldedSpendPlan {
  /** Changes whenever a new plan asks for a decision. */
  key: string;
  action: "privateTransfer" | "unshield";
  amount: bigint;
  /** One-based position of the balance among the wallet's balances. */
  inputIndex: number;
  inputAmount: bigint;
  recipientLabel: string;
}

type StepStatus = "running" | "awaiting";

/** Shows the transaction before it is proven, and its progress once confirmed. */
export function ShieldedSpendReview({
  plan,
  decimals,
  symbol,
  running = false,
  stage = null,
  onConfirm,
  onCancel,
}: {
  plan: ShieldedSpendPlan;
  decimals: number;
  symbol: string;
  /** The transaction is being proven and sent. */
  running?: boolean;
  stage?: ShieldedProgressStage | null;
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const runningRef = useRef(running);
  runningRef.current = running;
  // Each new plan asks for a decision; a plan already confirmed keeps focus where it is.
  useEffect(() => {
    if (!runningRef.current) headingRef.current?.focus({ preventScroll: false });
  }, [plan.key]);
  const { action } = plan;
  const amount = (value: bigint) => formatShieldedAmount(value, decimals);
  const change = plan.inputAmount - plan.amount;
  const status: StepStatus = running ? "running" : "awaiting";
  const outputs = [
    { label: t(`shielded.spendReview.amountLabels.${action}`), value: plan.amount, strong: true },
    { label: t("shielded.spendReview.change"), value: change, strong: false },
  ];

  return (
    <section aria-label={t("shielded.spendReview.title")} className="min-w-0 space-y-4">
      <h3
        ref={headingRef}
        tabIndex={-1}
        className="ui-heading text-[15px] text-ink focus:outline-hidden"
      >
        {t(`shielded.spendReview.titles.${action}`)}
      </h3>
      <div className="space-y-3">
        <div>
          <p className="text-xs text-ink-muted">
            {t(`shielded.spendReview.amountLabels.${action}`)}
          </p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-[44px] font-extrabold leading-none tracking-[-0.01em] tabular-nums text-ink sm:text-[52px]">
              {amount(plan.amount)}
            </span>
            <span className="text-sm font-medium text-ink-muted">{symbol}</span>
          </p>
        </div>
        <dl className="text-[13px]">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <dt className="text-ink-muted">{t("shielded.spendReview.recipient")}</dt>
            <dd className="min-w-0 break-all text-right font-medium text-ink">
              {plan.recipientLabel}
            </dd>
          </div>
        </dl>
      </div>
      <div className="space-y-1 rounded-xl bg-surface-alt px-3.5 py-3 text-[13px] leading-relaxed">
        <p className="font-semibold text-ink">
          {t("shielded.spendReview.used", { count: 1, amount: amount(plan.inputAmount), symbol })}
        </p>
        <p className="text-ink-muted">{t("shielded.spendReview.transactions", { count: 1 })}</p>
      </div>

      <ol className="space-y-2.5">
        <li
          aria-current="step"
          className="space-y-2.5 rounded-[14px] border-[1.5px] border-orange-300 bg-orange-50/60 p-3.5 dark:border-orange-400/40 dark:bg-orange-400/[0.06]"
        >
          <div className="flex items-center gap-2.5">
            {status === "running" ? (
              <Loader2
                className="h-5 w-5 shrink-0 animate-spin text-orange-600 dark:text-orange-300"
                aria-hidden="true"
              />
            ) : (
              <span
                aria-hidden="true"
                className="h-5 w-5 shrink-0 rounded-full border-2 border-orange-500 bg-orange-100 dark:bg-orange-400/20"
              />
            )}
            <h4 className="ui-heading min-w-0 flex-1 text-sm text-ink">
              {t("shielded.spendReview.step", {
                index: 1,
                count: 1,
                action: t(`shielded.actions.${action}`),
              })}
            </h4>
          </div>
          <p className="text-xs text-ink-muted">
            {t("shielded.spendReview.inputs", {
              count: 1,
              amount: amount(plan.inputAmount),
              symbol,
            })}
          </p>
          <ul className="flex flex-wrap gap-1 text-xs">
            <li className="rounded-md bg-surface-muted px-2 py-0.5 text-ink/80">
              {t("shielded.valueOption", {
                index: plan.inputIndex,
                amount: amount(plan.inputAmount),
                symbol,
              })}
            </li>
          </ul>
          <dl className="space-y-1 border-t border-orange-200/70 pt-2 text-[13px] dark:border-orange-400/20">
            {outputs.map((row) => (
              <div key={row.label} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                <dt className="text-ink-muted">{row.label}</dt>
                <dd className={`tabular-nums text-ink ${row.strong ? "font-semibold" : ""}`}>
                  {amount(row.value)} {symbol}
                </dd>
              </div>
            ))}
          </dl>
          {status === "running" ? (
            <div className="border-t border-orange-200/70 pt-3 dark:border-orange-400/20">
              <ShieldedProgressList stage={stage} />
            </div>
          ) : null}
        </li>
      </ol>

      {onConfirm && !running ? (
        <div className="flex flex-wrap gap-3">
          <PanelButton variant="primary" size="large" className="flex-1" onClick={onConfirm}>
            {t("shielded.spendReview.confirm")}
          </PanelButton>
          {onCancel ? (
            <PanelButton size="large" onClick={onCancel}>
              {t("shielded.spendReview.cancel")}
            </PanelButton>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

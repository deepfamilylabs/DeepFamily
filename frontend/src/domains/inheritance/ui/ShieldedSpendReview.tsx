import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Info, Loader2 } from "lucide-react";
import type { ShieldedActionPreview } from "../../../shared/workers/shieldedAssetWorkerTypes";
import { formatShieldedAmount } from "../model/shieldedDisplay";
import { PanelButton, shortHex } from "./inheritanceControls";
import { ShieldedProgressList, type ShieldedProgressStage } from "./ShieldedTaskReceipt";
import type { ShieldedValueBalance } from "./ShieldedWalletActions";

/** A step of the current plan that has already been sent and confirmed. */
export type ShieldedCompletedSpendStep = {
  merge: boolean;
  inputCount: number;
  inputTotal: string;
  principal: string;
  change: string;
  hash: string;
};

export interface ShieldedSpendReviewProps {
  preview: ShieldedActionPreview;
  action: "privateTransfer" | "unshield";
  notes: readonly ShieldedValueBalance[];
  candidateCommitments: readonly string[];
  /** Confirmed consolidation outputs available when this preview was prepared. */
  generatedCommitments?: readonly string[];
  decimals: number;
  symbol: string;
  recipientLabel: string;
  /** Steps of this plan already confirmed on chain, shown before the remaining ones. */
  completedSteps?: readonly ShieldedCompletedSpendStep[];
  /** The plan's first step is being proven and sent. */
  running?: boolean;
  stage?: ShieldedProgressStage | null;
  onConfirm?: () => void;
  onCancel?: () => void;
}

type StepStatus = "done" | "running" | "awaiting" | "pending";

/** Shows the Worker plan before proving each transaction, and its progress once confirmed. */
export function ShieldedSpendReview({
  preview,
  action,
  notes,
  candidateCommitments,
  generatedCommitments = [],
  decimals,
  symbol,
  recipientLabel,
  completedSteps = [],
  running = false,
  stage = null,
  onConfirm,
  onCancel,
}: ShieldedSpendReviewProps) {
  const { t } = useTranslation();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const runningRef = useRef(running);
  runningRef.current = running;
  // Each new plan asks for a decision; a plan already confirmed keeps focus where it is.
  useEffect(() => {
    if (!runningRef.current) headingRef.current?.focus({ preventScroll: false });
  }, [preview.handle]);
  const values = notes.filter((note) => BigInt(note.amount) > 0n);
  const sources = new Map(
    values.map((note, index) => [
      note.commitment,
      {
        amount: BigInt(note.amount),
        balanceIndex: index + 1,
        completedMerge: generatedCommitments.includes(note.commitment),
        generatedStep: undefined as number | undefined,
      },
    ]),
  );
  const candidates = candidateCommitments.map((commitment) => {
    const source = sources.get(commitment);
    if (!source) throw new Error("Spend preview candidate is unavailable");
    return source;
  });
  const used = new Map<string, bigint>();
  const offset = completedSteps.length;
  const steps = preview.steps.map((step, stepIndex) => {
    const inputs = step.inputs.map((commitment, inputIndex) => {
      const source = sources.get(commitment);
      if (!source) throw new Error("Spend preview input is unavailable");
      const amount = stepIndex === 0 ? BigInt(preview.inputAmounts[inputIndex]) : source.amount;
      if (source.generatedStep === undefined) used.set(commitment, amount);
      return { commitment, ...source, amount };
    });
    const principal = BigInt(step.outputAmounts[0]);
    const change = BigInt(step.outputAmounts[1]);
    for (const [outputIndex, amount] of [principal, change].entries()) {
      sources.set(`planned:${stepIndex}:${outputIndex}`, {
        amount,
        balanceIndex: 0,
        completedMerge: false,
        generatedStep: offset + stepIndex + 1,
      });
    }
    return { inputs, principal, change };
  });
  const candidateTotal = candidates.reduce((total, source) => total + source.amount, 0n);
  const usedTotal = [...used.values()].reduce((total, amount) => total + amount, 0n);
  const amount = (value: bigint | string) => formatShieldedAmount(value, decimals);
  const total = offset + steps.length;
  const title = (index: number, final: boolean) =>
    t("shielded.spendReview.step", {
      index,
      count: total,
      action: t(final ? `shielded.actions.${action}` : "shielded.spendReview.merge"),
    });
  const statusIcon = (status: StepStatus) =>
    status === "done" ? (
      <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
    ) : status === "running" ? (
      <Loader2
        className="h-5 w-5 shrink-0 animate-spin text-orange-600 dark:text-orange-300"
        aria-hidden="true"
      />
    ) : (
      <span
        aria-hidden="true"
        className={`h-5 w-5 shrink-0 rounded-full border-2 ${
          status === "awaiting"
            ? "border-orange-500 bg-orange-100 dark:bg-orange-400/20"
            : "border-hairline-strong"
        }`}
      />
    );
  const outputs = (rows: { label: string; value: bigint; strong?: boolean }[], accent: boolean) => (
    <dl
      className={`space-y-1 border-t pt-2 text-[13px] ${
        accent ? "border-orange-200/70 dark:border-orange-400/20" : "border-hairline/70"
      }`}
    >
      {rows.map((row) => (
        <div key={row.label} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
          <dt className="text-ink-muted">{row.label}</dt>
          <dd className={`tabular-nums text-ink ${row.strong ? "font-semibold" : ""}`}>
            {amount(row.value)} {symbol}
          </dd>
        </div>
      ))}
    </dl>
  );

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
              {amount(preview.amount)}
            </span>
            <span className="text-sm font-medium text-ink-muted">{symbol}</span>
          </p>
        </div>
        <dl className="text-[13px]">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <dt className="text-ink-muted">{t("shielded.spendReview.recipient")}</dt>
            <dd className="min-w-0 break-all text-right font-medium text-ink">{recipientLabel}</dd>
          </div>
        </dl>
      </div>
      <div className="space-y-1 rounded-xl bg-surface-alt px-3.5 py-3 text-[13px] leading-relaxed">
        <p className="text-ink-muted">
          {t("shielded.spendReview.candidates", {
            count: candidates.length,
            amount: amount(candidateTotal),
            symbol,
          })}
        </p>
        <p className="font-semibold text-ink">
          {t("shielded.spendReview.used", { count: used.size, amount: amount(usedTotal), symbol })}
        </p>
        <p className="text-ink-muted">{t("shielded.spendReview.transactions", { count: total })}</p>
      </div>

      <ol className="space-y-2.5">
        {completedSteps.map((step, index) => (
          <li
            key={`done-${index}`}
            className="space-y-2.5 rounded-[14px] border border-hairline bg-surface p-3.5"
          >
            <div className="flex items-center gap-2.5">
              {statusIcon("done")}
              <h4 className="ui-heading min-w-0 flex-1 text-sm text-ink">
                {title(index + 1, !step.merge)}
              </h4>
              <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                {t("transaction.success")}
              </span>
            </div>
            <p className="text-xs text-ink-muted">
              {t("shielded.spendReview.inputs", {
                count: step.inputCount,
                amount: amount(step.inputTotal),
                symbol,
              })}
            </p>
            {outputs(
              [
                {
                  label: t(
                    step.merge
                      ? "shielded.spendReview.mergeOutput"
                      : `shielded.spendReview.amountLabels.${action}`,
                  ),
                  value: BigInt(step.principal),
                },
                { label: t("shielded.spendReview.change"), value: BigInt(step.change) },
              ],
              false,
            )}
            <p className="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
              <span className="shrink-0">{t("shielded.walletKeys.transactionHash")}</span>
              <code className="min-w-0 truncate font-mono text-ink/80" title={step.hash}>
                {shortHex(step.hash)}
              </code>
            </p>
          </li>
        ))}
        {steps.map((step, stepIndex) => {
          const final = stepIndex === steps.length - 1;
          const status: StepStatus =
            stepIndex === 0 ? (running ? "running" : "awaiting") : "pending";
          const current = status === "running" || status === "awaiting";
          const inputTotal = step.inputs.reduce((sum, input) => sum + input.amount, 0n);
          return (
            <li
              key={stepIndex}
              aria-current={current ? "step" : undefined}
              className={`space-y-2.5 rounded-[14px] p-3.5 ${
                current
                  ? "border-[1.5px] border-orange-300 bg-orange-50/60 dark:border-orange-400/40 dark:bg-orange-400/[0.06]"
                  : "border border-hairline bg-surface"
              }`}
            >
              <div className="flex items-center gap-2.5">
                {statusIcon(status)}
                <h4 className="ui-heading min-w-0 flex-1 text-sm text-ink">
                  {title(offset + stepIndex + 1, final)}
                </h4>
              </div>
              <p className="text-xs text-ink-muted">
                {t("shielded.spendReview.inputs", {
                  count: step.inputs.length,
                  amount: amount(inputTotal),
                  symbol,
                })}
              </p>
              <ul className="flex flex-wrap gap-1 text-xs">
                {step.inputs.map((input) => (
                  <li
                    key={input.commitment}
                    className={`rounded-md px-2 py-0.5 ${
                      input.generatedStep !== undefined || input.completedMerge
                        ? "bg-orange-100 text-orange-900 dark:bg-orange-400/15 dark:text-orange-200"
                        : "bg-surface-muted text-ink/80"
                    }`}
                  >
                    {input.generatedStep === undefined
                      ? t(
                          input.completedMerge
                            ? "shielded.spendReview.mergedInput"
                            : "shielded.valueOption",
                          { index: input.balanceIndex, amount: amount(input.amount), symbol },
                        )
                      : t("shielded.spendReview.generatedInput", {
                          step: input.generatedStep,
                          amount: amount(input.amount),
                          symbol,
                        })}
                  </li>
                ))}
              </ul>
              {outputs(
                [
                  {
                    label: t(
                      final
                        ? `shielded.spendReview.amountLabels.${action}`
                        : "shielded.spendReview.mergeOutput",
                    ),
                    value: step.principal,
                    strong: final,
                  },
                  { label: t("shielded.spendReview.change"), value: step.change },
                ],
                current,
              )}
              {status === "running" ? (
                <div className="border-t border-orange-200/70 pt-3 dark:border-orange-400/20">
                  <ShieldedProgressList stage={stage} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {total > 1 || generatedCommitments.length > 0 ? (
        <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{t("shielded.spendReview.continuationHint")}</span>
        </p>
      ) : null}
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

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { formatUnits } from "ethers";
import type { ShieldedActionPreview } from "../../../shared/workers/shieldedAssetWorkerTypes";
import { PanelButton } from "./inheritanceControls";
import type { ShieldedValueBalance } from "./ShieldedWalletActions";

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
  onConfirm: () => void;
  onCancel: () => void;
}

/** Shows the Worker plan before proving or submitting its first transaction. */
export function ShieldedSpendReview({
  preview,
  action,
  notes,
  candidateCommitments,
  generatedCommitments = [],
  decimals,
  symbol,
  recipientLabel,
  onConfirm,
  onCancel,
}: ShieldedSpendReviewProps) {
  const { t } = useTranslation();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: false });
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
        generatedStep: stepIndex + 1,
      });
    }
    return { inputs, principal, change };
  });
  const candidateTotal = candidates.reduce((total, source) => total + source.amount, 0n);
  const usedTotal = [...used.values()].reduce((total, amount) => total + amount, 0n);
  const amount = (value: bigint | string) => formatUnits(value, decimals);

  return (
    <section
      aria-label={t("shielded.spendReview.title")}
      className="min-w-0 space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-4"
    >
      <div className="space-y-1">
        <h3 ref={headingRef} tabIndex={-1} className="font-semibold text-ink focus:outline-hidden">
          {t(`shielded.spendReview.titles.${action}`)}
        </h3>
        <p className="text-sm text-ink-muted">
          {t("shielded.spendReview.candidates", {
            count: candidates.length,
            amount: amount(candidateTotal),
            symbol,
          })}
        </p>
        <p className="text-sm font-medium text-ink">
          {t("shielded.spendReview.used", {
            count: used.size,
            amount: amount(usedTotal),
            symbol,
          })}
        </p>
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
          <dt className="text-ink-muted">{t(`shielded.spendReview.amountLabels.${action}`)}</dt>
          <dd className="font-semibold text-ink">{amount(preview.amount)} {symbol}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-ink-muted">{t("shielded.spendReview.recipient")}</dt>
          <dd className="break-all text-ink">{recipientLabel}</dd>
        </div>
      </dl>

      <div className="space-y-3">
        <p className="text-sm text-ink-muted">
          {t("shielded.spendReview.transactions", { count: steps.length })}
        </p>
        <ol className="space-y-3">
          {steps.map((step, stepIndex) => {
            const final = stepIndex === steps.length - 1;
            const inputTotal = step.inputs.reduce((total, input) => total + input.amount, 0n);
            return (
              <li key={stepIndex} className="space-y-2 rounded-lg border border-hairline bg-surface p-3">
                <h4 className="text-sm font-semibold text-ink">
                  {t("shielded.spendReview.step", {
                    index: stepIndex + 1,
                    count: steps.length,
                    action: t(final ? `shielded.actions.${action}` : "shielded.spendReview.merge"),
                  })}
                </h4>
                <p className="text-xs text-ink-muted">
                  {t("shielded.spendReview.inputs", {
                    count: step.inputs.length,
                    amount: amount(inputTotal),
                    symbol,
                  })}
                </p>
                <ul className="space-y-1 text-sm text-ink">
                  {step.inputs.map((input) => (
                    <li key={input.commitment}>
                      {input.generatedStep === undefined
                        ? t(input.completedMerge ? "shielded.spendReview.mergedInput" : "shielded.valueOption", {
                            index: input.balanceIndex,
                            amount: amount(input.amount),
                            symbol,
                          })
                        : t("shielded.spendReview.generatedInput", {
                            step: input.generatedStep,
                            amount: amount(input.amount),
                            symbol,
                          })}
                    </li>
                  ))}
                </ul>
                <dl className="space-y-1 border-t border-hairline pt-2 text-sm">
                  <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                    <dt className="text-ink-muted">
                      {t(final ? `shielded.spendReview.amountLabels.${action}` : "shielded.spendReview.mergeOutput")}
                    </dt>
                    <dd className="text-ink">{amount(step.principal)} {symbol}</dd>
                  </div>
                  <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                    <dt className="text-ink-muted">{t("shielded.spendReview.change")}</dt>
                    <dd className="text-ink">{amount(step.change)} {symbol}</dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ol>
      </div>

      {steps.length > 1 || generatedCommitments.length > 0 ? (
        <p className="text-sm text-ink-muted">{t("shielded.spendReview.continuationHint")}</p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <PanelButton variant="primary" onClick={onConfirm}>
          {t("shielded.spendReview.confirm")}
        </PanelButton>
        <PanelButton onClick={onCancel}>{t("shielded.spendReview.cancel")}</PanelButton>
      </div>
    </section>
  );
}

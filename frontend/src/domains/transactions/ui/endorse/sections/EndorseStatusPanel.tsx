import { Star } from "lucide-react";
import { TransactionStatusView } from "../../shared/TransactionStatusView";
import type { TransactionPhase } from "../../shared/transactionPhase";
import type { TimelineStep } from "../../shared/TransactionTimeline";
import { EndorseSuccessResult } from "../EndorseSuccessResult";
import type { EndorseErrorResultView, EndorseSuccessResultView, EndorseT } from "../model/endorseTypes";

export interface EndorseStatusPanelProps {
  t: EndorseT;
  phase: TransactionPhase;
  timeline: TimelineStep[];
  isApproving: boolean;
  successResult: EndorseSuccessResultView | null;
  errorResult: EndorseErrorResultView | null;
  hasEndorsed: boolean;
  deepTokenDecimals: number;
  deepTokenSymbol: string;
  onRetry: () => void;
  onClearError: () => void;
}

export function EndorseStatusPanel({
  t,
  phase,
  timeline,
  isApproving,
  successResult,
  errorResult,
  hasEndorsed,
  deepTokenDecimals,
  deepTokenSymbol,
  onRetry,
  onClearError,
}: EndorseStatusPanelProps) {
  return (
    <>
      <TransactionStatusView
        t={t}
        phase={phase}
        slots={{
          timeline,
          done: successResult ? (
            <EndorseSuccessResult
              t={t}
              successResult={successResult}
              deepTokenDecimals={deepTokenDecimals}
              deepTokenSymbol={deepTokenSymbol}
            />
          ) : null,
          failed: {
            title: t("endorse.endorseFailed", "Endorsement Failed"),
            error: errorResult,
            retry: errorResult?.retryable
              ? {
                  label: t("endorse.retryTransaction", "Retry Transaction"),
                  onClick: () => {
                    onClearError();
                    onRetry();
                  },
                }
              : undefined,
          },
        }}
      />

      {/* Orthogonal to the phase: context for the target, not a state of its own. */}
      {hasEndorsed && phase !== "done" && (
        <div className="p-4 bg-success/10 border border-success/25 rounded-xl">
          <div className="flex items-center gap-3">
            <Star className="w-5 h-5 text-green-600 dark:text-green-400 fill-current" />
            <span className="text-sm font-bold text-green-900 dark:text-green-100">
              {t("endorse.successMessage", "You have successfully endorsed this version!")}
            </span>
          </div>
        </div>
      )}
    </>
  );
}

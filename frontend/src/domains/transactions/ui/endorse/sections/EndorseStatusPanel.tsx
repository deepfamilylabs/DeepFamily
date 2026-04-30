import { Check, Star } from "lucide-react";
import { TransactionErrorResult } from "../../shared/TransactionErrorResult";
import { TransactionProgress } from "../../shared/TransactionProgress";
import { EndorseSuccessResult } from "../EndorseSuccessResult";
import type { EndorseErrorResultView, EndorseSuccessResultView, EndorseT } from "../model/endorseTypes";

export interface EndorseStatusPanelProps {
  t: EndorseT;
  isSubmitting: boolean;
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
  isSubmitting,
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
      {(isSubmitting || isApproving) && !successResult && !errorResult && (
        <TransactionProgress
          title={
            isApproving
              ? t("endorse.approving", "Approving DEEP tokens...")
              : t("endorse.endorsing", "Endorsing version...")
          }
          message={
            isApproving
              ? t("endorse.approvingDesc", "Please confirm the token approval in your wallet")
              : t("endorse.endorsingDesc", "Processing endorsement on the blockchain...")
          }
        />
      )}

      {successResult && (
        <EndorseSuccessResult
          t={t}
          successResult={successResult}
          deepTokenDecimals={deepTokenDecimals}
          deepTokenSymbol={deepTokenSymbol}
        />
      )}

      {errorResult && (
        <TransactionErrorResult
          title={t("endorse.endorseFailed", "Endorsement Failed")}
          error={errorResult}
          typeLabel={t("endorse.errorType", "Error Type")}
          messageLabel={t("endorse.errorMessage", "Message")}
          detailsLabel={t("endorse.errorDetails", "Details")}
          retry={
            errorResult.retryable
              ? {
                  label: t("endorse.retryTransaction", "Retry Transaction"),
                  onClick: () => {
                    onClearError();
                    onRetry();
                  },
                }
              : undefined
          }
        />
      )}

      {hasEndorsed && !successResult && (
        <div className="bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-800 rounded-2xl p-4">
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

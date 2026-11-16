import { TransactionStatusView } from "../../shared/TransactionStatusView";
import type { TransactionPhase } from "../../shared/transactionPhase";
import type { TimelineStep } from "../../shared/TransactionTimeline";
import { AddVersionSuccessResult } from "../AddVersionSuccessResult";
import type {
  AddVersionErrorResultView,
  AddVersionSuccessResultView,
  AddVersionT,
  AddVersionTransactionPreview,
} from "../model/addVersionTypes";

interface AddVersionStatusPanelProps {
  t: AddVersionT;
  phase: TransactionPhase;
  timeline: TimelineStep[];
  transactionPreview: AddVersionTransactionPreview | null;
  successResult: AddVersionSuccessResultView | null;
  errorResult: AddVersionErrorResultView | null;
  isWalletConnecting?: boolean;
  onWalletReauthorize?: () => void;
}

export function AddVersionStatusPanel({
  t,
  phase,
  timeline,
  transactionPreview,
  successResult,
  errorResult,
  isWalletConnecting,
  onWalletReauthorize,
}: AddVersionStatusPanelProps) {
  return (
    <TransactionStatusView
      t={t}
      phase={phase}
      slots={{
        review: {
          preview: transactionPreview,
          description: t(
            "addVersion.transactionPreviewDescription",
            "The proof and encrypted envelope are frozen. Confirm these exact transaction details before continuing.",
          ),
        },
        timeline,
        done: successResult ? <AddVersionSuccessResult t={t} successResult={successResult} /> : null,
        failed: {
          title: errorResult?.transactionConfirmed
            ? errorResult.verificationFailure === "read"
              ? t("addVersion.detailsReadFailedTitle", "Transaction Confirmed; Details Unavailable")
              : t("addVersion.verificationMismatchTitle", "Transaction Confirmed; Data Verification Failed")
            : t("addVersion.failed", "Transaction Failed"),
          error: errorResult,
          retry: errorResult?.type === "WALLET_UNAUTHORIZED" &&
            !errorResult.transactionHash && !errorResult.transactionConfirmed && onWalletReauthorize
            ? {
                label: isWalletConnecting
                  ? t("wallet.connecting", "Connecting...")
                  : t("wallet.reauthorize", "Reauthorize Wallet"),
                onClick: onWalletReauthorize,
                disabled: isWalletConnecting,
              }
            : undefined,
        },
      }}
    />
  );
}

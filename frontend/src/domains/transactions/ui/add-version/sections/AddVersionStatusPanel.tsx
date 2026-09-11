import { TransactionErrorResult } from "../../shared/TransactionErrorResult";
import { TransactionPreviewPanel } from "../../shared/TransactionPreviewPanel";
import { TransactionProgress } from "../../shared/TransactionProgress";
import { AddVersionSuccessResult } from "../AddVersionSuccessResult";
import type {
  AddVersionErrorResultView,
  AddVersionSuccessResultView,
  AddVersionT,
  AddVersionTransactionPreview,
} from "../model/addVersionTypes";

interface AddVersionStatusPanelProps {
  t: AddVersionT;
  isSubmitting: boolean;
  proofGenerationStep: string;
  transactionPreview: AddVersionTransactionPreview | null;
  successResult: AddVersionSuccessResultView | null;
  errorResult: AddVersionErrorResultView | null;
}

export function AddVersionStatusPanel({
  t,
  isSubmitting,
  proofGenerationStep,
  transactionPreview,
  successResult,
  errorResult,
}: AddVersionStatusPanelProps) {
  return (
    <>
      {transactionPreview && !successResult && !errorResult && (
        <TransactionPreviewPanel
          preview={transactionPreview}
          title={t("addVersion.transactionPreviewTitle", "Review before opening your wallet")}
          description={t(
            "addVersion.transactionPreviewDescription",
            "The proof and encrypted envelope are frozen. Confirm these exact transaction details before continuing.",
          )}
        />
      )}

      {isSubmitting &&
        proofGenerationStep &&
        !transactionPreview &&
        !successResult &&
        !errorResult && (
          <TransactionProgress
            title={t("addVersion.processing", "Processing...")}
            message={proofGenerationStep}
            note={
              proofGenerationStep.includes("30-60 seconds")
                ? t(
                    "addVersion.proofGenerationNote",
                    "ZK proof generation requires complex cryptographic calculations. Please wait...",
                  )
                : undefined
            }
          />
        )}

      {successResult && <AddVersionSuccessResult t={t} successResult={successResult} />}

      {errorResult && (
        <TransactionErrorResult
          title={t("addVersion.failed", "Transaction Failed")}
          error={errorResult}
          typeLabel={t("addVersion.errorType", "Error Type")}
          messageLabel={t("addVersion.errorMessage", "Message")}
          detailsLabel={t("addVersion.errorDetails", "Details")}
        />
      )}
    </>
  );
}

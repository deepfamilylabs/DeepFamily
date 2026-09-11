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
}

export function AddVersionStatusPanel({
  t,
  phase,
  timeline,
  transactionPreview,
  successResult,
  errorResult,
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
        failed: { title: t("addVersion.failed", "Transaction Failed"), error: errorResult },
      }}
    />
  );
}

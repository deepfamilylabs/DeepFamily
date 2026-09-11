import type React from "react";
import { TransactionErrorResult } from "./TransactionErrorResult";
import { TransactionPreviewPanel } from "./TransactionPreviewPanel";
import { TransactionTimeline, type TimelineStep } from "./TransactionTimeline";
import { assertPhaseHandled, type TransactionPhase } from "./transactionPhase";
import type { ArchiveTransactionPreview } from "../../services/archiveTransaction";

type StatusT = (key: string, fallback: string, options?: Record<string, unknown>) => string;

export type TransactionStatusSlots = {
  /** The frozen package; only its description differs between flows. */
  review?: { preview: ArchiveTransactionPreview | null; description: React.ReactNode };
  /** The flow's declared steps, marked against the one it is on. */
  timeline?: TimelineStep[];
  done?: React.ReactNode;
  failed?: {
    title: string;
    error: { type: string; message: string; details: string } | null;
    retry?: { label: string; onClick: () => void };
  };
  blocked?: React.ReactNode;
};

/**
 * What a transaction modal shows for the phase it is in.
 *
 * The phase switch lives here rather than in each modal, so there is one
 * `never` check instead of three, and the chrome every flow shares — the error
 * field labels, the preview heading — is worded once instead of being repeated
 * per namespace with identical text.
 */
export function TransactionStatusView({
  t,
  phase,
  slots,
}: {
  t: StatusT;
  phase: TransactionPhase;
  slots: TransactionStatusSlots;
}) {
  switch (phase) {
    case "review": {
      const review = slots.review;
      return (
        <div className="space-y-4">
          {timeline()}
          {review?.preview ? (
            <TransactionPreviewPanel
              preview={review.preview}
              title={t("transaction.reviewTitle", "Review before opening your wallet")}
              description={review.description}
            />
          ) : null}
        </div>
      );
    }
    case "busy":
      return timeline();
    case "done":
      // Same shape as review: the steps, then the thing to read. A result that
      // took over the whole view lost the context of what produced it.
      return (
        <div className="space-y-4">
          {timeline()}
          {slots.done ?? null}
        </div>
      );
    case "failed": {
      const failed = slots.failed;
      return failed?.error ? (
        <TransactionErrorResult
          title={failed.title}
          error={failed.error}
          typeLabel={t("transaction.errorType", "Error Type")}
          messageLabel={t("transaction.errorMessage", "Message")}
          detailsLabel={t("transaction.errorDetails", "Details")}
          retry={failed.retry}
        />
      ) : null;
    }
    case "blocked":
      return <>{slots.blocked ?? null}</>;
    case "form":
      return null;
    default:
      return assertPhaseHandled(phase);
  }

  function timeline() {
    return slots.timeline?.length ? (
      <TransactionTimeline steps={slots.timeline} label={t("transaction.center", "Transactions")} />
    ) : null;
  }
}

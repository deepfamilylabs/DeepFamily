import type React from "react";
import { ArchiveTransactionDetails } from "../ArchiveTransactionDetails";
import type { ArchiveTransactionPreview } from "../../services/archiveTransaction";

/**
 * The frozen wallet-bound package, reviewed in place inside the flow's own
 * modal. A nested overlay would have to out-stack the modal that raised it;
 * keeping the decision inline removes that failure mode entirely.
 */
export function TransactionPreviewPanel({
  title,
  description,
  preview,
}: {
  title: React.ReactNode;
  description: React.ReactNode;
  preview: ArchiveTransactionPreview;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="p-4 space-y-3 bg-info/8 border border-info/20 rounded-xl"
    >
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      <p className="text-xs text-ink-muted">{description}</p>
      <ArchiveTransactionDetails preview={preview} />
    </div>
  );
}

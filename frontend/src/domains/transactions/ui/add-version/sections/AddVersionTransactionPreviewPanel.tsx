import type { AddVersionT, AddVersionTransactionPreview } from "../model/addVersionTypes";
import { ArchiveTransactionDetails } from "../../ArchiveTransactionDetails";

export function AddVersionTransactionPreviewPanel({
  t,
  preview,
}: {
  t: AddVersionT;
  preview: AddVersionTransactionPreview;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="p-4 space-y-3 bg-info/8 border border-info/20 rounded-xl"
    >
      <p className="text-[13px] font-semibold text-ink">
        {t("addVersion.transactionPreviewTitle", "Review before opening your wallet")}
      </p>
      <p className="text-xs text-ink-muted">
        {t(
          "addVersion.transactionPreviewDescription",
          "The proof and encrypted envelope are frozen. Confirm these exact transaction details before continuing.",
        )}
      </p>
      <ArchiveTransactionDetails preview={preview} />
    </div>
  );
}

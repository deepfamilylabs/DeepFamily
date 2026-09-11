import { useId } from "react";
import type React from "react";
import { ArchiveTransactionDetails } from "../ArchiveTransactionDetails";
import { useFocusOnMount } from "./useFocusOnMount";
import type { ArchiveTransactionPreview } from "../../services/archiveTransaction";

/**
 * The frozen wallet-bound package, reviewed in place inside the flow's own
 * modal. A nested overlay would have to out-stack the modal that raised it;
 * keeping the decision inline removes that failure mode.
 *
 * Callers hide the rest of the form while this is up, so the panel is the only
 * thing in the scroll area and cannot be scrolled away from or edited behind.
 * It takes focus on appearance: a decision this size must not be announced only
 * to whoever happens to be looking at the right part of the screen.
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
  const panelRef = useFocusOnMount<HTMLDivElement>();
  const titleId = useId();

  return (
    <div
      ref={panelRef}
      role="group"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="p-4 space-y-3 bg-info/8 border border-info/20 rounded-xl outline-hidden"
    >
      <p id={titleId} className="text-[13px] font-semibold text-ink">
        {title}
      </p>
      <p className="text-xs text-ink-muted">{description}</p>
      <ArchiveTransactionDetails preview={preview} />
    </div>
  );
}

import type React from "react";
import { useTranslation } from "react-i18next";
import { assertPhaseHandled, type TransactionPhase } from "./transactionPhase";
import { TransactionButton } from "./TransactionButton";

export type TransactionFooterSlots = {
  /** Finished: close, and whatever comes next. */
  done: React.ReactNode;
  /** A frozen package awaits a decision. */
  review?: React.ReactNode;
  /** This target cannot proceed; only leaving or re-targeting is useful. */
  blocked?: React.ReactNode;
  /** Still working the form — including while busy and after a failure. */
  active: React.ReactNode;
  /**
   * Closes the modal without abandoning the flow. Offered only once the
   * transaction is away: before that, closing still cancels.
   */
  onRunInBackground?: () => void;
};

/**
 * The action strip pinned under every transaction modal.
 *
 * One container and one phase switch: the bar itself had drifted apart between
 * flows, and the switch over which actions belong to which phase is the same
 * question the status view answers, so it gets the same `never` treatment.
 */
export function TransactionFooterBar({
  phase,
  slots,
}: {
  phase: TransactionPhase;
  slots: TransactionFooterSlots;
}) {
  const { t } = useTranslation();
  const backgroundLabel = t("transaction.runInBackground", "Continue in background");

  return (
    <div className="flex flex-col-reverse sm:flex-row gap-2.5 px-5 py-3.5 bg-surface border-t border-hairline pb-[calc(0.875rem+env(safe-area-inset-bottom))]">
      {actions()}
    </div>
  );

  function actions() {
    switch (phase) {
      case "done":
        return slots.done;
      case "review":
        return slots.review ?? slots.active;
      case "blocked":
        return slots.blocked ?? slots.active;
      case "busy":
        // Nothing is being asked of the user any more, and the flow no longer
        // needs this modal to finish — so say so, rather than make them wait.
        return slots.onRunInBackground ? (
          <TransactionButton onClick={slots.onRunInBackground} className="flex-1">
            {backgroundLabel}
          </TransactionButton>
        ) : (
          slots.active
        );
      case "form":
      case "failed":
        return slots.active;
      default:
        return assertPhaseHandled(phase);
    }
  }
}

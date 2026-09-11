import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Loader2, Receipt } from "lucide-react";
import { useTransactionCenter, type TransactionRecord } from "../context/TransactionCenterContext";
import type { TransactionPhase } from "./shared/transactionPhase";

const LINK_CLASSES = "transition-colors hover:text-ink focus-visible:text-ink";

function PhaseIcon({ phase }: { phase: TransactionPhase }) {
  if (phase === "done") return <Check className="h-3.5 w-3.5 text-success" aria-hidden />;
  if (phase === "failed") return <AlertTriangle className="h-3.5 w-3.5 text-danger" aria-hidden />;
  return (
    <Loader2
      className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none text-ink-muted"
      aria-hidden
    />
  );
}

function shortHash(hash: string) {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

/**
 * The transaction centre's entry point, in the status bar beside the RPC chip.
 *
 * It only appears once there is something to report — an empty strip should not
 * grow a control nobody needs.
 */
export default function TransactionCenterChip() {
  const { t } = useTranslation();
  const centre = useTransactionCenter();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (!centre || centre.records.length === 0) return null;

  const title = t("transaction.center", "Transactions");

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className={`inline-flex items-center gap-1.5 ${LINK_CLASSES}`}
        title={title}
      >
        <Receipt className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">{title}: </span>
        <span className="tabular-nums">
          {centre.pendingCount > 0 ? centre.pendingCount : centre.records.length}
        </span>
      </button>

      {isOpen ? (
        <div
          role="dialog"
          aria-label={title}
          className="absolute bottom-full left-0 mb-2 max-h-[70vh] w-96 overflow-y-auto rounded-xl border border-hairline bg-surface p-2 shadow-[0_16px_40px_-16px_rgba(15,23,42,0.35)] dark:shadow-[0_16px_40px_-16px_rgba(0,0,0,0.75)]"
        >
          <div className="flex items-baseline justify-between gap-3 px-1.5 pb-2">
            <span className="text-xs font-semibold text-ink">{title}</span>
            <button
              type="button"
              onClick={() => centre.clearSettled()}
              className={`text-[11px] ${LINK_CLASSES}`}
            >
              {t("transaction.clearSettled", "Clear finished")}
            </button>
          </div>

          {centre.pendingCount > 0 && (
            <p className="px-1.5 pb-2 text-[11px] leading-relaxed text-ink-muted">
              {t(
                "transaction.pendingDetails",
                "Transaction has been submitted or waiting for wallet confirmation. You can continue using the app, we'll update after confirmation.",
              )}
            </p>
          )}

          <ul className="space-y-1">
            {centre.records.map((record) => (
              <TransactionRow key={record.id} record={record} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function TransactionRow({ record }: { record: TransactionRecord }) {
  const { t } = useTranslation();
  const status =
    record.phase === "done"
      ? t("transaction.success", "Transaction successful")
      : record.phase === "failed"
        ? record.error?.message || t("errors.unknown", "Submission failed.")
        : t("transaction.pending", "Transaction pending confirmation...");

  return (
    <li className="rounded-lg px-1.5 py-1.5 hover:bg-surface-alt">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">
          <PhaseIcon phase={record.phase} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-ink">{record.label}</div>
          <div
            className={`truncate text-[11px] ${
              record.phase === "failed" ? "text-danger" : "text-ink-muted"
            }`}
          >
            {status}
          </div>
          {record.transactionHash ? (
            <div className="truncate font-mono text-[11px] text-ink-subtle">
              {shortHash(record.transactionHash)}
            </div>
          ) : null}
          {/* A failure that reached the chain still has to be readable here. */}
          {record.phase === "failed" && record.error?.details &&
          record.error.details !== record.error.message ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] text-ink-muted">
                {t("transaction.errorDetails", "Details")}
              </summary>
              <p className="mt-1 break-words text-[11px] leading-relaxed text-ink-muted">
                {record.error.details}
              </p>
            </details>
          ) : null}
        </div>
      </div>
    </li>
  );
}

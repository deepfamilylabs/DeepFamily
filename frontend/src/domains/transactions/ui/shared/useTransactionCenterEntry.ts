import { useCallback, useEffect, useRef } from "react";
import type { FriendlyError } from "../../../../shared/lib/errors";
import { useTransactionCenter, type TransactionKind } from "../../context/TransactionCenterContext";
import type { TransactionPhase } from "./transactionPhase";

let sequence = 0;

export type TransactionSettlement = {
  phase: Extract<TransactionPhase, "done" | "failed">;
  transactionHash?: string;
  error?: FriendlyError | null;
};

const nextEntryId = () => `tx-${Date.now()}-${++sequence}`;

/**
 * Reports one modal's run to the transaction centre.
 *
 * An entry opens when the flow leaves the form — that is the first moment there
 * is anything worth following — and tracks the same phase the modal shows, so
 * the two never disagree. Returning to the form starts a new entry rather than
 * rewriting the old one: a second attempt is a second transaction.
 *
 * Capture a settlement callback before asynchronous work starts. It holds the
 * entry's identity even after the modal returns to the form, starts another run,
 * or unmounts. The legacy `settle` callback follows the current modal entry.
 */
export function useTransactionCenterEntry(input: {
  kind: TransactionKind;
  label: string;
  phase: TransactionPhase;
  transactionHash?: string;
  error?: FriendlyError | null;
}) {
  const centre = useTransactionCenter();
  const upsert = centre?.upsert;
  const idRef = useRef<string | null>(null);
  const { kind, label, phase, transactionHash, error } = input;

  useEffect(() => {
    if (!upsert) return;
    // Nothing is under way, so there is nothing to follow.
    if (phase === "form" || phase === "blocked") {
      idRef.current = null;
      return;
    }
    if (!idRef.current) {
      idRef.current = nextEntryId();
    }
    upsert({
      id: idRef.current,
      kind,
      label,
      phase,
      ...(transactionHash !== undefined ? { transactionHash } : {}),
      ...(error !== undefined ? { error } : {}),
    });
  }, [error, kind, label, phase, transactionHash, upsert]);

  const captureSettlement = useCallback((options?: { newEntry?: boolean }) => {
    if (!upsert) return (_outcome: TransactionSettlement) => {};
    const id = options?.newEntry
      ? (idRef.current = nextEntryId())
      : (idRef.current ?? (idRef.current = nextEntryId()));
    // A submission can start before its busy phase has reached the effect.
    upsert({
      id,
      kind,
      label,
      phase: options?.newEntry || phase === "form" || phase === "blocked" ? "busy" : phase,
      ...(!options?.newEntry && transactionHash !== undefined ? { transactionHash } : {}),
      ...(!options?.newEntry && error !== undefined ? { error } : {}),
    });
    return (outcome: TransactionSettlement) => {
      upsert({ id, kind, label, ...outcome });
    };
  }, [error, kind, label, phase, transactionHash, upsert]);

  const settle = useCallback(
    (outcome: TransactionSettlement) => {
      if (!upsert || !idRef.current) return;
      upsert({ id: idRef.current, kind, label, ...outcome });
    },
    [kind, label, upsert],
  );

  return { settle, captureSettlement };
}

import { useCallback, useEffect, useRef } from "react";
import type { FriendlyError } from "../../../../shared/lib/errors";
import { useTransactionCenter, type TransactionKind } from "../../context/TransactionCenterContext";
import type { TransactionPhase } from "./transactionPhase";

let sequence = 0;

/**
 * Reports one modal's run to the transaction centre.
 *
 * An entry opens when the flow leaves the form — that is the first moment there
 * is anything worth following — and tracks the same phase the modal shows, so
 * the two never disagree. Returning to the form starts a new entry rather than
 * rewriting the old one: a second attempt is a second transaction.
 *
 * The returned `settle` is the part that outlives the modal. Once a transaction
 * is away it keeps working whether or not anyone is watching, and the phase this
 * hook mirrors stops updating the moment the modal unmounts — so the outcome is
 * reported through a closure over the provider instead, which is still there.
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
      sequence += 1;
      idRef.current = `tx-${Date.now()}-${sequence}`;
    }
    upsert({ id: idRef.current, kind, label, phase, transactionHash, error });
  }, [error, kind, label, phase, transactionHash, upsert]);

  const settle = useCallback(
    (outcome: {
      phase: Extract<TransactionPhase, "done" | "failed">;
      transactionHash?: string;
      error?: FriendlyError | null;
    }) => {
      if (!upsert || !idRef.current) return;
      upsert({ id: idRef.current, kind, label, ...outcome });
    },
    [kind, label, upsert],
  );

  return { settle };
}

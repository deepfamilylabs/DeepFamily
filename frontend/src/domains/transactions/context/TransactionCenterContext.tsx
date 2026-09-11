import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { FriendlyError } from "../../../shared/lib/errors";
import type { TransactionPhase } from "../ui/shared/transactionPhase";

export type TransactionKind = "addVersion" | "endorse" | "mint";

export type TransactionRecord = {
  id: string;
  kind: TransactionKind;
  /** What the transaction acts on, as the list row shows it. */
  label: string;
  phase: TransactionPhase;
  transactionHash?: string;
  error?: FriendlyError | null;
  startedAt: number;
  updatedAt: number;
};

export type TransactionUpsert = Pick<TransactionRecord, "id" | "kind" | "label" | "phase"> &
  Partial<Pick<TransactionRecord, "transactionHash" | "error">>;

type TransactionCenterValue = {
  records: TransactionRecord[];
  /** How many are still working — what the entry point badges. */
  pendingCount: number;
  upsert: (record: TransactionUpsert) => void;
  dismiss: (id: string) => void;
  clearSettled: () => void;
};

const TransactionCenterContext = createContext<TransactionCenterValue | null>(null);

const SETTLED: TransactionPhase[] = ["done", "failed"];

/**
 * Where transactions live once they outlast the modal that started them.
 *
 * A modal can only speak while it is open, but these flows keep working after
 * it closes — waiting on a receipt, then verifying the readback — and a failure
 * there matters as much as a success. This is the surface that can still say so.
 *
 * Newest first, in memory only: a transaction that has left this session is the
 * chain's record, not the app's.
 */
export function TransactionCenterProvider({ children }: { children: React.ReactNode }) {
  const [records, setRecords] = useState<TransactionRecord[]>([]);
  const sequenceRef = useRef(0);

  const upsert = useCallback((next: TransactionUpsert) => {
    setRecords((current) => {
      const now = Date.now();
      const index = current.findIndex((record) => record.id === next.id);
      if (index === -1) {
        sequenceRef.current += 1;
        return [{ ...next, startedAt: now, updatedAt: now }, ...current];
      }
      const merged = { ...current[index], ...next, updatedAt: now };
      const rest = current.slice();
      rest[index] = merged;
      return rest;
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setRecords((current) => current.filter((record) => record.id !== id));
  }, []);

  const clearSettled = useCallback(() => {
    setRecords((current) => current.filter((record) => !SETTLED.includes(record.phase)));
  }, []);

  const value = useMemo<TransactionCenterValue>(
    () => ({
      records,
      pendingCount: records.filter((record) => !SETTLED.includes(record.phase)).length,
      upsert,
      dismiss,
      clearSettled,
    }),
    [clearSettled, dismiss, records, upsert],
  );

  return (
    <TransactionCenterContext.Provider value={value}>{children}</TransactionCenterContext.Provider>
  );
}

/**
 * Reading the centre is optional: a modal rendered outside the provider — in a
 * test, or a surface that has not adopted it — still works, it just has nowhere
 * to report.
 */
export function useTransactionCenter(): TransactionCenterValue | null {
  return useContext(TransactionCenterContext);
}

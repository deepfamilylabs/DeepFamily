import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTransactionErrorContext,
  type TransactionErrorContext,
  type TransactionReceiptLike,
} from "@deepfamily/chain-client";
import type {
  TxFlowState, TxFlowActions, TxFlowProgressStatus, TransactionTracking,
} from "../model/txStatus";

/** Progress is cancellable; public receipt tracking may finish after the UI is retired. */
export type TxFlowUpdate = ((status: TxFlowProgressStatus, stepMessage?: string) => void) & {
  isCurrent: () => boolean;
  submitted: (transactionHash: string) => void;
  confirmed: (transactionHash: string, receipt?: TransactionReceiptLike) => void;
};

export type TxFlowRunner<TResult, TArgs extends unknown[]> = (
  update: TxFlowUpdate,
  ...args: TArgs
) => Promise<TResult>;

const SUPERSEDED = "Transaction flow was superseded by a newer request";

export type UseTxFlowOptions<TError = unknown> = {
  normalizeError?: (error: unknown) => TError;
  /** Deliver the original result after reset/unmount, without updating the retired UI. */
  allowBackgroundCompletion?: boolean;
};

export type UseTxFlowReturn<TResult, TArgs extends unknown[], TError = unknown> =
  TxFlowState<TResult, TError> & TxFlowActions<TArgs, TResult>;

function initialState<TResult, TError>(): TxFlowState<TResult, TError> {
  return { status: "idle", stepMessage: null, tracking: { state: "none" }, error: null, result: null };
}

function trackingAfterError(
  previous: TransactionTracking,
  context: TransactionErrorContext,
): TransactionTracking {
  if (!context.transactionHash) return previous;
  const previousConfirmation = previous.state === "confirmed" &&
    previous.transactionHash === context.transactionHash ? previous : undefined;
  // A later read failure cannot undo the successful receipt already observed.
  if (context.transactionConfirmed || previousConfirmation) {
    return { state: "confirmed", transactionHash: context.transactionHash,
      ...(previousConfirmation?.receipt ? { receipt: previousConfirmation.receipt } : {}) };
  }
  return { state: "submitted", transactionHash: context.transactionHash };
}

/** One typed state owns progress, chain confirmation and the business result. */
export function useTxFlow<TResult = unknown, TArgs extends unknown[] = [], TError = unknown>(
  runner: TxFlowRunner<TResult, TArgs>,
  options: UseTxFlowOptions<TError> = {},
): UseTxFlowReturn<TResult, TArgs, TError> {
  const [state, setState] = useState<TxFlowState<TResult, TError>>(initialState);
  const runIdRef = useRef(0);
  useEffect(() => () => { runIdRef.current += 1; }, []);
  const { normalizeError, allowBackgroundCompletion = false } = options;

  const guardedUpdate = useCallback((runId: number): TxFlowUpdate => {
    const isCurrent = () => runIdRef.current === runId;
    const report = (status: TxFlowProgressStatus, stepMessage?: string) => {
      if (!isCurrent()) throw new Error(SUPERSEDED);
      setState((previous) => isCurrent() ? {
        status, stepMessage: stepMessage ?? previous.stepMessage,
        tracking: previous.tracking, error: null, result: null,
      } : previous);
    };
    report.isCurrent = isCurrent;
    const track = (tracking: TransactionTracking) => {
      if (!isCurrent()) return;
      setState((previous) => isCurrent() ? { ...previous, tracking } : previous);
    };
    report.submitted = (transactionHash: string) => track({ state: "submitted", transactionHash });
    report.confirmed = (transactionHash: string, receipt?: TransactionReceiptLike) =>
      track({ state: "confirmed", transactionHash, ...(receipt ? { receipt } : {}) });
    return report;
  }, []);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    setState(initialState());
  }, []);

  const execute = useCallback(async (throwErrors: boolean, ...args: TArgs): Promise<TResult | undefined> => {
    const runId = ++runIdRef.current;
    const isCurrent = () => runIdRef.current === runId;
    setState({ status: "validating", stepMessage: null, tracking: { state: "none" }, error: null, result: null });
    try {
      const result = await runner(guardedUpdate(runId), ...args);
      if (!isCurrent()) {
        if (throwErrors && allowBackgroundCompletion) return result;
        if (throwErrors) throw new Error(SUPERSEDED);
        return;
      }
      setState((previous) => isCurrent() ? {
        status: "success", stepMessage: null, tracking: previous.tracking, error: null, result,
      } : previous);
      return result;
    } catch (error) {
      if (isCurrent()) {
        const context = getTransactionErrorContext(error);
        const normalized = normalizeError ? normalizeError(error) : error as TError;
        setState((previous) => isCurrent() ? {
          status: "error", stepMessage: null, error: normalized, result: null,
          tracking: trackingAfterError(previous.tracking, context),
        } : previous);
      }
      if (throwErrors) throw error;
    }
  }, [allowBackgroundCompletion, guardedUpdate, normalizeError, runner]);

  const runOrThrow = useCallback(async (...args: TArgs): Promise<TResult> =>
    await execute(true, ...args) as TResult, [execute]);
  const run = useCallback(async (...args: TArgs): Promise<void> => {
    await execute(false, ...args);
  }, [execute]);
  return { ...state, reset, run, runOrThrow };
}

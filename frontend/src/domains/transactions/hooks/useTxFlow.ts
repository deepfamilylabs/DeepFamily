import { useCallback, useEffect, useRef, useState } from "react";
import type { TxFlowState, TxFlowActions, TxFlowStatus } from "../model/txStatus";

/**
 * Generic transaction flow hook.
 *
 * Provides unified state management for any chain write operation. The caller
 * supplies a `runner` function that receives status-update callbacks and
 * performs the actual transaction work. UI components consume the returned
 * `TxFlowState` to render progress, errors, and results.
 *
 * Usage:
 * ```ts
 * const flow = useTxFlow(async (update) => {
 *   update("validating", "Checking prerequisites...");
 *   // ... validate
 *   update("submitting", "Sending transaction...");
 *   const receipt = await sendTx();
 *   return { receipt };
 * });
 * ```
 */
/**
 * Reports progress, and throws if the run has been superseded — by a newer run,
 * a reset, or an unmount. `isCurrent` asks the same question without throwing,
 * for the places that must decline rather than abort: a decision nobody is
 * waiting on any more has to resolve as a refusal.
 */
export type TxFlowUpdate = ((status: TxFlowStatus, stepMessage?: string) => void) & {
  isCurrent: () => boolean;
};

export type TxFlowRunner<TResult, TArgs extends unknown[]> = (
  update: TxFlowUpdate,
  ...args: TArgs
) => Promise<TResult>;

const SUPERSEDED = "Transaction flow was superseded by a newer request";

export type UseTxFlowOptions<TError = unknown> = {
  normalizeError?: (error: unknown) => TError;
};

export type UseTxFlowReturn<TResult, TArgs extends unknown[], TError = unknown> = TxFlowState<
  TResult,
  TError
> &
  TxFlowActions<TArgs, TResult>;

export function useTxFlow<TResult = unknown, TArgs extends unknown[] = [], TError = unknown>(
  runner: TxFlowRunner<TResult, TArgs>,
  options: UseTxFlowOptions<TError> = {},
): UseTxFlowReturn<TResult, TArgs, TError> {
  const [status, setStatus] = useState<TxFlowStatus>("idle");
  const [stepMessage, setStepMessage] = useState<string | null>(null);
  const [error, setError] = useState<TError | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<unknown | null>(null);
  const [result, setResult] = useState<TResult | null>(null);

  const runIdRef = useRef(0);

  // An unmounted flow supersedes its own in-flight run: nothing left can show
  // the outcome, so it must not write state or report success to a caller.
  useEffect(
    () => () => {
      runIdRef.current += 1;
    },
    [],
  );
  const normalizeError = options.normalizeError;
  const toFlowError = useCallback(
    (err: unknown): TError => (normalizeError ? normalizeError(err) : (err as TError)),
    [normalizeError],
  );

  const update = useCallback((nextStatus: TxFlowStatus, message?: string) => {
    setStatus(nextStatus);
    if (message !== undefined) setStepMessage(message);
  }, []);

  /**
   * A run that has been superseded — by a newer run, a reset, or an unmount —
   * stops at its next step boundary. Silently ignoring the progress report
   * would let an abandoned flow carry on to the wallet.
   */
  const guardedUpdate = useCallback(
    (runId: number): TxFlowUpdate => {
      const report = (nextStatus: TxFlowStatus, message?: string) => {
        if (runIdRef.current !== runId) throw new Error(SUPERSEDED);
        update(nextStatus, message);
      };
      report.isCurrent = () => runIdRef.current === runId;
      return report;
    },
    [update],
  );

  const resetState = useCallback(() => {
    setStatus("idle");
    setStepMessage(null);
    setError(null);
    setTxHash(null);
    setReceipt(null);
    setResult(null);
  }, []);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    resetState();
  }, [resetState]);

  const run = useCallback(
    async (...args: TArgs) => {
      const thisRunId = ++runIdRef.current;
      resetState();

      try {
        setStatus("validating");
        const flowResult = await runner(guardedUpdate(thisRunId), ...args);

        if (runIdRef.current !== thisRunId) return;

        setResult(flowResult);
        setStatus("success");
        setStepMessage(null);
      } catch (err: any) {
        if (runIdRef.current !== thisRunId) return;

        setError(toFlowError(err));
        setStatus("error");
        setStepMessage(null);
      }
    },
    [runner, resetState, toFlowError, guardedUpdate],
  );

  const runOrThrow = useCallback(
    async (...args: TArgs): Promise<TResult> => {
      const thisRunId = ++runIdRef.current;
      resetState();

      try {
        setStatus("validating");
        const flowResult = await runner(guardedUpdate(thisRunId), ...args);

        if (runIdRef.current !== thisRunId) {
          throw new Error(SUPERSEDED);
        }

        setResult(flowResult);
        setStatus("success");
        setStepMessage(null);
        return flowResult;
      } catch (err: any) {
        if (runIdRef.current !== thisRunId) {
          throw err;
        }

        setError(toFlowError(err));
        setStatus("error");
        setStepMessage(null);
        throw err;
      }
    },
    [runner, resetState, toFlowError, guardedUpdate],
  );

  return { status, stepMessage, error, txHash, receipt, result, reset, run, runOrThrow };
}

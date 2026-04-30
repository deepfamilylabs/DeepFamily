import { useCallback, useRef, useState } from "react";
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
export type TxFlowRunner<TResult, TArgs extends unknown[]> = (
  update: (status: TxFlowStatus, stepMessage?: string) => void,
  ...args: TArgs
) => Promise<TResult>;

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
  const normalizeError = options.normalizeError;
  const toFlowError = useCallback(
    (err: unknown): TError => (normalizeError ? normalizeError(err) : (err as TError)),
    [normalizeError],
  );

  const update = useCallback((nextStatus: TxFlowStatus, message?: string) => {
    setStatus(nextStatus);
    if (message !== undefined) setStepMessage(message);
  }, []);

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
        const flowResult = await runner(
          (s, m) => {
            if (runIdRef.current !== thisRunId) return;
            update(s, m);
          },
          ...args,
        );

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
    [runner, resetState, toFlowError, update],
  );

  const runOrThrow = useCallback(
    async (...args: TArgs): Promise<TResult> => {
      const thisRunId = ++runIdRef.current;
      resetState();

      try {
        setStatus("validating");
        const flowResult = await runner(
          (s, m) => {
            if (runIdRef.current !== thisRunId) return;
            update(s, m);
          },
          ...args,
        );

        if (runIdRef.current !== thisRunId) {
          throw new Error("Transaction flow was superseded by a newer request");
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
    [runner, resetState, toFlowError, update],
  );

  return { status, stepMessage, error, txHash, receipt, result, reset, run, runOrThrow };
}

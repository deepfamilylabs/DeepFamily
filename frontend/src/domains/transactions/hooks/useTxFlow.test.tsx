// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTxFlow, type TxFlowRunner } from "./useTxFlow";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("useTxFlow", () => {
  it("runOrThrow returns the runner result and stores success state", async () => {
    const runner: TxFlowRunner<{ txHash: string }, [string]> = vi.fn(async (update, label) => {
      update("submitting", `submitting ${label}`);
      return { txHash: "0x123" };
    });

    const { result } = renderHook(() => useTxFlow(runner));

    let flowResult: { txHash: string } | undefined;
    await act(async () => {
      flowResult = await result.current.runOrThrow("mint");
    });

    expect(flowResult).toEqual({ txHash: "0x123" });
    expect(result.current.status).toBe("success");
    expect(result.current.result).toEqual({ txHash: "0x123" });
    expect(result.current.error).toBeNull();
    expect(result.current.stepMessage).toBeNull();
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("runOrThrow throws the runner error and stores error state", async () => {
    const failure = new Error("wallet rejected");
    const runner: TxFlowRunner<string, []> = vi.fn(async (update) => {
      update("confirming", "waiting");
      throw failure;
    });

    const { result } = renderHook(() => useTxFlow(runner));

    await act(async () => {
      await expect(result.current.runOrThrow()).rejects.toBe(failure);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe(failure);
    expect(result.current.result).toBeNull();
    expect(result.current.stepMessage).toBeNull();
  });

  it("stores normalized errors when a normalizer is supplied", async () => {
    const failure = new Error("wallet pending");
    const runner: TxFlowRunner<string, []> = vi.fn(async () => {
      throw failure;
    });
    const normalizeError = vi.fn(() => ({ type: "WALLET_REQUEST_PENDING", message: "pending" }));

    const { result } = renderHook(() => useTxFlow(runner, { normalizeError }));

    await act(async () => {
      await expect(result.current.runOrThrow()).rejects.toBe(failure);
    });

    expect(normalizeError).toHaveBeenCalledWith(failure);
    expect(result.current.error).toEqual({ type: "WALLET_REQUEST_PENDING", message: "pending" });
  });

  it("runOrThrow rejects superseded requests without letting stale completion win", async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const runner: TxFlowRunner<string, [number]> = vi.fn(async (_update, runId) => {
      return runId === 1 ? first.promise : second.promise;
    });

    const { result } = renderHook(() => useTxFlow(runner));

    let firstPromise!: Promise<string>;
    let secondPromise!: Promise<string>;
    await act(async () => {
      firstPromise = result.current.runOrThrow(1);
      secondPromise = result.current.runOrThrow(2);
    });

    await act(async () => {
      first.resolve("first");
      second.resolve("second");
      await expect(firstPromise).rejects.toThrow("superseded");
      await expect(secondPromise).resolves.toBe("second");
    });

    expect(result.current.status).toBe("success");
    expect(result.current.result).toBe("second");
    expect(result.current.error).toBeNull();
  });
});

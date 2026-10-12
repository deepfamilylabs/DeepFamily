import { describe, expect, it, vi } from "vitest";
import {
  getWalletConnectionGeneration,
  invalidateWalletConnection,
  subscribeWalletConnectionChange,
} from "./walletConnectionGeneration";

describe("wallet connection generation", () => {
  it("invalidates synchronously and permanently, including consecutive same-connection events", () => {
    const before = getWalletConnectionGeneration();
    const observed: number[] = [];
    const unsubscribe = subscribeWalletConnectionChange(() =>
      observed.push(getWalletConnectionGeneration()),
    );
    invalidateWalletConnection();
    expect(observed).toEqual([before + 1]);
    invalidateWalletConnection();
    expect(observed).toEqual([before + 1, before + 2]);
    unsubscribe();
    invalidateWalletConnection();
    expect(observed).toHaveLength(2);
    expect(getWalletConnectionGeneration()).toBe(before + 3);
  });

  it("unsubscribes only the registered listener", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeWalletConnectionChange(first);
    const unsubscribeSecond = subscribeWalletConnectionChange(second);
    unsubscribeFirst();
    invalidateWalletConnection();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    unsubscribeSecond();
  });
});

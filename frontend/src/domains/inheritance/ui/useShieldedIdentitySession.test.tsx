// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShieldedPublicIdentity } from "../../../shared/workers/shieldedAssetWorkerTypes";
import {
  SHIELDED_IDENTITY_IDLE_TIMEOUT_MS,
  useShieldedIdentitySession,
} from "./useShieldedIdentitySession";

const identity: ShieldedPublicIdentity = {handle: "identity:1", identitySuiteId: 1, identity: {fullName: "Test Person"}, identityCommitment: "777", personHash: "0x" + "00".repeat(32)};

describe("useShieldedIdentitySession", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the identity for ten idle minutes, then locks", () => {
    const { result } = renderHook(() => useShieldedIdentitySession({ scope: "wallet-a" }));
    expect(result.current.identity).toBeNull();
    act(() => result.current.unlock(identity));
    act(() => vi.advanceTimersByTime(SHIELDED_IDENTITY_IDLE_TIMEOUT_MS - 1));
    expect(result.current.identity).toEqual(identity);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.identity).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["pointerdown", "keydown", "touch"])("extends the idle window on %s", (activity) => {
    const { result } = renderHook(() => useShieldedIdentitySession({ scope: "wallet-a" }));
    act(() => result.current.unlock(identity));
    act(() => vi.advanceTimersByTime(SHIELDED_IDENTITY_IDLE_TIMEOUT_MS - 1));
    act(() => {
      if (activity === "touch") result.current.touch();
      else window.dispatchEvent(new Event(activity));
    });
    act(() => vi.advanceTimersByTime(SHIELDED_IDENTITY_IDLE_TIMEOUT_MS - 1));
    expect(result.current.identity).toEqual(identity);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.identity).toBeNull();
  });

  it("holds the identity during long operations and starts a fresh idle window afterward", () => {
    const { result, rerender } = renderHook(
      ({ busy }) => useShieldedIdentitySession({ scope: "wallet-a", busy }),
      { initialProps: { busy: false } },
    );
    act(() => result.current.unlock(identity));
    act(() => vi.advanceTimersByTime(SHIELDED_IDENTITY_IDLE_TIMEOUT_MS - 1));
    rerender({ busy: true });
    act(() => vi.advanceTimersByTime(3 * SHIELDED_IDENTITY_IDLE_TIMEOUT_MS));
    expect(result.current.identity).toEqual(identity);
    expect(vi.getTimerCount()).toBe(0);
    rerender({ busy: false });
    act(() => vi.advanceTimersByTime(SHIELDED_IDENTITY_IDLE_TIMEOUT_MS - 1));
    expect(result.current.identity).toEqual(identity);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.identity).toBeNull();
  });

  it("can unlock while busy and still supports immediate manual locking", () => {
    const { result, rerender } = renderHook(
      ({ busy }) => useShieldedIdentitySession({ scope: "wallet-a", busy }),
      { initialProps: { busy: true } },
    );
    act(() => result.current.unlock(identity));
    expect(result.current.identity).toEqual(identity);
    expect(vi.getTimerCount()).toBe(0);
    act(() => result.current.lock());
    rerender({ busy: false });
    expect(result.current.identity).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never exposes a former scope's identity and rejects its delayed unlock callback", () => {
    const observed: Array<{ scope: string; identity: ShieldedPublicIdentity | null }> = [];
    const { result, rerender } = renderHook(
      ({ scope }) => {
        const session = useShieldedIdentitySession({ scope, busy: true });
        observed.push({ scope, identity: session.identity });
        return session;
      },
      { initialProps: { scope: "wallet-a" } },
    );
    const oldUnlock = result.current.unlock;
    act(() => oldUnlock(identity));
    rerender({ scope: "wallet-b" });
    expect(
      observed
        .filter((entry) => entry.scope === "wallet-b")
        .every((entry) => entry.identity === null),
    ).toBe(true);
    expect(result.current.identity).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    act(() => oldUnlock(identity));
    expect(result.current.identity).toBeNull();
    act(() => result.current.unlock(identity));
    expect(result.current.identity).toEqual(identity);
    rerender({ scope: "wallet-a" });
    act(() => oldUnlock(identity));
    expect(result.current.identity).toBeNull();
  });

  it.each([false, true])(
    "locks on pagehide with persisted=%s, including busy operations",
    (persisted) => {
      const { result } = renderHook(() =>
        useShieldedIdentitySession({ scope: "wallet-a", busy: true }),
      );
      act(() => result.current.unlock(identity));
      act(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted })));
      expect(result.current.identity).toBeNull();
      act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted })));
      expect(result.current.identity).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["lock", "pagehide"])(
    "rejects a pending derivation completed after %s, while allowing a new unlock",
    (reason) => {
      const { result } = renderHook(() =>
        useShieldedIdentitySession({ scope: "wallet-a", busy: true }),
      );
      const pendingUnlock = result.current.unlock;
      act(() => {
        if (reason === "lock") result.current.lock();
        else window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      });
      act(() => pendingUnlock(identity));
      expect(result.current.identity).toBeNull();
      act(() => result.current.unlock(identity));
      expect(result.current.identity).toEqual(identity);
    },
  );

  it("releases timers and listeners on unmount and ignores later unlocks", () => {
    const removeListener = vi.spyOn(window, "removeEventListener");
    const { result, unmount } = renderHook(() => useShieldedIdentitySession({ scope: "wallet-a" }));
    const { unlock, touch } = result.current;
    act(() => unlock(identity));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith("pointerdown", expect.any(Function), true);
    expect(removeListener).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    expect(removeListener).toHaveBeenCalledWith("pagehide", expect.any(Function));
    act(() => {
      unlock(identity);
      touch();
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("works after React StrictMode effect replay and never writes the identity to storage", () => {
    const localWrite = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useShieldedIdentitySession({ scope: "wallet-a" }), {
      wrapper: StrictMode,
    });
    act(() => result.current.unlock(identity));
    expect(result.current.identity).toEqual(identity);
    expect(vi.getTimerCount()).toBe(1);
    expect(localWrite).not.toHaveBeenCalled();
    act(() => result.current.lock());
    expect(result.current.identity).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ShieldedPublicIndependentKey,
  ShieldedPublicIdentity,
} from "../../../shared/workers/shieldedAssetWorkerTypes";
import { terminateShieldedAssetWorker } from "../../../shared/workers/shieldedAssetWorkerClient";
import {
  SHIELDED_IDENTITY_IDLE_TIMEOUT_MS,
  SHIELDED_WALLET_REQUEST_TIMEOUT_MS,
  useShieldedIdentitySession,
} from "./useShieldedIdentitySession";

const identity: ShieldedPublicIdentity = {handle: "identity:1", identitySuiteId: 1, identity: {fullName: "Test Person"}, identityCommitment: "777", personHash: "0x" + "00".repeat(32)};
const independentKey: ShieldedPublicIndependentKey = {
  ownerCommitment: "888",
  viewingKey: "0x" + "11".repeat(32),
  keyFingerprint: "0x" + "22".repeat(32),
  rootSource: "random",
  recoveryVerified: true,
};
const draft = {
  fullName: "Test Person",
  isBirthBC: false,
  birthYear: 2001,
  birthMonth: 4,
  birthDay: 9,
  gender: 1,
};

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

  it("keeps the public re-unlock draft through locks but forgets it on idle expiry", () => {
    const { result } = renderHook(() => useShieldedIdentitySession({ scope: "wallet-a" }));
    act(() => result.current.unlock(identity));
    act(() => result.current.rememberIdentityDraft(draft));
    act(() => result.current.lock());
    expect(result.current.identity).toBeNull();
    expect(result.current.identityDraft).toEqual(draft);
    act(() => result.current.unlock(identity));
    act(() => vi.advanceTimersByTime(SHIELDED_IDENTITY_IDLE_TIMEOUT_MS));
    expect(result.current.identity).toBeNull();
    expect(result.current.identityDraft).toBeNull();
    expect(JSON.stringify(result.current)).not.toContain("passphrase");
  });

  it.each(["lock", "hidden", "pagehide", "worker lock"])(
    "expires retained person details without re-unlocking after %s",
    (reason) => {
      const { result } = renderHook(() => useShieldedIdentitySession({ scope: "wallet-a" }));
      act(() => {
        result.current.unlock(identity);
        result.current.rememberIdentityDraft(draft);
      });
      act(() => vi.advanceTimersByTime(SHIELDED_IDENTITY_IDLE_TIMEOUT_MS / 2));
      act(() => {
        if (reason === "lock") result.current.lock();
        else if (reason === "hidden") {
          vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
          document.dispatchEvent(new Event("visibilitychange"));
        } else if (reason === "pagehide") {
          window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
        } else terminateShieldedAssetWorker();
      });
      expect(result.current.identity).toBeNull();
      expect(result.current.identityDraft).toEqual(draft);
      act(() => vi.advanceTimersByTime(SHIELDED_IDENTITY_IDLE_TIMEOUT_MS / 2 - 1));
      expect(result.current.identityDraft).toEqual(draft);
      act(() => vi.advanceTimersByTime(1));
      expect(result.current.identityDraft).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["pointerdown", "keydown", "touch"])(
    "extends retained person details' idle window on %s while locked",
    (activity) => {
      const { result } = renderHook(() => useShieldedIdentitySession({ scope: "wallet-a" }));
      act(() => {
        result.current.unlock(identity);
        result.current.rememberIdentityDraft(draft);
        result.current.lock();
      });
      act(() => vi.advanceTimersByTime(SHIELDED_IDENTITY_IDLE_TIMEOUT_MS - 1));
      act(() => {
        if (activity === "touch") result.current.touch();
        else window.dispatchEvent(new Event(activity));
      });
      act(() => vi.advanceTimersByTime(SHIELDED_IDENTITY_IDLE_TIMEOUT_MS - 1));
      expect(result.current.identity).toBeNull();
      expect(result.current.identityDraft).toEqual(draft);
      act(() => vi.advanceTimersByTime(1));
      expect(result.current.identityDraft).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([false, true])(
    "holds person details during busy operations and renews their idle window, locked=%s",
    (locked) => {
      const { result, rerender } = renderHook(
        ({ busy }) => useShieldedIdentitySession({ scope: "wallet-a", busy }),
        { initialProps: { busy: false } },
      );
      act(() => {
        result.current.unlock(identity);
        result.current.rememberIdentityDraft(draft);
      });
      act(() => vi.advanceTimersByTime(SHIELDED_IDENTITY_IDLE_TIMEOUT_MS - 1));
      rerender({ busy: true });
      if (locked) act(() => result.current.lock());
      act(() => vi.advanceTimersByTime(3 * SHIELDED_IDENTITY_IDLE_TIMEOUT_MS));
      expect(result.current.identity).toEqual(locked ? null : identity);
      expect(result.current.identityDraft).toEqual(draft);
      expect(vi.getTimerCount()).toBe(0);
      rerender({ busy: false });
      act(() => vi.advanceTimersByTime(SHIELDED_IDENTITY_IDLE_TIMEOUT_MS - 1));
      expect(result.current.identityDraft).toEqual(draft);
      act(() => vi.advanceTimersByTime(1));
      expect(result.current.identity).toBeNull();
      expect(result.current.identityDraft).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("forgets former-scope person details before render and rejects delayed draft callbacks", () => {
    const observed: Array<{ scope: string; draft: typeof draft | null }> = [];
    const { result, rerender } = renderHook(
      ({ scope }) => {
        const session = useShieldedIdentitySession({ scope });
        observed.push({ scope, draft: session.identityDraft });
        return session;
      },
      { initialProps: { scope: "wallet-a" } },
    );
    const oldRemember = result.current.rememberIdentityDraft;
    act(() => oldRemember(draft));
    rerender({ scope: "wallet-b" });
    expect(observed.filter((entry) => entry.scope === "wallet-b").every((entry) => entry.draft === null))
      .toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    act(() => oldRemember(draft));
    expect(result.current.identityDraft).toBeNull();
    act(() => result.current.rememberIdentityDraft(draft));
    expect(result.current.identityDraft).toEqual(draft);
    rerender({ scope: "wallet-a" });
    act(() => oldRemember(draft));
    expect(result.current.identityDraft).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels retained person details' expiry when explicitly forgotten or unmounted", () => {
    const { result, unmount } = renderHook(() => useShieldedIdentitySession({ scope: "wallet-a" }));
    act(() => result.current.rememberIdentityDraft(draft));
    expect(vi.getTimerCount()).toBe(1);
    act(() => result.current.rememberIdentityDraft(null));
    expect(result.current.identityDraft).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    act(() => result.current.rememberIdentityDraft(draft));
    const remember = result.current.rememberIdentityDraft;
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => remember(draft));
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

  it("keeps both credentials during a wallet transaction and renews idle time on visible return", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const { result } = renderHook(() => useShieldedIdentitySession({ scope: "wallet-a" }));
    act(() => result.current.update({ credentials: { handle: "credentials:1" }, identity, independentKey }));
    act(() => vi.advanceTimersByTime(SHIELDED_IDENTITY_IDLE_TIMEOUT_MS - 1));
    let endRequest!: () => void;
    act(() => {
      endRequest = result.current.beginWalletRequest();
      expect(result.current.isWalletRequestPending()).toBe(true);
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => vi.advanceTimersByTime(SHIELDED_WALLET_REQUEST_TIMEOUT_MS - 1));
    expect(result.current.identity).toEqual(identity);
    expect(result.current.independentKey).toEqual(independentKey);
    act(() => {
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      endRequest();
      endRequest();
    });
    expect(result.current.isWalletRequestPending()).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(SHIELDED_IDENTITY_IDLE_TIMEOUT_MS - 1));
    expect(result.current.identity).toEqual(identity);
    expect(result.current.independentKey).toEqual(independentKey);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.identity).toBeNull();
    expect(result.current.independentKey).toBeNull();
  });

  it("locks on hiding even when busy if no wallet transaction request is pending", () => {
    const { result } = renderHook(() =>
      useShieldedIdentitySession({ scope: "wallet-a", busy: true }),
    );
    act(() => result.current.update({ credentials: { handle: "credentials:1" }, identity, independentKey }));
    act(() => {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.identity).toBeNull();
    expect(result.current.independentKey).toBeNull();
    expect(result.current.isWalletRequestPending()).toBe(false);
  });

  it("locks if a wallet request finishes while the page remains hidden", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const { result } = renderHook(() =>
      useShieldedIdentitySession({ scope: "wallet-a", busy: true }),
    );
    act(() => result.current.update({ credentials: { handle: "credentials:1" }, identity, independentKey }));
    let endRequest!: () => void;
    act(() => {
      endRequest = result.current.beginWalletRequest();
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.identity).toEqual(identity);
    act(() => endRequest());
    expect(result.current.identity).toBeNull();
    expect(result.current.independentKey).toBeNull();
    expect(result.current.isWalletRequestPending()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["visible", "hidden"] as const)(
    "locks a timed-out wallet request while %s and ignores its late result",
    (visibilityState) => {
      const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      const { result } = renderHook(() =>
        useShieldedIdentitySession({ scope: "wallet-a", busy: true }),
      );
      act(() => result.current.update({ credentials: { handle: "credentials:1" }, identity, independentKey }));
      let endRequest!: () => void;
      act(() => {
        endRequest = result.current.beginWalletRequest();
        visibility.mockReturnValue(visibilityState);
        document.dispatchEvent(new Event("visibilitychange"));
      });
      act(() => vi.advanceTimersByTime(SHIELDED_WALLET_REQUEST_TIMEOUT_MS - 1));
      expect(result.current.identity).toEqual(identity);
      act(() => vi.advanceTimersByTime(1));
      expect(result.current.identity).toBeNull();
      expect(result.current.independentKey).toBeNull();
      expect(result.current.isWalletRequestPending()).toBe(false);
      act(() => endRequest());
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["manual", "pagehide", "scope", "worker"] as const)(
    "immediately clears the wallet request exception on %s locking",
    (reason) => {
      const { result, rerender } = renderHook(
        ({ scope }) => useShieldedIdentitySession({ scope, busy: true }),
        { initialProps: { scope: "wallet-a" } },
      );
      act(() => result.current.update({ credentials: { handle: "credentials:1" }, identity, independentKey }));
      let endRequest!: () => void;
      act(() => { endRequest = result.current.beginWalletRequest(); });
      expect(result.current.isWalletRequestPending()).toBe(true);
      if (reason === "scope") rerender({ scope: "wallet-b" });
      else act(() => {
        if (reason === "manual") result.current.lock();
        else if (reason === "worker") terminateShieldedAssetWorker();
        else window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      });
      expect(result.current.identity).toBeNull();
      expect(result.current.independentKey).toBeNull();
      expect(result.current.isWalletRequestPending()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      act(() => endRequest());
      expect(result.current.identity).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("does not let a late wallet release end a newer request or session", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const { result } = renderHook(() =>
      useShieldedIdentitySession({ scope: "wallet-a", busy: true }),
    );
    act(() => result.current.unlock(identity));
    const oldBegin = result.current.beginWalletRequest;
    let oldEnd!: () => void;
    act(() => { oldEnd = oldBegin(); });
    act(() => result.current.lock());
    act(() => result.current.update({ credentials: { handle: "credentials:1" }, identity, independentKey }));
    let newEnd!: () => void;
    act(() => {
      newEnd = result.current.beginWalletRequest();
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      oldEnd();
      oldBegin()();
    });
    expect(result.current.isWalletRequestPending()).toBe(true);
    expect(result.current.identity).toEqual(identity);
    expect(result.current.independentKey).toEqual(independentKey);
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      visibility.mockReturnValue("visible");
      newEnd();
    });
    expect(result.current.isWalletRequestPending()).toBe(false);
    expect(result.current.identity).toEqual(identity);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not let a replaced request's release or timeout affect the current request", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const { result } = renderHook(() =>
      useShieldedIdentitySession({ scope: "wallet-a", busy: true }),
    );
    act(() => result.current.unlock(identity));
    let oldEnd!: () => void;
    act(() => { oldEnd = result.current.beginWalletRequest(); });
    act(() => vi.advanceTimersByTime(SHIELDED_WALLET_REQUEST_TIMEOUT_MS - 1));
    let newEnd!: () => void;
    act(() => {
      newEnd = result.current.beginWalletRequest();
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      oldEnd();
    });
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.isWalletRequestPending()).toBe(true);
    expect(result.current.identity).toEqual(identity);
    act(() => {
      visibility.mockReturnValue("visible");
      newEnd();
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up wallet requests on unmount and supports StrictMode effect replay", () => {
    const { result, unmount } = renderHook(() =>
      useShieldedIdentitySession({ scope: "wallet-a", busy: true }), { wrapper: StrictMode },
    );
    act(() => result.current.unlock(identity));
    let endRequest!: () => void;
    act(() => { endRequest = result.current.beginWalletRequest(); });
    expect(result.current.isWalletRequestPending()).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    const beginAfterUnmount = result.current.beginWalletRequest;
    unmount();
    act(() => {
      endRequest();
      beginAfterUnmount()();
    });
    expect(result.current.isWalletRequestPending()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
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

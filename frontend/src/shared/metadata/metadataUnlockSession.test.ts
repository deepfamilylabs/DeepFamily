// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimAutomaticMetadataUnlock,
  finishAutomaticMetadataUnlock,
  getAutomaticMetadataUnlockIssues,
  getMetadataUnlockPreference,
  getMetadataUnlockSessionRevision,
  hasAutomaticMetadataUnlockAttempt,
  isAutomaticMetadataUnlockPaused,
  pauseAutomaticMetadataUnlock,
  setMetadataUnlockPreference,
  subscribeMetadataUnlockSession,
} from "./metadataUnlockSession";

let nextScope = 0;
let scope: string;

describe("metadata unlock page session", () => {
  beforeEach(() => {
    scope = `unlock-session-test-${++nextScope}`;
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("remembers unlocks by default and persists a scope-specific opt-out", () => {
    const otherScope = `${scope}-other`;
    expect(getMetadataUnlockPreference(scope)).toBe(true);
    expect(getMetadataUnlockPreference(otherScope)).toBe(true);

    setMetadataUnlockPreference(scope, false);

    expect(getMetadataUnlockPreference(scope)).toBe(false);
    expect(getMetadataUnlockPreference(otherScope)).toBe(true);
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem(`${scope}::rememberMetadataUnlocks`)).toBe("false");
    setMetadataUnlockPreference(scope, true);
    expect(getMetadataUnlockPreference(scope)).toBe(true);
  });

  it.each([true, false])("loads an existing explicit remember=%s choice", (remember) => {
    localStorage.setItem(`${scope}::rememberMetadataUnlocks`, String(remember));
    expect(getMetadataUnlockPreference(scope)).toBe(remember);
  });

  it("keeps the default and permits opting out when preference storage is unavailable", () => {
    const unavailable = `${scope}-unavailable`;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage disabled");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage disabled");
    });
    expect(getMetadataUnlockPreference(unavailable)).toBe(true);
    expect(() => setMetadataUnlockPreference(unavailable, false)).not.toThrow();
    expect(getMetadataUnlockPreference(unavailable)).toBe(false);
  });

  it("claims one attempt per key across subscribers while isolating other scopes", () => {
    const key = "public-node-and-envelope";
    const first = claimAutomaticMetadataUnlock(scope, key)!;
    expect(first).toBeInstanceOf(AbortController);
    expect(claimAutomaticMetadataUnlock(scope, key)).toBeNull();
    expect(claimAutomaticMetadataUnlock(`${scope}-other`, key)).toBeInstanceOf(AbortController);
    finishAutomaticMetadataUnlock(scope, key, first);
    expect(hasAutomaticMetadataUnlockAttempt(scope, key)).toBe(true);
    expect(claimAutomaticMetadataUnlock(scope, key)).toBeNull();
    expect(claimAutomaticMetadataUnlock(scope, `${key}-new-envelope`)).toBeInstanceOf(
      AbortController,
    );
  });

  it("releases interrupted claims for retry and ignores a stale owner's late completion", () => {
    const key = "interrupted-envelope";
    const first = claimAutomaticMetadataUnlock(scope, key)!;
    finishAutomaticMetadataUnlock(scope, key, first, { retry: true });
    expect(hasAutomaticMetadataUnlockAttempt(scope, key)).toBe(false);

    const retry = claimAutomaticMetadataUnlock(scope, key)!;
    finishAutomaticMetadataUnlock(scope, key, first, { retry: true, issue: "validation" });
    expect(hasAutomaticMetadataUnlockAttempt(scope, key)).toBe(true);
    expect(getAutomaticMetadataUnlockIssues(scope)).toEqual([]);
    finishAutomaticMetadataUnlock(scope, key, retry, { issue: "read" });
    expect(getAutomaticMetadataUnlockIssues(scope)).toEqual([{ key, kind: "read" }]);
  });

  it("pauses and aborts every active attempt for the scope, including future remounts", () => {
    const first = claimAutomaticMetadataUnlock(scope, "first")!;
    const second = claimAutomaticMetadataUnlock(scope, "second")!;
    const other = claimAutomaticMetadataUnlock(`${scope}-other`, "first")!;
    const listener = vi.fn();
    const unsubscribe = subscribeMetadataUnlockSession(scope, listener);
    const revision = getMetadataUnlockSessionRevision(scope);

    pauseAutomaticMetadataUnlock(scope);

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(false);
    expect(isAutomaticMetadataUnlockPaused(scope)).toBe(true);
    expect(getMetadataUnlockSessionRevision(scope)).toBeGreaterThan(revision);
    expect(listener).toHaveBeenCalledOnce();
    finishAutomaticMetadataUnlock(scope, "first", first, { retry: true });
    expect(claimAutomaticMetadataUnlock(scope, "first")).toBeNull();
    expect(claimAutomaticMetadataUnlock(scope, "new")).toBeNull();
    unsubscribe();
    listener.mockClear();
    setMetadataUnlockPreference(scope, true);
    expect(listener).not.toHaveBeenCalled();
  });
});

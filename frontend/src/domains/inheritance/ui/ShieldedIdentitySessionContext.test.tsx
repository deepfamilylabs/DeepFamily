// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IdentityMaterialV1Result } from "../../../shared/workers/cryptoWorkerClient";
import {
  ShieldedIdentitySessionProvider,
  useShieldedPageIdentitySession,
} from "./ShieldedIdentitySessionContext";
import { SHIELDED_IDENTITY_IDLE_TIMEOUT_MS } from "./useShieldedIdentitySession";

const identity = { personHash: "0xabc", derivedSecretField: "123" } as IdentityMaterialV1Result;
let currentSession: ReturnType<typeof useShieldedPageIdentitySession>;
function PoolConsumer() {
  currentSession = useShieldedPageIdentitySession();
  return <span>{currentSession.identity ? "unlocked" : "locked"}</span>;
}
function Page({
  pool = "deep",
  scope = "31337:factory",
  enabled = true,
}: {
  pool?: string;
  scope?: string;
  enabled?: boolean;
}) {
  return (
    <ShieldedIdentitySessionProvider scope={scope} enabled={enabled}>
      <PoolConsumer key={pool} />
    </ShieldedIdentitySessionProvider>
  );
}
describe("page identity shared across asset pools", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the same in-memory identity across pool remounts and still expires after inactivity", () => {
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const { rerender } = render(<Page />);
    act(() => currentSession.unlock(identity));
    rerender(<Page pool="native" />);
    expect(currentSession.identity).toBe(identity);
    expect(screen.getByText("unlocked")).toBeTruthy();
    expect(storageWrite).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(SHIELDED_IDENTITY_IDLE_TIMEOUT_MS));
    expect(currentSession.identity).toBeNull();
  });

  it("rejects a former protocol's delayed unlock on a chain or factory change", () => {
    const { rerender } = render(<Page />);
    const oldUnlock = currentSession.unlock;
    act(() => oldUnlock(identity));
    rerender(<Page scope="71:other-factory" />);
    expect(currentSession.identity).toBeNull();
    act(() => oldUnlock(identity));
    expect(currentSession.identity).toBeNull();
  });

  it("locks on disconnect or wrong network and does not restore a stale derivation on return", () => {
    const { rerender } = render(<Page />);
    const oldUnlock = currentSession.unlock;
    act(() => currentSession.unlock(identity));
    rerender(<Page enabled={false} />);
    act(() => currentSession.unlock(identity));
    expect(currentSession.identity).toBeNull();
    rerender(<Page />);
    act(() => oldUnlock(identity));
    expect(currentSession.identity).toBeNull();
  });

  it("does not let an old panel release another panel's active operation", () => {
    const { rerender } = render(<Page />);
    act(() => {
      currentSession.unlock(identity);
      currentSession.setBusy(true);
    });
    const oldSetBusy = currentSession.setBusy;
    rerender(<Page pool="native" />);
    act(() => currentSession.setBusy(true));
    act(() => oldSetBusy(false));
    act(() => vi.advanceTimersByTime(2 * SHIELDED_IDENTITY_IDLE_TIMEOUT_MS));
    expect(currentSession.identity).toBe(identity);
    act(() => currentSession.setBusy(false));
    act(() => oldSetBusy(true));
    act(() => vi.advanceTimersByTime(SHIELDED_IDENTITY_IDLE_TIMEOUT_MS));
    expect(currentSession.identity).toBeNull();
  });
});

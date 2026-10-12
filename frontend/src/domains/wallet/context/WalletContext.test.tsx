// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalletProvider, useWallet } from "./WalletContext";
import {
  getWalletConnectionGeneration,
  subscribeWalletConnectionChange,
} from "../services/walletConnectionGeneration";

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  provider: vi.fn(),
  t: (_key: string, fallback?: string) => fallback ?? _key,
}));
vi.mock("../../../shared/ui", () => ({ useToast: () => mocks.toast }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("../services/walletProvider", () => ({
  createWalletProvider: (...args: unknown[]) => mocks.provider(...args),
}));

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
let current: ReturnType<typeof useWallet>;
function Consumer() {
  current = useWallet();
  return null;
}
function mount() {
  return render(
    <WalletProvider>
      <Consumer />
    </WalletProvider>,
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function signer(address = A) {
  return { getAddress: vi.fn(async () => address) };
}
function provider(address = A, chainId = 31337n) {
  const selectedSigner = signer(address);
  return {
    getSigner: vi.fn(async () => selectedSigner),
    getNetwork: vi.fn(async () => ({ chainId })),
    getBalance: vi.fn(async () => 1_000_000_000_000_000_000n),
    signer: selectedSigner,
  };
}
function rawProvider() {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  return {
    request: vi.fn(async (_input: { method: string }): Promise<any> => [A]),
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      const subscribers = listeners.get(event) ?? new Set();
      subscribers.add(listener);
      listeners.set(event, subscribers);
    }),
    removeListener: vi.fn((event: string, listener: (...args: any[]) => void) =>
      listeners.get(event)?.delete(listener),
    ),
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(...args);
    },
  };
}
async function connect(raw = rawProvider(), wrapped = provider()) {
  mocks.provider.mockReturnValueOnce(wrapped);
  await act(async () => {
    await current.connectWithProvider(raw, "test");
  });
  return { raw, wrapped };
}

describe("WalletProvider connection invalidation", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.provider.mockReset();
    for (const toast of Object.values(mocks.toast)) toast.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the selected provider usable after StrictMode setup-cleanup-setup", async () => {
    render(
      <React.StrictMode>
        <WalletProvider>
          <Consumer />
        </WalletProvider>
      </React.StrictMode>,
    );
    const { raw } = await connect();
    const refreshing = provider();
    mocks.provider.mockReturnValue(refreshing);
    const before = getWalletConnectionGeneration();
    act(() => raw.emit("accountsChanged", [A]));
    expect(getWalletConnectionGeneration()).toBe(before + 1);
    await waitFor(() => expect(current.signer).toBe(refreshing.signer));
    expect(current.rawProvider).toBe(raw);
  });

  it.each(["accountsChanged", "chainChanged", "disconnect"])(
    "invalidates %s synchronously before signer refresh or React state",
    async (event) => {
      mount();
      const { raw } = await connect();
      const pending = deferred<ReturnType<typeof signer>>();
      const refreshing = provider();
      refreshing.getSigner.mockReturnValue(pending.promise);
      mocks.provider.mockReturnValue(refreshing);
      const before = getWalletConnectionGeneration();
      const observed: number[] = [];
      const unsubscribe = subscribeWalletConnectionChange(() =>
        observed.push(getWalletConnectionGeneration()),
      );
      act(() => raw.emit(event, event === "accountsChanged" ? [A] : "0x7a69"));
      expect(getWalletConnectionGeneration()).toBeGreaterThan(before);
      expect(observed[0]).toBe(before + 1);
      if (event === "disconnect") expect(current.address).toBeNull();
      else expect(current.signer).toBeNull();
      unsubscribe();
      await act(async () => pending.resolve(refreshing.signer));
    },
  );

  it("keeps a fast chain A→B→A switch invalidated and discards the older refresh", async () => {
    mount();
    const { raw } = await connect();
    const older = deferred<ReturnType<typeof signer>>();
    const newer = deferred<ReturnType<typeof signer>>();
    const oldProvider = provider(B, 1n);
    const newProvider = provider(A);
    oldProvider.getSigner.mockReturnValue(older.promise);
    newProvider.getSigner.mockReturnValue(newer.promise);
    mocks.provider.mockReturnValueOnce(oldProvider).mockReturnValueOnce(newProvider);
    const before = getWalletConnectionGeneration();
    act(() => {
      raw.emit("chainChanged", "0x1");
      raw.emit("chainChanged", "0x7a69");
    });
    expect(getWalletConnectionGeneration()).toBe(before + 2);
    await act(async () => newer.resolve(newProvider.signer));
    await waitFor(() => expect(current.signer).toBe(newProvider.signer));
    await act(async () => older.resolve(oldProvider.signer));
    expect(current.signer).toBe(newProvider.signer);
    expect(current.chainId).toBe(31337);
    expect(current.address).toBe(A);
  });

  it("never revives an account refresh after disconnect", async () => {
    mount();
    const { raw } = await connect();
    const pending = deferred<ReturnType<typeof signer>>();
    const refreshing = provider(B);
    refreshing.getSigner.mockReturnValue(pending.promise);
    mocks.provider.mockReturnValue(refreshing);
    act(() => raw.emit("accountsChanged", [B]));
    act(() => current.disconnect());
    await act(async () => pending.resolve(refreshing.signer));
    expect(current.address).toBeNull();
    expect(current.signer).toBeNull();
    expect(current.isConnecting).toBe(false);
    expect(localStorage.getItem("deepfamily_last_wallet_type")).toBeNull();
  });

  it("invalidates a pending connection on disconnect before the first account arrives", async () => {
    mount();
    const raw = rawProvider();
    const accounts = deferred<string[]>();
    raw.request.mockReturnValue(accounts.promise);
    let connecting: Promise<void>;
    act(() => {
      connecting = current.connectWithProvider(raw, "test");
    });
    expect(current.isConnecting).toBe(true);
    act(() => current.disconnect());
    await act(async () => {
      accounts.resolve([A]);
      await connecting;
    });
    expect(current.address).toBeNull();
    expect(current.isConnecting).toBe(false);
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("keeps a newer connection when an earlier connection and its balance finish late", async () => {
    mount();
    const firstRaw = rawProvider();
    const first = provider(A);
    const firstBalance = deferred<bigint>();
    first.getBalance.mockReturnValue(firstBalance.promise);
    mocks.provider.mockReturnValueOnce(first);
    let connecting: Promise<void>;
    act(() => {
      connecting = current.connectWithProvider(firstRaw, "first");
    });
    await waitFor(() => expect(current.signer).toBe(first.signer));
    const secondRaw = rawProvider();
    const second = provider(B);
    second.getBalance.mockResolvedValue(2_000_000_000_000_000_000n);
    await connect(secondRaw, second);
    await act(async () => {
      firstBalance.resolve(9_000_000_000_000_000_000n);
      await connecting;
    });
    expect(current.signer).toBe(second.signer);
    expect(current.address).toBe(B);
    expect(current.balance).toBe("2.0");
  });

  it("discards an initial connection whose first account response arrives after a newer connection", async () => {
    mount();
    const firstRaw = rawProvider();
    const accounts = deferred<string[]>();
    firstRaw.request.mockReturnValue(accounts.promise);
    let connecting: Promise<void>;
    act(() => {
      connecting = current.connectWithProvider(firstRaw, "first");
    });
    const secondRaw = rawProvider();
    const second = provider(B);
    await connect(secondRaw, second);
    await act(async () => {
      accounts.resolve([A]);
      await connecting;
    });
    expect(current.signer).toBe(second.signer);
    expect(current.rawProvider).toBe(secondRaw);
    expect(current.address).toBe(B);
    expect(mocks.provider).toHaveBeenCalledOnce();
  });

  it("invalidates chain-switch requests immediately and ignores an old response after reconnecting", async () => {
    mount();
    const { raw } = await connect();
    const switching = deferred<string[]>();
    raw.request.mockReturnValue(switching.promise);
    const before = getWalletConnectionGeneration();
    let switched: Promise<void>;
    act(() => {
      switched = current.switchChain(1);
    });
    expect(getWalletConnectionGeneration()).toBe(before + 1);
    expect(current.signer).toBeNull();
    expect(current.provider).toBeNull();
    const next = provider(B, 1030n);
    await connect(rawProvider(), next);
    await act(async () => {
      switching.resolve([]);
      await switched;
    });
    expect(current.chainId).toBe(1030);
    expect(current.signer).toBe(next.signer);
  });

  it("retires the previous signer while connecting and reconstructs it after a rejected connection", async () => {
    mount();
    const { raw, wrapped } = await connect();
    const nextRaw = rawProvider();
    const accounts = deferred<string[]>();
    nextRaw.request.mockReturnValue(accounts.promise);
    const rebuilt = provider();
    mocks.provider.mockReturnValueOnce(rebuilt);
    const before = getWalletConnectionGeneration();
    let connecting: Promise<void>;
    act(() => {
      connecting = current.connectWithProvider(nextRaw, "next");
    });
    expect(current.signer).toBeNull();
    expect(current.provider).toBeNull();
    expect(getWalletConnectionGeneration()).toBe(before + 1);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      accounts.reject(new Error("connection rejected"));
      await connecting;
    });
    expect(getWalletConnectionGeneration()).toBe(before + 2);
    expect(current.rawProvider).toBe(raw);
    expect(current.signer).toBe(rebuilt.signer);
    expect(current.signer).not.toBe(wrapped.signer);
    expect(current.provider).toBe(rebuilt);
    expect(current.isConnecting).toBe(false);
  });

  it.each(["switchChain", "switchOrAddChain"] as const)(
    "retires the signer while %s is pending and rebuilds after rejection",
    async (method) => {
      mount();
      const { raw, wrapped } = await connect();
      const switching = deferred<string[]>();
      raw.request.mockReturnValue(switching.promise);
      const rebuilt = provider();
      mocks.provider.mockReturnValueOnce(rebuilt);
      const before = getWalletConnectionGeneration();
      let pending: Promise<unknown>;
      act(() => {
        pending = current[method](1);
      });
      expect(current.signer).toBeNull();
      expect(current.provider).toBeNull();
      vi.spyOn(console, "error").mockImplementation(() => {});
      await act(async () => {
        switching.reject(new Error("switch rejected"));
        await pending;
      });
      expect(getWalletConnectionGeneration()).toBe(before + 2);
      expect(current.signer).toBe(rebuilt.signer);
      expect(current.signer).not.toBe(wrapped.signer);
      expect(current.chainId).toBe(31337);
    },
  );

  it("reconstructs a fresh signer when a chain switch succeeds without a provider event", async () => {
    mount();
    const { raw, wrapped } = await connect();
    const switched = provider(A, 1n);
    mocks.provider.mockReturnValueOnce(switched);
    await act(async () => {
      await current.switchChain(1);
    });
    expect(current.chainId).toBe(1);
    expect(current.provider).toBe(switched);
    expect(current.signer).toBe(switched.signer);
    expect(current.signer).not.toBe(wrapped.signer);
    expect(current.rawProvider).toBe(raw);
  });

  it.each(["accounts", "chain"])(
    "discards a late polling %s response from the old provider after reconnecting",
    async (phase) => {
      vi.useFakeTimers();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      mount();
      const oldRaw = rawProvider();
      oldRaw.on.mockImplementation(() => {
        throw new Error("events unavailable");
      });
      await connect(oldRaw, provider());
      const oldPoll = deferred<any>();
      oldRaw.request.mockImplementation(async ({ method }) => {
        if (method === (phase === "accounts" ? "eth_accounts" : "eth_chainId"))
          return oldPoll.promise;
        return [A];
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(oldRaw.request).toHaveBeenCalledWith({
        method: phase === "accounts" ? "eth_accounts" : "eth_chainId",
      });
      const nextRaw = rawProvider();
      const next = provider(B, 1030n);
      await connect(nextRaw, next);
      const generation = getWalletConnectionGeneration();
      await act(async () => oldPoll.resolve(phase === "accounts" ? [] : "0x1"));
      expect(getWalletConnectionGeneration()).toBe(generation);
      expect(current.rawProvider).toBe(nextRaw);
      expect(current.address).toBe(B);
      expect(current.signer).toBe(next.signer);
      expect(current.chainId).toBe(1030);
    },
  );
});

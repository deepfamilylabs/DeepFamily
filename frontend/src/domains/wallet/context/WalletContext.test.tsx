// @vitest-environment jsdom
import React from "react";
import { BrowserProvider } from "ethers";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalletProvider, useWallet } from "./WalletContext";
import {
  getWalletConnectionGeneration,
  subscribeWalletConnectionChange,
} from "../../../shared/clients/walletConnectionGeneration";

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
    request: vi.fn(async ({ method }: { method: string }): Promise<any> => method === "eth_chainId" ? "0x7a69" : [A]),
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
    vi.unstubAllGlobals();
  });

  function announce(provider: unknown, rdns = "io.metamask") {
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
      detail: { info: { rdns }, provider },
    }));
  }

  it("uses MetaMask's announced provider when a shared injection is controlled by another wallet", async () => {
    const shared = { ...rawProvider(), isMetaMask: true };
    const metamask = rawProvider();
    metamask.request.mockImplementation(async ({ method }) => {
      if (method === "eth_chainId") return "0x47";
      if (method === "eth_getBalance") return "0x0";
      if (method === "eth_sendTransaction") return `0x${"ab".repeat(32)}`;
      return [A];
    });
    const fluent = { ...rawProvider(), isFluent: true };
    vi.stubGlobal("ethereum", shared);
    vi.stubGlobal("fluent", fluent);
    mount();
    act(() => {
      announce(metamask);
      announce(metamask);
    });
    const wallets = current.getAvailableWallets();
    expect(wallets.map((wallet) => wallet.id)).toEqual(["metamask", "fluent"]);
    expect(wallets[0].provider).toBe(metamask);
    expect(wallets[1].provider).toBe(fluent);

    const browser = new BrowserProvider(metamask);
    mocks.provider.mockReturnValueOnce(browser);
    try {
      await act(async () => { await current.connectWithProvider(wallets[0].provider, wallets[0].id); });
      expect(current.rawProvider).toBe(metamask);
      expect(current.connectedWalletId).toBe("metamask");
      expect(mocks.provider).toHaveBeenCalledWith(metamask);
      const transaction = { from: A, to: B, value: "0x0" };
      await expect(current.provider!.send("eth_sendTransaction", [transaction])).resolves.toBe(`0x${"ab".repeat(32)}`);
      expect(metamask.request).toHaveBeenCalledWith({ method: "eth_sendTransaction", params: [transaction] });
      expect(shared.request).not.toHaveBeenCalled();
      expect(fluent.request).not.toHaveBeenCalled();
    } finally {
      browser.destroy();
    }
  });

  it("requests independent providers before restoring the saved MetaMask connection", async () => {
    const shared = { ...rawProvider(), isMetaMask: true };
    const metamask = rawProvider();
    vi.stubGlobal("ethereum", shared);
    localStorage.setItem("deepfamily_last_wallet_type", "metamask");
    mocks.provider.mockReturnValue(provider());
    const handleRequest = vi.fn(() => announce(metamask));
    window.addEventListener("eip6963:requestProvider", handleRequest);
    try {
      mount();
      await waitFor(() => expect(current.rawProvider).toBe(metamask));
      expect(handleRequest).toHaveBeenCalledOnce();
      expect(mocks.provider).toHaveBeenCalledWith(metamask);
      expect(shared.request).not.toHaveBeenCalled();
      expect(metamask.request).toHaveBeenCalledWith({ method: "eth_accounts" });
    } finally {
      window.removeEventListener("eip6963:requestProvider", handleRequest);
    }
  });

  it("discovers late announcements and Fluent without a shared ethereum injection", () => {
    vi.stubGlobal("ethereum", undefined);
    const fluent = { ...rawProvider(), isFluent: true };
    vi.stubGlobal("fluent", fluent);
    mount();
    expect(current.getAvailableWallets().map((wallet) => wallet.id)).toEqual(["fluent"]);
    const metamask = rawProvider();
    act(() => announce(metamask));
    expect(current.getAvailableWallets().find((wallet) => wallet.id === "metamask")?.provider).toBe(metamask);
    act(() => {
      announce({});
      announce({ ...rawProvider(), isMetaMask: true }, "org.otherwallet");
    });
    expect(current.getAvailableWallets()).toHaveLength(2);
  });

  it("explicitly renews MetaMask permission when reconnecting after a 4100 rejection", async () => {
    mount();
    const { raw } = await connect();
    raw.request.mockClear();
    const renewed = provider();
    mocks.provider.mockReturnValueOnce(renewed);
    await act(async () => {
      await current.connectWithProvider(raw, "metamask", { requestPermissions: true });
    });
    expect(raw.request.mock.calls).toEqual([
      [{ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] }],
      [{ method: "eth_requestAccounts" }],
    ]);
    expect(current.signer).toBe(renewed.signer);
    expect(current.rawProvider).toBe(raw);
    expect(raw.request.mock.calls.some(([request]) => request.method === "eth_sendTransaction")).toBe(false);
  });

  it("grants permission during a normal MetaMask connection and does not prompt again for writes", async () => {
    mount();
    const raw = rawProvider();
    mocks.provider.mockReturnValueOnce(provider());
    await act(async () => { await current.connectWithProvider(raw, "metamask"); });
    expect(raw.request).toHaveBeenCalledWith({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
    await current.ensureTransactionAuthorization(A, 31337);
    await current.ensureTransactionAuthorization(A, 31337);
    expect(raw.request.mock.calls.filter(([call]) => call.method === "wallet_requestPermissions")).toHaveLength(1);
    expect(raw.request.mock.calls.some(([call]) => call.method === "eth_sendTransaction")).toBe(false);
  });

  it("restores MetaMask silently and renews permission only on the first user-initiated write", async () => {
    const raw = { ...rawProvider(), isMetaMask: true };
    vi.stubGlobal("ethereum", raw);
    localStorage.setItem("deepfamily_last_wallet_type", "metamask");
    mocks.provider.mockReturnValue(provider());
    mount();
    await waitFor(() => expect(current.address).toBe(A));
    expect(raw.request.mock.calls.some(([call]) => call.method === "wallet_requestPermissions")).toBe(false);
    await current.ensureTransactionAuthorization(A, 31337);
    await current.ensureTransactionAuthorization(A, 31337);
    expect(raw.request.mock.calls.filter(([call]) => call.method === "wallet_requestPermissions")).toHaveLength(1);
  });

  it("keeps Fluent's ordinary connection and transaction preparation free of extra permission prompts", async () => {
    mount();
    const raw = rawProvider();
    mocks.provider.mockReturnValueOnce(provider());
    await act(async () => { await current.connectWithProvider(raw, "fluent"); });
    await current.ensureTransactionAuthorization(A, 31337);
    expect(raw.request.mock.calls.some(([call]) => call.method === "wallet_requestPermissions")).toBe(false);
  });

  it("stops transaction authorization if the connection is retired while the wallet prompt is open", async () => {
    const raw = { ...rawProvider(), isMetaMask: true };
    vi.stubGlobal("ethereum", raw);
    localStorage.setItem("deepfamily_last_wallet_type", "metamask");
    mocks.provider.mockReturnValue(provider());
    mount();
    await waitFor(() => expect(current.address).toBe(A));
    const pendingPermission = deferred<unknown>();
    raw.request.mockImplementation(async ({ method }) => {
      if (method === "wallet_requestPermissions") return pendingPermission.promise;
      return method === "eth_chainId" ? "0x7a69" : [A];
    });
    const preparing = current.ensureTransactionAuthorization(A, 31337);
    const stopped = expect(preparing).rejects.toMatchObject({ code: "CHAIN_WALLET_SCOPE_CHANGED" });
    await waitFor(() => expect(raw.request).toHaveBeenCalledWith({
      method: "wallet_requestPermissions", params: [{ eth_accounts: {} }],
    }));
    act(() => current.disconnect());
    pendingPermission.resolve([]);
    await stopped;
    expect(current.signer).toBeNull();
    expect(current.address).toBeNull();
  });

  it("stops a rejected permission renewal without requesting accounts or sending", async () => {
    mount();
    const { raw } = await connect();
    raw.request.mockReset().mockRejectedValue(Object.assign(new Error("Rejected"), { code: 4001 }));
    mocks.provider.mockReturnValueOnce(provider());
    vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      await current.connectWithProvider(raw, "metamask", { requestPermissions: true });
    });
    expect(raw.request).toHaveBeenCalledOnce();
    expect(raw.request).toHaveBeenCalledWith({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
    expect(current.isConnecting).toBe(false);
    expect(mocks.toast.warning).toHaveBeenCalledWith("Connection rejected by user");
  });

  it("does not continue a permission renewal after the user disconnects", async () => {
    mount();
    const { raw } = await connect();
    const permission = deferred<unknown>();
    raw.request.mockReset().mockReturnValue(permission.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = current.connectWithProvider(raw, "metamask", { requestPermissions: true });
    });
    act(() => current.disconnect());
    await act(async () => {
      permission.resolve([]);
      await pending;
    });
    expect(raw.request).toHaveBeenCalledOnce();
    expect(current.address).toBeNull();
    expect(current.signer).toBeNull();
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

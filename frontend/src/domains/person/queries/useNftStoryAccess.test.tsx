// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNftStoryAccess } from "./useNftStoryAccess";

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, () => void>();
  const on = vi.fn(async (filter: string, listener: () => void) => {
    listeners.set(filter, listener);
  });
  const off = vi.fn(async (filter: string) => {
    listeners.delete(filter);
  });
  return {
    config: { rpcUrl: "http://localhost:8545", contractAddress: "0xcontract", chainId: 31337 },
    wallet: {
      address: "0x00000000000000000000000000000000000000aa" as string | null,
      chainId: 31337,
    },
    main: {
      ownerOf: vi.fn(),
      archive: vi.fn(async () => "0xarchive"),
      on,
      off,
      filters: { Transfer: (_from: unknown, _to: unknown, token: string) => `transfer:${token}` },
    },
    archive: {
      storyState: vi.fn(),
      on,
      off,
      filters: { StorySealed: (token: string) => `sealed:${token}` },
    },
    provider: {},
    listeners,
  };
});
vi.mock("../../config", () => ({ useConfig: () => mocks.config }));
vi.mock("../../wallet", () => ({ useWallet: () => mocks.wallet }));
vi.mock("../../../shared/clients/providerRegistry", () => ({
  getReadonlyProvider: () => mocks.provider,
}));
vi.mock("../../../shared/clients/contractFactory", () => ({
  createDeepFamilyContract: () => mocks.main,
  createArchiveContract: () => mocks.archive,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.wallet.address = "0x00000000000000000000000000000000000000aa";
  mocks.wallet.chainId = 31337;
  mocks.config.chainId = 31337;
  mocks.main.ownerOf.mockReset().mockResolvedValue(mocks.wallet.address.toUpperCase());
  mocks.archive.storyState.mockReset().mockResolvedValue({ isSealed: false });
});
afterEach(cleanup);

describe("NFT story access", () => {
  it("waits for chain reads and grants an unsealed story only to its owner", async () => {
    const { result } = renderHook(() => useNftStoryAccess("7"));
    expect(result.current.canEdit).toBe(false);
    expect(result.current.checking).toBe(true);
    await waitFor(() => expect(result.current.canEdit).toBe(true));
    expect(mocks.main.ownerOf).toHaveBeenCalledWith("7");
    expect(mocks.archive.storyState).toHaveBeenCalledWith("7");
  });

  it.each(["disconnected", "other wallet", "wrong network", "sealed", "read failed"])(
    "denies editing: %s",
    async (condition) => {
      if (condition === "disconnected") mocks.wallet.address = null;
      if (condition === "other wallet") mocks.wallet.address = "0xbb";
      if (condition === "wrong network") mocks.wallet.chainId = 1;
      if (condition === "sealed") mocks.archive.storyState.mockResolvedValue({ isSealed: true });
      if (condition === "read failed")
        mocks.main.ownerOf.mockRejectedValue(new Error("RPC unavailable"));
      const { result } = renderHook(() => useNftStoryAccess("7"));
      await waitFor(() => expect(result.current.checking).toBe(false));
      expect(result.current.canEdit).toBe(false);
      expect(result.current.error).toBe(condition === "read failed");
    },
  );

  it("revokes access immediately on account changes and ignores the previous lookup", async () => {
    let resolveOwner!: (owner: string) => void;
    mocks.main.ownerOf.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOwner = resolve;
        }),
    );
    const { result, rerender } = renderHook(() => useNftStoryAccess("7"));
    mocks.wallet.address = "0xbb";
    rerender();
    await waitFor(() => expect(result.current.checking).toBe(false));
    await act(async () => {
      resolveOwner("0xbb");
    });
    expect(result.current.canEdit).toBe(false);
  });

  it("revokes access on token changes before resolving the next owner", async () => {
    const { result, rerender } = renderHook(({ tokenId }) => useNftStoryAccess(tokenId), {
      initialProps: { tokenId: "7" },
    });
    await waitFor(() => expect(result.current.canEdit).toBe(true));
    let resolveOwner!: (owner: string) => void;
    mocks.main.ownerOf.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOwner = resolve;
        }),
    );
    rerender({ tokenId: "8" });
    expect(result.current.canEdit).toBe(false);
    await act(async () => {
      resolveOwner("0xbb");
    });
    expect(result.current.canEdit).toBe(false);
  });

  it.each(["transfer:7", "sealed:7", "focus"])("rechecks access after %s", async (event) => {
    const { result } = renderHook(() => useNftStoryAccess("7"));
    await waitFor(() => expect(result.current.canEdit).toBe(true));
    await waitFor(() => expect(mocks.listeners.has("sealed:7")).toBe(true));
    if (event === "sealed:7") mocks.archive.storyState.mockResolvedValue({ isSealed: true });
    else mocks.main.ownerOf.mockResolvedValue("0xbb");
    act(() => {
      if (event === "focus") window.dispatchEvent(new Event("focus"));
      else mocks.listeners.get(event)!();
    });
    expect(result.current.canEdit).toBe(false);
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.canEdit).toBe(false);
  });

  it("does not query ownership without a valid token", () => {
    const { result } = renderHook(() => useNftStoryAccess(null));
    expect(result.current.canEdit).toBe(false);
    expect(mocks.main.ownerOf).not.toHaveBeenCalled();
  });
});

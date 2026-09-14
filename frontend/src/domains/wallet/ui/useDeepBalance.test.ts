// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDeepBalance } from "./useDeepBalance";

const mocks = vi.hoisted(() => ({
  config: { rpcUrl: "http://127.0.0.1:8545", chainId: 31337, tokenAddress: "0xToken" },
  token: {
    balanceOf: vi.fn(),
    decimals: vi.fn(),
    symbol: vi.fn(),
  },
  createDeepTokenContract: vi.fn(),
  getReadonlyProvider: vi.fn(),
}));

vi.mock("../../config", () => ({
  useConfig: () => mocks.config,
}));

vi.mock("../../../shared/clients/contractFactory", () => ({
  createDeepTokenContract: (...args: any[]) => mocks.createDeepTokenContract(...args),
}));

vi.mock("../../../shared/clients/providerRegistry", () => ({
  getReadonlyProvider: (...args: any[]) => mocks.getReadonlyProvider(...args),
}));

const ACCOUNT = "0x327c7a3bd1e4f2c9b8a6d5e4f3a2b1c0d9e8ab12";

describe("useDeepBalance", () => {
  beforeEach(() => {
    mocks.config = { rpcUrl: "http://127.0.0.1:8545", chainId: 31337, tokenAddress: "0xToken" };
    mocks.token.balanceOf.mockReset().mockResolvedValue(113777n * 10n ** 18n);
    mocks.token.decimals.mockReset().mockResolvedValue(18n);
    mocks.token.symbol.mockReset().mockResolvedValue("DEEP");
    mocks.createDeepTokenContract.mockReset().mockReturnValue(mocks.token);
    mocks.getReadonlyProvider.mockReset().mockReturnValue({ provider: true });
  });

  it("reads nothing until it is asked for", () => {
    const { result } = renderHook(() => useDeepBalance(ACCOUNT, false));

    expect(result.current).toEqual({ status: "idle" });
    expect(mocks.createDeepTokenContract).not.toHaveBeenCalled();
  });

  it("reads the balance from the configured chain's token once enabled", async () => {
    const { result } = renderHook(() => useDeepBalance(ACCOUNT, true));

    expect(result.current).toEqual({ status: "loading" });
    await waitFor(() =>
      expect(result.current).toEqual({ status: "ready", amount: "113,777.000", symbol: "DEEP" }),
    );
    expect(mocks.getReadonlyProvider).toHaveBeenCalledWith("http://127.0.0.1:8545", 31337);
    expect(mocks.createDeepTokenContract).toHaveBeenCalledWith("0xToken", { provider: true });
    expect(mocks.token.balanceOf).toHaveBeenCalledWith(ACCOUNT);
  });

  it("reads afresh every time it is enabled again", async () => {
    const { result, rerender } = renderHook(({ enabled }) => useDeepBalance(ACCOUNT, enabled), {
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ enabled: false });
    mocks.token.balanceOf.mockResolvedValue(2n * 10n ** 18n);
    rerender({ enabled: true });

    await waitFor(() =>
      expect(result.current).toEqual({ status: "ready", amount: "2.000", symbol: "DEEP" }),
    );
    expect(mocks.token.balanceOf).toHaveBeenCalledTimes(2);
  });

  it("says unavailable when the token is unknown or the read fails", async () => {
    mocks.config = { ...mocks.config, tokenAddress: "" };
    const { result, rerender } = renderHook(() => useDeepBalance(ACCOUNT, true));
    expect(result.current).toEqual({ status: "unavailable" });

    mocks.config = { ...mocks.config, tokenAddress: "0xToken" };
    mocks.token.balanceOf.mockRejectedValue(new Error("rpc down"));
    rerender();
    await waitFor(() => expect(result.current).toEqual({ status: "unavailable" }));
  });

  it("keeps the default symbol when the token does not name itself", async () => {
    mocks.token.symbol.mockRejectedValue(new Error("no symbol"));
    const { result } = renderHook(() => useDeepBalance(ACCOUNT, true));

    await waitFor(() =>
      expect(result.current).toEqual({ status: "ready", amount: "113,777.000", symbol: "DEEP" }),
    );
  });
});

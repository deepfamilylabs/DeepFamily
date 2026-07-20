// @vitest-environment jsdom
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, useConfig } from "./ConfigContext";

const mocks = vi.hoisted(() => ({
  env: {
    rpcUrl: "http://rpc.local",
    readerAddress: "0x0000000000000000000000000000000000000101",
    rootHash: "0x" + "a".repeat(64),
    rootVersionIndex: 1,
  },
  resolveModuleAddresses: vi.fn(),
}));

vi.mock("../../../shared/config", () => ({
  NETWORK_PRESETS: [{ chainId: 31337, rpcUrl: "http://rpc.local" }],
}));

vi.mock("../../../shared/config/env", () => ({
  getDefaultRpcUrl: () => mocks.env.rpcUrl,
  getDefaultReaderAddress: () => mocks.env.readerAddress,
  getDefaultRootHash: () => mocks.env.rootHash,
  getDefaultRootVersionIndex: () => mocks.env.rootVersionIndex,
}));

vi.mock("../services", () => ({
  resolveModuleAddresses: mocks.resolveModuleAddresses,
}));

const mainAddress = "0x0000000000000000000000000000000000000202";
const tokenAddress = "0x0000000000000000000000000000000000000404";

function wrapper({ children }: { children: React.ReactNode }) {
  return <ConfigProvider>{children}</ConfigProvider>;
}

describe("ConfigContext module address resolution", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.resolveModuleAddresses.mockReset();
    mocks.resolveModuleAddresses.mockImplementation(
      async ({ readerAddress }: { readerAddress: string }) => ({
        readerAddress,
        contractAddress: mainAddress,
        tokenAddress,
      }),
    );
  });

  it("treats the configured reader as the entrypoint and derives main/token", async () => {
    const { result } = renderHook(() => useConfig(), { wrapper });

    expect(result.current.readerAddress).toBe(mocks.env.readerAddress);
    expect(result.current.contractAddress).toBe("");

    await waitFor(() => expect(result.current.contractAddress).toBe(mainAddress));
    expect(result.current.tokenAddress).toBe(tokenAddress);
    expect(result.current.moduleResolutionError).toBeNull();
  });

  it("exposes resolver failures without keeping stale derived addresses", async () => {
    localStorage.setItem(
      "ft:config",
      JSON.stringify({
        rpcUrl: "http://rpc.local",
        chainId: 31337,
        readerAddress: mocks.env.readerAddress,
        contractAddress: mainAddress,
        tokenAddress,
        rootHash: mocks.env.rootHash,
        rootVersionIndex: 1,
      }),
    );
    mocks.resolveModuleAddresses.mockRejectedValue(new Error("bad module wiring"));

    const { result } = renderHook(() => useConfig(), { wrapper });

    await waitFor(() => expect(result.current.moduleResolutionError).toBe("bad module wiring"));
    expect(result.current.contractAddress).toBe("");
    expect(result.current.tokenAddress).toBe("");
  });

  it("clears derived addresses when the entry reader changes", async () => {
    const { result } = renderHook(() => useConfig(), { wrapper });
    await waitFor(() => expect(result.current.contractAddress).toBe(mainAddress));

    act(() => {
      result.current.update({
        readerAddress: "0x0000000000000000000000000000000000000505",
      });
    });

    expect(result.current.contractAddress).toBe("");
    expect(result.current.tokenAddress).toBe("");
  });
});

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
  resolveEntryReaderForChain: vi.fn(),
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
  resolveEntryReaderForChain: mocks.resolveEntryReaderForChain,
}));

const mainAddress = "0x0000000000000000000000000000000000000202";
const tokenAddress = "0x0000000000000000000000000000000000000404";
const staleAddress = "0x0000000000000000000000000000000000000909";

function wrapper({ children }: { children: React.ReactNode }) {
  return <ConfigProvider>{children}</ConfigProvider>;
}

function readStoredConfig(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem("ft:config") || "{}");
}

describe("ConfigContext module address resolution", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.resolveEntryReaderForChain.mockReset();
    mocks.resolveEntryReaderForChain.mockReturnValue(mocks.env.readerAddress);
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

  it("works the reader out from the chain instead of restoring a saved one", () => {
    // Written by a build that has since been redeployed: the address is still a
    // well-formed one, and on this chain it now belongs to a different contract.
    localStorage.setItem(
      "ft:config",
      JSON.stringify({
        rpcUrl: "http://rpc.local",
        chainId: 31337,
        readerAddress: staleAddress,
        rootHash: mocks.env.rootHash,
        rootVersionIndex: 1,
      }),
    );

    const { result } = renderHook(() => useConfig(), { wrapper });

    expect(mocks.resolveEntryReaderForChain).toHaveBeenCalledWith(31337, {
      envChainId: 31337,
      envReaderAddress: mocks.env.readerAddress,
    });
    expect(result.current.readerAddress).toBe(mocks.env.readerAddress);
  });

  it("leaves the reader empty when the build knows none for the chain", () => {
    mocks.resolveEntryReaderForChain.mockReturnValue("");

    const { result } = renderHook(() => useConfig(), { wrapper });

    expect(result.current.readerAddress).toBe("");
    expect(mocks.resolveModuleAddresses).not.toHaveBeenCalled();
  });

  it("saves the choices and none of the addresses worked out from them", async () => {
    const { result } = renderHook(() => useConfig(), { wrapper });
    await waitFor(() => expect(result.current.contractAddress).toBe(mainAddress));

    act(() => {
      result.current.update({ rootVersionIndex: 3 });
    });

    const stored = readStoredConfig();
    expect(stored).toEqual({
      rpcUrl: "http://rpc.local",
      chainId: 31337,
      rootHash: mocks.env.rootHash,
      rootVersionIndex: 3,
    });
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

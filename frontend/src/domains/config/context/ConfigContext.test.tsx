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
    stateReadMode: "rebuild" as "rebuild" | "chain",
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
  getShieldedStateReadMode: () => mocks.env.stateReadMode,
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
    mocks.env.stateReadMode = "rebuild";
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

  it("uses the default local rebuilding setting", () => {
    const { result } = renderHook(() => useConfig(), { wrapper });
    expect(result.current.stateReadMode).toBe("rebuild");
    expect(result.current.defaults.stateReadMode).toBe("rebuild");
  });

  it("shares the deployment's chain setting without persisting a browser preference", async () => {
    mocks.env.stateReadMode = "chain";
    const first = renderHook(() => [useConfig(), useConfig()], { wrapper });
    await waitFor(() => expect(first.result.current[0].contractAddress).toBe(mainAddress));
    act(() => first.result.current[0].update({ rootVersionIndex: 2 }));
    expect(first.result.current[1].stateReadMode).toBe("chain");
    expect(first.result.current[0].defaults.stateReadMode).toBe("chain");
    expect(readStoredConfig()).not.toHaveProperty("stateReadMode");
    first.unmount();

    const next = renderHook(() => useConfig(), { wrapper });
    expect(next.result.current.stateReadMode).toBe("chain");
  });

  it.each([undefined, null, "chain", "onchain", "invalid", 1, {}, []])(
    "ignores a saved read mode %j in favor of the deployment setting",
    (stateReadMode) => {
      localStorage.setItem("ft:config", JSON.stringify({ stateReadMode }));
      const { result } = renderHook(() => useConfig(), { wrapper });
      expect(result.current.stateReadMode).toBe("rebuild");
    },
  );

  it("uses chain mode even when an older build saved rebuild", () => {
    mocks.env.stateReadMode = "chain";
    localStorage.setItem("ft:config", JSON.stringify({ stateReadMode: "rebuild" }));
    const { result } = renderHook(() => useConfig(), { wrapper });
    expect(result.current.stateReadMode).toBe("chain");
  });

  it("keeps the deployment setting if an untyped caller tries to update the mode", () => {
    const { result } = renderHook(() => useConfig(), { wrapper });
    act(() => result.current.update({
      rootVersionIndex: 2,
      stateReadMode: "chain",
    } as Parameters<typeof result.current.update>[0]));
    expect(result.current.stateReadMode).toBe("rebuild");
    expect(result.current.rootVersionIndex).toBe(2);
    expect(readStoredConfig()).not.toHaveProperty("stateReadMode");
  });

  it("keeps the deployment setting through damaged storage, unavailable storage, and resets", async () => {
    mocks.env.stateReadMode = "chain";
    localStorage.setItem("ft:config", "{broken");
    const damaged = renderHook(() => useConfig(), { wrapper });
    expect(damaged.result.current.stateReadMode).toBe("chain");
    damaged.unmount();

    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    const unavailable = renderHook(() => useConfig(), { wrapper });
    expect(unavailable.result.current.stateReadMode).toBe("chain");
    unavailable.unmount();
    read.mockRestore();

    localStorage.setItem("ft:config", JSON.stringify({ stateReadMode: "chain" }));
    const chosen = renderHook(() => useConfig(), { wrapper });
    await waitFor(() => expect(chosen.result.current.contractAddress).toBe(mainAddress));
    act(() => chosen.result.current.reset());
    expect(chosen.result.current.stateReadMode).toBe("chain");
    chosen.unmount();
    localStorage.clear();
    const cleared = renderHook(() => useConfig(), { wrapper });
    expect(cleared.result.current.stateReadMode).toBe("chain");
  });
});

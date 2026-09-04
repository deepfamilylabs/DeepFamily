// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: {
    rpcUrl: "http://preset-1",
    chainId: 1,
    defaults: {
      chainId: 1,
      readerAddress: "0x" + "e".repeat(40),
    },
    update: vi.fn(),
  },
  env: {
    chainReaders: {} as Record<number, string>,
  },
  toast: {
    success: vi.fn(),
  },
  envFlags: {
    isDev: false,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../../context", () => ({
  useConfig: () => mocks.config,
}));

vi.mock("../../../../shared/ui", () => ({
  useToast: () => mocks.toast,
}));

vi.mock("../../../../shared/config", () => ({
  NETWORK_PRESETS: [
    { chainId: 1, rpcUrl: "http://preset-1", nameKey: "n.one", defaultName: "Preset One" },
    { chainId: 2, rpcUrl: "http://preset-2", nameKey: "n.two", defaultName: "Preset Two" },
  ],
}));

vi.mock("../../../../shared/config/env", () => ({
  isDevMode: () => mocks.envFlags.isDev,
  getChainEntryReaderAddress: (chainId: number) => mocks.env.chainReaders[chainId] ?? "",
}));

import { useRpcNetworkMenu } from "./useRpcNetworkMenu";

describe("useRpcNetworkMenu", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.config.rpcUrl = "http://preset-1";
    mocks.config.chainId = 1;
    mocks.config.defaults = { chainId: 1, readerAddress: "0x" + "e".repeat(40) };
    mocks.config.update.mockReset();
    mocks.toast.success.mockReset();
    mocks.envFlags.isDev = false;
    mocks.env.chainReaders = {};
  });

  it("marks the preset the saved rpcUrl belongs to", () => {
    mocks.config.rpcUrl = "http://preset-2";
    const { result } = renderHook(() => useRpcNetworkMenu());
    expect(result.current.selected).toBe(2);
  });

  it("falls back to custom when the saved rpcUrl matches no known network", () => {
    mocks.config.rpcUrl = "http://somewhere-else";
    const { result } = renderHook(() => useRpcNetworkMenu());
    expect(result.current.selected).toBe("custom");
  });

  it("applies a pick straight away, dropping the leaving chain's resolved addresses", () => {
    const { result } = renderHook(() => useRpcNetworkMenu());
    act(() => {
      result.current.select(2);
    });
    expect(mocks.config.update).toHaveBeenCalledWith({
      rpcUrl: "http://preset-2",
      chainId: 2,
      contractAddress: "",
      tokenAddress: "",
    });
  });

  it("carries the reader that last resolved on the chain being switched to", () => {
    const remembered = "0x" + "a".repeat(40);
    localStorage.setItem("ft:readerByChain", JSON.stringify({ "2": remembered }));

    const { result } = renderHook(() => useRpcNetworkMenu());
    act(() => {
      result.current.select(2);
    });
    expect(mocks.config.update).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 2, readerAddress: remembered }),
    );
  });

  it("falls back to the address the build was given for that chain", () => {
    mocks.env.chainReaders = { 2: "0x" + "b".repeat(40) };

    const { result } = renderHook(() => useRpcNetworkMenu());
    act(() => {
      result.current.select(2);
    });
    expect(mocks.config.update).toHaveBeenCalledWith(
      expect.objectContaining({ readerAddress: "0x" + "b".repeat(40) }),
    );
  });

  it("prefers what actually resolved over what the build was given", () => {
    const remembered = "0x" + "a".repeat(40);
    localStorage.setItem("ft:readerByChain", JSON.stringify({ "2": remembered }));
    mocks.env.chainReaders = { 2: "0x" + "b".repeat(40) };

    const { result } = renderHook(() => useRpcNetworkMenu());
    act(() => {
      result.current.select(2);
    });
    expect(mocks.config.update).toHaveBeenCalledWith(
      expect.objectContaining({ readerAddress: remembered }),
    );
  });

  it("treats the unsuffixed env reader as belonging only to the env's own chain", () => {
    mocks.config.rpcUrl = "http://preset-2";
    mocks.config.defaults = { chainId: 1, readerAddress: "0x" + "e".repeat(40) };

    const { result } = renderHook(() => useRpcNetworkMenu());
    act(() => {
      result.current.select(1);
    });
    expect(mocks.config.update).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 1, readerAddress: "0x" + "e".repeat(40) }),
    );
  });

  it("leaves the reader alone when nothing is known about the target chain", () => {
    const { result } = renderHook(() => useRpcNetworkMenu());
    act(() => {
      result.current.select(2);
    });
    expect(mocks.config.update.mock.calls[0][0]).not.toHaveProperty("readerAddress");
  });

  it("ignores a pick of the network already in use", () => {
    const { result } = renderHook(() => useRpcNetworkMenu());
    act(() => {
      result.current.select(1);
    });
    expect(mocks.config.update).not.toHaveBeenCalled();
  });

  it("rejects a custom network whose chainId collides with a preset", () => {
    const { result } = renderHook(() => useRpcNetworkMenu());
    act(() => {
      result.current.addForm.setName("Local");
      result.current.addForm.setChainId(1);
      result.current.addForm.setRpc("http://my-local");
      result.current.addForm.setReader("0x" + "9".repeat(40));
    });
    act(() => {
      result.current.addForm.submit();
    });
    expect(result.current.addForm.error).toMatch(/Chain ID/);
    expect(localStorage.getItem("ft:customNetworks")).toBeNull();
    expect(mocks.config.update).not.toHaveBeenCalled();
  });

  it("rejects a custom network reusing a preset's RPC", () => {
    const { result } = renderHook(() => useRpcNetworkMenu());
    act(() => {
      result.current.addForm.setName("Copy");
      result.current.addForm.setChainId(31338);
      result.current.addForm.setRpc("http://preset-2");
      result.current.addForm.setReader("0x" + "9".repeat(40));
    });
    act(() => {
      result.current.addForm.submit();
    });
    expect(result.current.addForm.error).toMatch(/RPC/);
    expect(localStorage.getItem("ft:customNetworks")).toBeNull();
  });

  it("persists a valid custom network and switches to it in one step", () => {
    const { result } = renderHook(() => useRpcNetworkMenu());
    act(() => {
      result.current.addForm.toggle();
      result.current.addForm.setName("My Local");
      result.current.addForm.setChainId(31338);
      result.current.addForm.setRpc("http://my-local");
      result.current.addForm.setReader("0x" + "9".repeat(40));
    });
    act(() => {
      result.current.addForm.submit();
    });

    expect(JSON.parse(localStorage.getItem("ft:customNetworks") || "[]")).toEqual([
      {
        chainId: 31338,
        name: "My Local",
        rpcUrl: "http://my-local",
        readerAddress: "0x" + "9".repeat(40),
      },
    ]);
    // The declared address rides along with the switch: nothing else on this
    // build knows the entry contract for a chain it has never heard of.
    expect(mocks.config.update).toHaveBeenCalledWith({
      rpcUrl: "http://my-local",
      chainId: 31338,
      contractAddress: "",
      tokenAddress: "",
      readerAddress: "0x" + "9".repeat(40),
    });
    expect(result.current.custom).toEqual([
      {
        chainId: 31338,
        name: "My Local",
        rpcUrl: "http://my-local",
        readerAddress: "0x" + "9".repeat(40),
        isCustom: true,
      },
    ]);
    // The form empties and closes behind a successful add.
    expect(result.current.addForm.isOpen).toBe(false);
    expect(result.current.addForm.name).toBe("");
    expect(result.current.addForm.reader).toBe("");
    expect(mocks.toast.success).toHaveBeenCalledWith("Custom network added");
  });

  it("refuses a custom network with no contract address, which would read nothing", () => {
    const { result } = renderHook(() => useRpcNetworkMenu());
    act(() => {
      result.current.addForm.setName("My Local");
      result.current.addForm.setChainId(31338);
      result.current.addForm.setRpc("http://my-local");
    });
    act(() => {
      result.current.addForm.submit();
    });

    expect(result.current.addForm.error).toMatch(/contract address/);
    expect(localStorage.getItem("ft:customNetworks")).toBeNull();
    expect(mocks.config.update).not.toHaveBeenCalled();
  });

  it("prefers a custom network's declared address over one that resolved before", () => {
    // Re-declaring is how a custom network's contract gets corrected; the
    // address that resolved under the old one must not win.
    localStorage.setItem(
      "ft:customNetworks",
      JSON.stringify([
        {
          chainId: 31338,
          name: "My Local",
          rpcUrl: "http://my-local",
          readerAddress: "0x" + "9".repeat(40),
        },
      ]),
    );
    localStorage.setItem("ft:readerByChain", JSON.stringify({ "31338": "0x" + "a".repeat(40) }));

    const { result } = renderHook(() => useRpcNetworkMenu());
    act(() => {
      result.current.select(31338);
    });

    expect(mocks.config.update).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 31338, readerAddress: "0x" + "9".repeat(40) }),
    );
  });

  it("warns about CSP only outside dev, where a stray origin is actually blocked", () => {
    const { result, rerender } = renderHook(() => useRpcNetworkMenu());
    expect(result.current.addForm.showCspHint).toBe(true);

    mocks.envFlags.isDev = true;
    rerender();
    expect(result.current.addForm.showCspHint).toBe(false);
  });
});

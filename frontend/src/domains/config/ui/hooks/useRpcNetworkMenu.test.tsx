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

const CUSTOM_READER = "0x" + "9".repeat(40);

function saveCustom(entries: unknown[]) {
  localStorage.setItem("ft:customNetworks", JSON.stringify(entries));
}

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

  it("applies a pick straight away, dropping everything tied to the chain being left", () => {
    const { result } = renderHook(() => useRpcNetworkMenu());
    act(() => {
      result.current.select(2);
    });
    expect(mocks.config.update).toHaveBeenCalledWith({
      rpcUrl: "http://preset-2",
      chainId: 2,
      contractAddress: "",
      tokenAddress: "",
      readerAddress: "",
      rootHash: "",
      rootVersionIndex: 1,
    });
  });

  it("takes the reader from the address book the build was given", () => {
    mocks.env.chainReaders = { 2: "0x" + "b".repeat(40) };

    const { result } = renderHook(() => useRpcNetworkMenu());
    act(() => {
      result.current.select(2);
    });
    expect(mocks.config.update).toHaveBeenCalledWith(
      expect.objectContaining({ readerAddress: "0x" + "b".repeat(40) }),
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

  it("clears the reader when the build knows none for the target chain", () => {
    // Leaving the previous chain's address in place is what turns a network
    // nobody configured into one whose contract appears to have gone missing.
    const { result } = renderHook(() => useRpcNetworkMenu());
    act(() => {
      result.current.select(2);
    });
    expect(mocks.config.update.mock.calls[0][0]).toMatchObject({ readerAddress: "" });
  });

  it("drops the root, which named a record on the chain being left", () => {
    mocks.env.chainReaders = { 2: "0x" + "b".repeat(40) };

    const { result } = renderHook(() => useRpcNetworkMenu());
    act(() => {
      result.current.select(2);
    });
    expect(mocks.config.update).toHaveBeenCalledWith(
      expect.objectContaining({ rootHash: "", rootVersionIndex: 1 }),
    );
  });

  it("reports which networks can actually be read through", () => {
    mocks.env.chainReaders = { 2: "0x" + "b".repeat(40) };
    saveCustom([
      { chainId: 31338, name: "My Local", rpcUrl: "http://my-local", readerAddress: CUSTOM_READER },
    ]);

    const { result } = renderHook(() => useRpcNetworkMenu());

    expect(result.current.isConfigured(1)).toBe(true); // the env's own chain
    expect(result.current.isConfigured(2)).toBe(true); // the address book
    expect(result.current.isConfigured(31338)).toBe(true); // its own declaration
    expect(result.current.isConfigured(999)).toBe(false);
    expect(result.current.readerFor(999)).toBe("");
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
      result.current.addForm.setReader(CUSTOM_READER);
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
      result.current.addForm.setReader(CUSTOM_READER);
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
      result.current.addForm.setReader(CUSTOM_READER);
    });
    act(() => {
      result.current.addForm.submit();
    });

    expect(JSON.parse(localStorage.getItem("ft:customNetworks") || "[]")).toEqual([
      {
        chainId: 31338,
        name: "My Local",
        rpcUrl: "http://my-local",
        readerAddress: CUSTOM_READER,
      },
    ]);
    // The declared address rides along with the switch: nothing else on this
    // build knows the entry contract for a chain it has never heard of.
    expect(mocks.config.update).toHaveBeenCalledWith({
      rpcUrl: "http://my-local",
      chainId: 31338,
      contractAddress: "",
      tokenAddress: "",
      readerAddress: CUSTOM_READER,
      rootHash: "",
      rootVersionIndex: 1,
    });
    expect(result.current.custom).toEqual([
      {
        chainId: 31338,
        name: "My Local",
        rpcUrl: "http://my-local",
        readerAddress: CUSTOM_READER,
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

  it("prefers a custom network's own declaration over the build's address book", () => {
    saveCustom([
      { chainId: 31338, name: "My Local", rpcUrl: "http://my-local", readerAddress: CUSTOM_READER },
    ]);
    mocks.env.chainReaders = { 31338: "0x" + "a".repeat(40) };

    const { result } = renderHook(() => useRpcNetworkMenu());
    act(() => {
      result.current.select(31338);
    });

    expect(mocks.config.update).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 31338, readerAddress: CUSTOM_READER }),
    );
  });

  it("forgets a custom network without disturbing the connection in use", () => {
    saveCustom([
      { chainId: 31338, name: "My Local", rpcUrl: "http://my-local", readerAddress: CUSTOM_READER },
      { chainId: 31339, name: "Other", rpcUrl: "http://other", readerAddress: CUSTOM_READER },
    ]);

    const { result } = renderHook(() => useRpcNetworkMenu());
    act(() => {
      result.current.remove(31338);
    });

    expect(result.current.custom.map((n) => n.chainId)).toEqual([31339]);
    expect(JSON.parse(localStorage.getItem("ft:customNetworks") || "[]")).toEqual([
      { chainId: 31339, name: "Other", rpcUrl: "http://other", readerAddress: CUSTOM_READER },
    ]);
    expect(mocks.config.update).not.toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledWith("Custom network removed");
  });

  it("says nothing when asked to forget a network it does not have", () => {
    const { result } = renderHook(() => useRpcNetworkMenu());
    act(() => {
      result.current.remove(4242);
    });
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("warns about CSP only outside dev, where a stray origin is actually blocked", () => {
    const { result, rerender } = renderHook(() => useRpcNetworkMenu());
    expect(result.current.addForm.showCspHint).toBe(true);

    mocks.envFlags.isDev = true;
    rerender();
    expect(result.current.addForm.showCspHint).toBe(false);
  });
});

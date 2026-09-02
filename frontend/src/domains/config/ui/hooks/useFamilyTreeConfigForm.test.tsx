// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: {
    rpcUrl: "http://rpc.local",
    chainId: 31337,
    contractAddress: "0x" + "a".repeat(40),
    readerAddress: "0x" + "1".repeat(40),
    tokenAddress: "0x" + "3".repeat(40),
    rootHash: "0x" + "b".repeat(64),
    rootVersionIndex: 1,
    rootHistory: ["0x" + "c".repeat(64)],
    update: vi.fn(),
    removeRootFromHistory: vi.fn(),
    clearRootHistory: vi.fn(),
    defaults: {
      rpcUrl: "http://default-rpc",
      chainId: 1,
      contractAddress: "0x" + "d".repeat(40),
      readerAddress: "0x" + "4".repeat(40),
      tokenAddress: "",
      rootHash: "0x" + "e".repeat(64),
      rootVersionIndex: 7,
    },
  },
  viz: {
    traversal: "dfs" as "dfs" | "bfs",
    setTraversal: vi.fn(),
    childrenMode: "union" as "union" | "strict",
    setChildrenMode: vi.fn(),
    strictIncludeUnversionedChildren: false,
    setStrictIncludeUnversionedChildren: vi.fn(),
    deduplicateChildren: false,
    setDeduplicateChildren: vi.fn(),
    trustedSourceFilterEnabled: true,
    setTrustedSourceFilterEnabled: vi.fn(),
  },
  treeMutations: {
    clearAllCaches: vi.fn(),
  },
  toast: {
    success: vi.fn(),
  },
  versionLookup: {
    personHash: null as string | null,
    status: "idle" as "idle" | "loading" | "ready" | "error",
    versions: [] as {
      versionIndex: number;
      endorsementCount: number;
      tokenId: number;
      addedBy: string;
      timestamp: number;
    }[],
    totalVersions: 0,
  },
  envFlags: {
    isDev: false,
    showChildren: true,
    showDedup: true,
    showTrusted: true,
    localizedRoot: "" as string,
    localizedVersion: 0,
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

vi.mock("../../../tree", () => ({
  useTreeMutations: () => mocks.treeMutations,
  useVizOptions: () => mocks.viz,
}));

vi.mock("../../../../shared/ui", () => ({
  useToast: () => mocks.toast,
}));

vi.mock("../../../transactions/hooks/usePersonVersionOptions", () => ({
  usePersonVersionOptions: () => mocks.versionLookup,
}));

vi.mock("../../../../shared/config", () => ({
  NETWORK_PRESETS: [
    { chainId: 1, rpcUrl: "http://preset-1", nameKey: "n.one", defaultName: "Preset One" },
    { chainId: 2, rpcUrl: "http://preset-2", nameKey: "n.two", defaultName: "Preset Two" },
  ],
}));

vi.mock("../../../../shared/config/env", () => ({
  isDevMode: () => mocks.envFlags.isDev,
  shouldShowDeduplicateToggle: () => mocks.envFlags.showDedup,
  shouldShowNodeModeToggle: () => mocks.envFlags.showChildren,
  shouldShowTrustedSourceFilterToggle: () => mocks.envFlags.showTrusted,
  getLocalizedRootHash: () => mocks.envFlags.localizedRoot,
  getLocalizedRootVersionIndex: () => mocks.envFlags.localizedVersion,
}));

import { useFamilyTreeConfigForm } from "./useFamilyTreeConfigForm";

describe("useFamilyTreeConfigForm", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.config.update.mockReset();
    mocks.config.removeRootFromHistory.mockReset();
    mocks.config.clearRootHistory.mockReset();
    mocks.toast.success.mockReset();
    mocks.viz.setTrustedSourceFilterEnabled.mockReset();
    mocks.viz.trustedSourceFilterEnabled = true;
    mocks.envFlags.showTrusted = true;
    mocks.envFlags.localizedRoot = "";
    mocks.envFlags.localizedVersion = 0;
    mocks.versionLookup = { personHash: null, status: "idle", versions: [], totalVersions: 0 };
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("keeps the saved version index when the lookup resolves for the saved root", () => {
    mocks.versionLookup = {
      personHash: mocks.config.rootHash,
      status: "ready",
      versions: [
        { versionIndex: 3, endorsementCount: 9, tokenId: 0, addedBy: "0x1", timestamp: 1 },
      ],
      totalVersions: 1,
    };
    const { result } = renderHook(() => useFamilyTreeConfigForm());
    expect(result.current.version.value).toBe(mocks.config.rootVersionIndex);
  });

  it("preselects the best version once a newly typed hash resolves", () => {
    const nextHash = "0x" + "f".repeat(64);
    const { result, rerender } = renderHook(() => useFamilyTreeConfigForm());

    act(() => {
      result.current.root.onChange(nextHash);
    });
    mocks.versionLookup = {
      personHash: nextHash,
      status: "ready",
      versions: [
        { versionIndex: 1, endorsementCount: 2, tokenId: 0, addedBy: "0x1", timestamp: 1 },
        { versionIndex: 4, endorsementCount: 8, tokenId: 0, addedBy: "0x2", timestamp: 2 },
      ],
      totalVersions: 2,
    };
    act(() => {
      rerender();
    });

    expect(result.current.version.value).toBe(4);

    // A hand-picked index survives a fresh lookup result for the same hash.
    act(() => {
      result.current.version.onChange(1);
    });
    mocks.versionLookup = { ...mocks.versionLookup, versions: [...mocks.versionLookup.versions] };
    act(() => {
      rerender();
    });
    expect(result.current.version.value).toBe(1);
  });

  it("drops the version when the root hash is cleared, and blocks the save", () => {
    const { result } = renderHook(() => useFamilyTreeConfigForm());

    act(() => {
      result.current.root.onChange("");
    });

    // 0 renders the picker's placeholder instead of a stale "Version 1".
    expect(result.current.version.value).toBe(0);

    act(() => {
      result.current.actions.save();
    });
    expect(mocks.config.update).not.toHaveBeenCalled();
  });

  it("seeds local form values from config and reports no diff initially", () => {
    const { result } = renderHook(() => useFamilyTreeConfigForm());
    expect(result.current.network.rpcUrl).toBe(mocks.config.rpcUrl);
    expect(result.current.contract.value).toBe(mocks.config.readerAddress);
    expect(result.current.root.value).toBe(mocks.config.rootHash);
    expect(result.current.version.value).toBe(mocks.config.rootVersionIndex);
    expect(result.current.actions.hasDiff).toBe(false);
  });

  it("exposes trusted source filter display state from viz options", () => {
    mocks.viz.trustedSourceFilterEnabled = false;
    mocks.envFlags.showTrusted = false;
    const { result } = renderHook(() => useFamilyTreeConfigForm());
    expect(result.current.showTrustedSourceFilterToggle).toBe(false);
    expect(result.current.trustedSourceFilter.value).toBe(false);

    act(() => {
      result.current.trustedSourceFilter.onChange(true);
    });
    expect(mocks.viz.setTrustedSourceFilterEnabled).toHaveBeenCalledWith(true);
  });

  it("resolves preset selection by current rpcUrl", () => {
    mocks.config.rpcUrl = "http://preset-2";
    const { result } = renderHook(() => useFamilyTreeConfigForm());
    expect(result.current.network.selected).toBe(2);
    mocks.config.rpcUrl = "http://rpc.local";
  });

  it("save() forwards local form to config.update only when validation passes", () => {
    const { result } = renderHook(() => useFamilyTreeConfigForm());
    act(() => {
      result.current.contract.onChange("not-an-address");
    });
    act(() => {
      result.current.actions.save();
    });
    expect(mocks.config.update).not.toHaveBeenCalled();

    act(() => {
      result.current.contract.onChange("0x" + "f".repeat(40));
    });
    act(() => {
      result.current.actions.save();
    });
    expect(mocks.config.update).toHaveBeenCalledWith({
      rpcUrl: mocks.config.rpcUrl,
      chainId: mocks.config.chainId,
      readerAddress: "0x" + "f".repeat(40),
      contractAddress: "",
      tokenAddress: "",
      rootHash: mocks.config.rootHash,
      rootVersionIndex: mocks.config.rootVersionIndex,
    });
  });

  it("reset() restores defaults and falls back when no localized root is configured", () => {
    const { result } = renderHook(() => useFamilyTreeConfigForm());
    act(() => {
      result.current.actions.reset();
    });
    expect(result.current.network.rpcUrl).toBe(mocks.config.defaults.rpcUrl);
    expect(result.current.contract.value).toBe(mocks.config.defaults.readerAddress);
    expect(result.current.root.value).toBe(mocks.config.defaults.rootHash);
    expect(result.current.version.value).toBe(mocks.config.defaults.rootVersionIndex);
  });

  it("reset() prefers localized root when env provides a valid override", () => {
    mocks.envFlags.localizedRoot = "0x" + "9".repeat(64);
    mocks.envFlags.localizedVersion = 42;
    const { result } = renderHook(() => useFamilyTreeConfigForm());
    act(() => {
      result.current.actions.reset();
    });
    expect(result.current.root.value).toBe("0x" + "9".repeat(64));
    expect(result.current.version.value).toBe(42);
  });

  it("addCustomNetwork rejects chainId conflicts with presets", () => {
    const { result } = renderHook(() => useFamilyTreeConfigForm());
    act(() => {
      result.current.network.onChange("custom");
    });
    act(() => {
      result.current.customForm.setName("Local");
      result.current.customForm.setChainId(1);
      result.current.customForm.setRpc("http://my-local");
    });
    act(() => {
      result.current.customForm.submit();
    });
    expect(result.current.customForm.error).toMatch(/Chain ID/);
    expect(localStorage.getItem("ft:customNetworks")).toBeNull();
  });

  it("addCustomNetwork persists a valid network and selects it", () => {
    const { result } = renderHook(() => useFamilyTreeConfigForm());
    act(() => {
      result.current.network.onChange("custom");
    });
    act(() => {
      result.current.customForm.setName("My Local");
      result.current.customForm.setChainId(31338);
      result.current.customForm.setRpc("http://my-local");
    });
    act(() => {
      result.current.customForm.submit();
    });
    expect(result.current.network.selected).toBe(31338);
    expect(result.current.network.rpcUrl).toBe("http://my-local");
    expect(result.current.network.chainId).toBe(31338);
    expect(JSON.parse(localStorage.getItem("ft:customNetworks") || "[]")).toEqual([
      { chainId: 31338, name: "My Local", rpcUrl: "http://my-local" },
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Custom network added");
  });

  it("history selectors push hash into the root field", () => {
    const { result } = renderHook(() => useFamilyTreeConfigForm());
    expect(result.current.history.items).toEqual(mocks.config.rootHistory);
    act(() => {
      result.current.history.onSelect("0x" + "1".repeat(64));
    });
    expect(result.current.root.value).toBe("0x" + "1".repeat(64));
  });
});

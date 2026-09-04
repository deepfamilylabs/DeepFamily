// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: {
    rpcUrl: "http://rpc.local",
    chainId: 31337,
    contractAddress: "0x" + "a".repeat(40),
    moduleResolutionError: null as string | null,
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

vi.mock("../../../transactions/hooks/usePersonVersionOptions", () => ({
  usePersonVersionOptions: () => mocks.versionLookup,
}));

vi.mock("./useNetworkName", () => ({
  useNetworkName: () => "Localhost",
}));

vi.mock("../../../../shared/config/env", () => ({
  shouldShowDeduplicateToggle: () => mocks.envFlags.showDedup,
  shouldShowNodeModeToggle: () => mocks.envFlags.showChildren,
  shouldShowTrustedSourceFilterToggle: () => mocks.envFlags.showTrusted,
  getLocalizedRootHash: () => mocks.envFlags.localizedRoot,
  getLocalizedRootVersionIndex: () => mocks.envFlags.localizedVersion,
}));

import { useFamilyTreeConfigForm } from "./useFamilyTreeConfigForm";

// Network selection moved out to useRpcNetworkMenu — this form now stages only
// the reader address, root hash and version.
describe("useFamilyTreeConfigForm", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.config.contractAddress = "0x" + "a".repeat(40);
    mocks.config.moduleResolutionError = null;
    mocks.config.readerAddress = "0x" + "1".repeat(40);
    mocks.config.update.mockReset();
    mocks.config.removeRootFromHistory.mockReset();
    mocks.config.clearRootHistory.mockReset();
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

  it("save() sends only the root, leaving the connection alone", () => {
    const { result } = renderHook(() => useFamilyTreeConfigForm());
    act(() => {
      result.current.root.onChange("not-a-hash");
    });
    act(() => {
      result.current.actions.save();
    });
    expect(mocks.config.update).not.toHaveBeenCalled();

    act(() => {
      result.current.root.onChange("0x" + "f".repeat(64));
    });
    // Clearing the hash on the way cleared the index with it; the picker is how
    // it comes back.
    act(() => {
      result.current.version.onChange(2);
    });
    act(() => {
      result.current.actions.save();
    });
    expect(mocks.config.update).toHaveBeenCalledWith({
      rootHash: "0x" + "f".repeat(64),
      rootVersionIndex: 2,
    });
  });

  it("reset() restores defaults and falls back when no localized root is configured", () => {
    const { result } = renderHook(() => useFamilyTreeConfigForm());
    act(() => {
      result.current.actions.reset();
    });
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

  it("lets the empty-hash note through, however the hash was entered", () => {
    // Typed over a selection the hash goes invalid on the way, which clears the
    // version index and used to fill the field's one message slot with "select a
    // version" — burying the note that explains why there is nothing to select.
    // Pasted whole it never goes invalid. Both have to end up saying the same.
    for (const entry of [["", "0x" + "c".repeat(64)], ["0x" + "c".repeat(64)]] as string[][]) {
      const { result, rerender, unmount } = renderHook(() => useFamilyTreeConfigForm());
      entry.forEach((next) => act(() => result.current.root.onChange(next)));

      mocks.versionLookup = {
        personHash: entry[entry.length - 1],
        status: "ready",
        versions: [],
        totalVersions: 0,
      };
      rerender();

      expect(result.current.root.presence).toBe("absent");
      expect(result.current.version.rootAbsent).toBe(true);
      expect(result.current.version.error).toBeUndefined();
      unmount();
    }
  });

  it("keeps asking for a version when the hash does carry some", () => {
    const { result, rerender } = renderHook(() => useFamilyTreeConfigForm());
    act(() => {
      result.current.root.onChange("");
    });
    act(() => {
      result.current.root.onChange("0x" + "c".repeat(64));
    });

    mocks.versionLookup = {
      personHash: "0x" + "c".repeat(64),
      status: "ready",
      versions: [{ versionIndex: 2, endorsementCount: 0, tokenId: 0, addedBy: "", timestamp: 0 }],
      totalVersions: 2,
    };
    rerender();

    expect(result.current.root.presence).toBe("present");
    expect(result.current.version.rootAbsent).toBe(false);
  });

  it("does not call a hash absent on an answer that was about a different one", () => {
    const { result, rerender } = renderHook(() => useFamilyTreeConfigForm());
    act(() => {
      result.current.root.onChange("0x" + "c".repeat(64));
    });

    // The lookup still describes the hash that was there before.
    mocks.versionLookup = {
      personHash: "0x" + "d".repeat(64),
      status: "ready",
      versions: [],
      totalVersions: 0,
    };
    rerender();

    // Still waiting on an answer for what is actually in the field.
    expect(result.current.root.presence).toBe("checking");
    expect(result.current.version.rootAbsent).toBe(false);
  });

  it("does not call a hash absent when the reader is the one at fault", () => {
    mocks.config.contractAddress = "";
    mocks.config.moduleResolutionError = "bad module wiring";
    const { result, rerender } = renderHook(() => useFamilyTreeConfigForm());
    act(() => {
      result.current.root.onChange("0x" + "c".repeat(64));
    });

    // A dead reader fails the lookup; it never reaches "ready".
    mocks.versionLookup = {
      personHash: "0x" + "c".repeat(64),
      status: "error",
      versions: [],
      totalVersions: 0,
    };
    rerender();

    expect(result.current.root.presence).toBe("idle");
    expect(result.current.version.rootAbsent).toBe(false);
    expect(result.current.version.readerBlocked).toBe(true);
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

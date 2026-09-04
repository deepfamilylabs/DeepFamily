// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chainId: 1 as number,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, vars?: Record<string, unknown>) => {
      const text = fallback ?? key;
      return vars ? text.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name] ?? "")) : text;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("../../context", () => ({
  useConfig: () => ({ chainId: mocks.chainId }),
}));

vi.mock("../../../../shared/config", () => ({
  NETWORK_PRESETS: [
    { chainId: 1, rpcUrl: "http://preset-1", nameKey: "n.one", defaultName: "Preset One" },
  ],
}));

import { useNetworkName } from "./useNetworkName";

describe("useNetworkName", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.chainId = 1;
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("uses the preset's translated name", () => {
    const { result } = renderHook(() => useNetworkName());
    expect(result.current).toBe("Preset One");
  });

  it("uses a custom network's own name, which nothing else knows", () => {
    localStorage.setItem(
      "ft:customNetworks",
      JSON.stringify([{ chainId: 31338, name: "My Local", rpcUrl: "http://my-local" }]),
    );
    mocks.chainId = 31338;

    const { result } = renderHook(() => useNetworkName());
    expect(result.current).toBe("My Local");
  });

  it("falls back to the chain number when that is the only name available", () => {
    mocks.chainId = 4242;
    const { result } = renderHook(() => useNetworkName());
    expect(result.current).toBe("chain 4242");
  });

  it("does not pass off a missing chain id as chain 0", () => {
    mocks.chainId = 0;
    const { result } = renderHook(() => useNetworkName());
    expect(result.current).toBe("Unknown network");
  });
});

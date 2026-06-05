// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    showTrustedSourceFilterToggle: true,
  },
}));

vi.mock("../../../shared/config/env", () => ({
  shouldShowTrustedSourceFilterToggle: () => mocks.env.showTrustedSourceFilterToggle,
}));

import { useVizOptions, VizOptionsProvider } from "./VizOptionsContext";

function wrapper({ children }: { children: ReactNode }) {
  return <VizOptionsProvider>{children}</VizOptionsProvider>;
}

describe("VizOptionsContext", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.env.showTrustedSourceFilterToggle = true;
  });

  it("defaults trusted source filtering on and persists user changes", () => {
    const { result } = renderHook(() => useVizOptions(), { wrapper });

    expect(result.current.trustedSourceFilterEnabled).toBe(true);

    act(() => {
      result.current.setTrustedSourceFilterEnabled(false);
    });

    expect(result.current.trustedSourceFilterEnabled).toBe(false);
    expect(localStorage.getItem("df:trustedSourceFilterEnabled")).toBe("false");
  });

  it("forces trusted source filtering on when the toggle is hidden by env", () => {
    localStorage.setItem("df:trustedSourceFilterEnabled", "false");
    mocks.env.showTrustedSourceFilterToggle = false;

    const { result } = renderHook(() => useVizOptions(), { wrapper });

    expect(result.current.trustedSourceFilterEnabled).toBe(true);

    act(() => {
      result.current.setTrustedSourceFilterEnabled(false);
    });

    expect(result.current.trustedSourceFilterEnabled).toBe(true);
    expect(localStorage.getItem("df:trustedSourceFilterEnabled")).toBe("false");
  });
});

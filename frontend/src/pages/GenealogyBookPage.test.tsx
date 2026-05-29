// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GenealogyBookPage from "./GenealogyBookPage";

const mocks = vi.hoisted(() => ({
  rootExists: true,
  projection: {
    rootId: "0xroot-v-1",
    nodesData: {},
    graph: {
      nodes: [{ id: "0xroot-v-1", depth: 0, personHash: "0xroot", versionIndex: 1 }],
      edges: [],
      childrenByParent: {},
    },
  },
  status: {
    loading: false,
    progress: { created: 1, depth: 1 },
    contractMessage: "ready",
    refresh: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, options?: any) => {
      if (typeof fallbackOrOptions === "string") {
        return fallbackOrOptions.replace(/{{\s*(\w+)\s*}}/g, (_match, name) =>
          String(options?.[name] ?? ""),
        );
      }
      if (fallbackOrOptions && typeof fallbackOrOptions === "object") {
        return String(fallbackOrOptions.defaultValue ?? key).replace(
          /{{\s*(\w+)\s*}}/g,
          (_match, name) => String((fallbackOrOptions as Record<string, unknown>)[name] ?? ""),
        );
      }
      return key;
    },
  }),
}));

vi.mock("../domains/tree", () => ({
  isPaperGenealogyStyle: (value: string | null) =>
    ["ou", "su", "pagoda", "dieji", "modern"].includes(String(value)),
  PAPER_GENEALOGY_STYLES: ["ou", "su", "pagoda", "dieji", "modern"],
  PaperGenealogyView: (props: any) => (
    <div
      data-testid="paper-view"
      data-style={props.style}
      data-has-root={String(props.hasRoot)}
      data-node-count={String(props.graph.nodes.length)}
    />
  ),
  useFamilyTreeProjection: () => mocks.projection,
  useTreeGraphData: () => ({ rootExists: mocks.rootExists }),
  useTreeStatus: () => mocks.status,
}));

describe("GenealogyBookPage", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.rootExists = true;
    mocks.status.loading = false;
    mocks.status.progress = { created: 1, depth: 1 };
    mocks.status.contractMessage = "ready";
    mocks.status.refresh.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the paper view and persists style changes in realtime", () => {
    render(<GenealogyBookPage />);

    expect(screen.getByTestId("paper-view").dataset.style).toBe("ou");
    expect(screen.getByTestId("paper-view").dataset.hasRoot).toBe("true");

    const cases = [
      ["Su-style", "su"],
      ["Pagoda", "pagoda"],
      ["Register", "dieji"],
      ["Modern", "modern"],
      ["Ou-style", "ou"],
    ] as const;

    for (const [label, style] of cases) {
      fireEvent.click(screen.getByText(label));
      expect(screen.getByTestId("paper-view").dataset.style).toBe(style);
      expect(localStorage.getItem("df:paperGenealogyStyle")).toBe(style);
    }

    fireEvent.click(screen.getByTitle("Refresh"));
    expect(mocks.status.refresh).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default style and passes empty-root state through", () => {
    localStorage.setItem("df:paperGenealogyStyle", "unknown");
    mocks.rootExists = false;

    render(<GenealogyBookPage />);

    expect(screen.getByTestId("paper-view").dataset.style).toBe("ou");
    expect(screen.getByTestId("paper-view").dataset.hasRoot).toBe("false");
  });
});

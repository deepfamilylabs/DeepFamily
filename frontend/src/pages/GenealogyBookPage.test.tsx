// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  getStoryData: vi.fn().mockResolvedValue(null),
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
  PAPER_GENEALOGY_STYLE: {
    OU: "ou",
    DIEJI: "dieji",
    PAGODA: "pagoda",
    LINEAGE: "lineage",
    MODERN: "modern",
  },
  isPaperGenealogyStyle: (value: string | null) =>
    ["ou", "dieji", "pagoda", "lineage", "modern"].includes(String(value)),
  PAPER_GENEALOGY_STYLES: ["ou", "dieji", "pagoda", "lineage", "modern"],
  PaperGenealogyView: (props: any) => (
    <div
      data-testid="paper-view"
      data-style={props.style}
      data-has-root={String(props.hasRoot)}
      data-node-count={String(props.graph.nodes.length)}
    />
  ),
  useFamilyTreeProjection: () => mocks.projection,
  useTreeNodeAccess: () => ({ getStoryData: mocks.getStoryData }),
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
    mocks.getStoryData.mockReset();
    mocks.getStoryData.mockResolvedValue(null);
    mocks.projection.nodesData = {};
    mocks.projection.graph = {
      nodes: [{ id: "0xroot-v-1", depth: 0, personHash: "0xroot", versionIndex: 1 }],
      edges: [],
      childrenByParent: {},
    };
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
      ["Dieji-style", "dieji"],
      ["Pagoda", "pagoda"],
      ["Lineage", "lineage"],
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

  it("preloads missing story chunks for paper records", async () => {
    mocks.projection.nodesData = {
      "0xroot-v-1": {
        id: "0xroot-v-1",
        personHash: "0xroot",
        versionIndex: 1,
        tokenId: "7",
        storyMetadata: {
          totalChunks: 2,
          fullStoryHash: "",
          lastUpdateTime: 1,
          isSealed: false,
          totalLength: 100,
        },
        storyChunks: [
          {
            chunkIndex: 0,
            chunkHash: "0x1",
            content: "first",
            timestamp: 1,
            editor: "0x0000000000000000000000000000000000000000",
            chunkType: 0,
            attachmentCID: "",
          },
        ],
      },
    };

    render(<GenealogyBookPage />);

    await waitFor(() => {
      expect(mocks.getStoryData).toHaveBeenCalledWith("7", { nodeIdHint: "0xroot-v-1" });
    });
  });
});

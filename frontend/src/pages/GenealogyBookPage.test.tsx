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
  exportPdf: vi.fn().mockResolvedValue(undefined),
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
    SU: "su",
    DIEJI: "dieji",
    LINEAGE: "lineage",
    MODERN: "modern",
  },
  isPaperGenealogyStyle: (value: string | null) =>
    ["ou", "su", "dieji", "lineage", "modern"].includes(String(value)),
  PAPER_GENEALOGY_STYLES: ["ou", "su", "dieji", "lineage", "modern"],
  // The page derives the auto spine title via these; a fixed value keeps the input prefill stable.
  buildPaperGenerations: () => [],
  getPaperSpineTitle: () => "自动族谱",
  // Mirror the real per-root localStorage helpers so the page test exercises real persistence.
  loadPaperSpineTitleOverride: (rootId: string | null) =>
    rootId ? localStorage.getItem(`df:paperSpineTitle:${rootId}`) : null,
  savePaperSpineTitleOverride: (rootId: string | null, title: string) => {
    if (!rootId) return;
    const key = `df:paperSpineTitle:${rootId}`;
    if (title.trim() === "") localStorage.removeItem(key);
    else localStorage.setItem(key, title);
  },
  PaperGenealogyView: (props: any) => (
    <div
      data-testid="paper-view"
      data-style={props.style}
      data-has-root={String(props.hasRoot)}
      data-node-count={String(props.graph.nodes.length)}
      data-spine-title-override={props.spineTitleOverride ?? ""}
    />
  ),
  useFamilyTreeProjection: () => mocks.projection,
  usePaperPdfExport: () => ({ exporting: false, exportPdf: mocks.exportPdf }),
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
    mocks.projection.rootId = "0xroot-v-1";
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
      ["Su-style", "su"],
      ["Dieji-style", "dieji"],
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

  it("prefills the spine title input with the auto title and persists overrides per root", () => {
    render(<GenealogyBookPage />);

    const input = screen.getByTestId("paper-spine-title-input") as HTMLInputElement;
    // Default: prefilled with the auto title, and no override is forwarded to the view.
    expect(input.value).toBe("自动族谱");
    expect(screen.getByTestId("paper-view").getAttribute("data-spine-title-override")).toBe("");

    // Editing persists under the rootId key and flows to the view.
    fireEvent.change(input, { target: { value: "曹氏宗谱" } });
    expect((screen.getByTestId("paper-spine-title-input") as HTMLInputElement).value).toBe(
      "曹氏宗谱",
    );
    expect(localStorage.getItem("df:paperSpineTitle:0xroot-v-1")).toBe("曹氏宗谱");
    expect(screen.getByTestId("paper-view").getAttribute("data-spine-title-override")).toBe(
      "曹氏宗谱",
    );

    // Clearing reverts to the auto title and removes the saved override.
    fireEvent.change(screen.getByTestId("paper-spine-title-input"), { target: { value: "" } });
    expect(localStorage.getItem("df:paperSpineTitle:0xroot-v-1")).toBeNull();
    expect(screen.getByTestId("paper-view").getAttribute("data-spine-title-override")).toBe("");
  });

  it("loads a previously saved override for the active root", () => {
    localStorage.setItem("df:paperSpineTitle:0xroot-v-1", "曹氏宗谱");

    render(<GenealogyBookPage />);

    expect((screen.getByTestId("paper-spine-title-input") as HTMLInputElement).value).toBe(
      "曹氏宗谱",
    );
    expect(screen.getByTestId("paper-view").getAttribute("data-spine-title-override")).toBe(
      "曹氏宗谱",
    );
  });

  it("keeps spine title overrides isolated between different roots", () => {
    mocks.projection.rootId = "0xrootA-v-1";
    const { unmount } = render(<GenealogyBookPage />);
    fireEvent.change(screen.getByTestId("paper-spine-title-input"), {
      target: { value: "曹氏宗谱" },
    });
    expect(localStorage.getItem("df:paperSpineTitle:0xrootA-v-1")).toBe("曹氏宗谱");
    unmount();
    cleanup();

    // A different root starts from the auto title, unaffected by the other root's override.
    mocks.projection.rootId = "0xrootB-v-1";
    render(<GenealogyBookPage />);
    const inputB = screen.getByTestId("paper-spine-title-input") as HTMLInputElement;
    expect(inputB.value).toBe("自动族谱");
    expect(screen.getByTestId("paper-view").getAttribute("data-spine-title-override")).toBe("");

    fireEvent.change(inputB, { target: { value: "孙氏族谱" } });
    expect(localStorage.getItem("df:paperSpineTitle:0xrootB-v-1")).toBe("孙氏族谱");
    // The first root's override is preserved separately.
    expect(localStorage.getItem("df:paperSpineTitle:0xrootA-v-1")).toBe("曹氏宗谱");
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

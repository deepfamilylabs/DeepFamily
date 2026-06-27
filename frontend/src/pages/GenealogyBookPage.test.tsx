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
  DEFAULT_PAPER_APPEARANCE: {
    colorThemeId: "xuan",
    fontPresetId: "classic",
    textureId: "subtle",
    borderStyleId: "single",
    hallName: null,
    fontScale: 1,
    exportMarginPx: 48,
  },
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
  // Appearance preset ids + swatch + a buildPaperVars stub that echoes the active appearance so the
  // view mock can assert which theme/font/texture is applied.
  PAPER_COLOR_THEME_IDS: ["xuan", "plain", "bamboo", "azure"],
  PAPER_FONT_PRESET_IDS: ["classic", "song", "sans"],
  PAPER_TEXTURE_IDS: ["subtle", "strong", "plain"],
  PAPER_BORDER_STYLE_IDS: ["single", "double", "sides", "wenwu"],
  getPaperColorThemeSwatch: () => ["#f7efd8", "#8a6a3b", "#c18070"],
  getPaperBorderStyleVars: () => ({
    "--df-paper-frame-outer": "1px",
    "--df-paper-frame-inner-tb": "1px",
    "--df-paper-frame-inner-lr": "1px",
    "--df-paper-frame-pad-tb": "4px",
    "--df-paper-frame-pad-lr": "4px",
  }),
  buildPaperVars: (appearance: any) => ({
    "--df-paper-test-theme": appearance.colorThemeId,
    "--df-paper-test-font": appearance.fontPresetId,
    "--df-paper-test-texture": appearance.textureId,
    "--df-paper-test-border": appearance.borderStyleId,
  }),
  // Mirror the real global appearance persistence (single JSON key) so the test exercises it.
  PAPER_FONT_SCALE_MIN: 0.8,
  PAPER_FONT_SCALE_MAX: 1.6,
  PAPER_FONT_SCALE_STEP: 0.1,
  PAPER_EXPORT_MARGIN_MIN: 0,
  PAPER_EXPORT_MARGIN_MAX: 120,
  PAPER_EXPORT_MARGIN_STEP: 4,
  loadPaperAppearance: () => {
    const raw = localStorage.getItem("df:paperAppearance");
    const base = {
      colorThemeId: "xuan",
      fontPresetId: "classic",
      textureId: "subtle",
      borderStyleId: "single",
      hallName: null,
      fontScale: 1,
      exportMarginPx: 48,
    };
    if (!raw) return base;
    try {
      return { ...base, ...JSON.parse(raw) };
    } catch {
      return base;
    }
  },
  savePaperAppearance: (appearance: any) => {
    const normalized = {
      ...appearance,
      hallName: appearance.hallName && appearance.hallName.trim() ? appearance.hallName : null,
    };
    localStorage.setItem("df:paperAppearance", JSON.stringify(normalized));
  },
  PaperGenealogyView: (props: any) => (
    <div
      data-testid="paper-view"
      data-style={props.style}
      data-has-root={String(props.hasRoot)}
      data-node-count={String(props.graph.nodes.length)}
      data-spine-title-override={props.spineTitleOverride ?? ""}
      data-hall-name={props.hallName ?? ""}
      data-color-theme={props.paperVars?.["--df-paper-test-theme"] ?? ""}
      data-font={props.paperVars?.["--df-paper-test-font"] ?? ""}
      data-texture={props.paperVars?.["--df-paper-test-texture"] ?? ""}
      data-font-scale={String(props.fontScale ?? "")}
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

  it("applies the default appearance and forwards it to the view", () => {
    render(<GenealogyBookPage />);

    expect(screen.getByTestId("paper-color-theme-xuan").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("paper-font-preset-classic").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByTestId("paper-texture-subtle").getAttribute("aria-pressed")).toBe("true");

    const view = screen.getByTestId("paper-view");
    expect(view.getAttribute("data-color-theme")).toBe("xuan");
    expect(view.getAttribute("data-font")).toBe("classic");
    expect(view.getAttribute("data-texture")).toBe("subtle");
  });

  it("persists color theme, font and texture changes globally and forwards them to the view", () => {
    render(<GenealogyBookPage />);

    fireEvent.click(screen.getByTestId("paper-color-theme-bamboo"));
    fireEvent.click(screen.getByTestId("paper-font-preset-song"));
    fireEvent.click(screen.getByTestId("paper-texture-strong"));

    const view = screen.getByTestId("paper-view");
    expect(view.getAttribute("data-color-theme")).toBe("bamboo");
    expect(view.getAttribute("data-font")).toBe("song");
    expect(view.getAttribute("data-texture")).toBe("strong");

    const saved = JSON.parse(localStorage.getItem("df:paperAppearance") || "{}");
    expect(saved.colorThemeId).toBe("bamboo");
    expect(saved.fontPresetId).toBe("song");
    expect(saved.textureId).toBe("strong");
  });

  it("restores the sidebar display settings to their defaults", () => {
    render(<GenealogyBookPage />);

    const resetButton = screen.getByTestId("paper-reset-display-settings") as HTMLButtonElement;
    expect(resetButton.disabled).toBe(true);

    fireEvent.change(screen.getByTestId("paper-spine-title-input"), {
      target: { value: "曹氏宗谱" },
    });
    fireEvent.change(screen.getByTestId("paper-hall-name-input"), { target: { value: "忠义堂" } });
    fireEvent.click(screen.getByTestId("paper-color-theme-bamboo"));
    fireEvent.click(screen.getByTestId("paper-font-preset-song"));
    fireEvent.click(screen.getByTestId("paper-texture-strong"));
    fireEvent.click(screen.getByTestId("paper-border-style-double"));
    fireEvent.change(screen.getByTestId("paper-font-scale-input"), { target: { value: "1.3" } });
    fireEvent.change(screen.getByTestId("paper-export-margin-input"), { target: { value: "72" } });
    expect(resetButton.disabled).toBe(false);

    fireEvent.click(resetButton);

    expect(localStorage.getItem("df:paperSpineTitle:0xroot-v-1")).toBeNull();
    expect(JSON.parse(localStorage.getItem("df:paperAppearance") || "{}")).toEqual({
      colorThemeId: "xuan",
      fontPresetId: "classic",
      textureId: "subtle",
      borderStyleId: "single",
      hallName: null,
      fontScale: 1,
      exportMarginPx: 48,
    });
    expect((screen.getByTestId("paper-spine-title-input") as HTMLInputElement).value).toBe(
      "自动族谱",
    );
    expect((screen.getByTestId("paper-hall-name-input") as HTMLInputElement).value).toBe(
      "DeepFamily",
    );
    expect(screen.getByTestId("paper-color-theme-xuan").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("paper-font-preset-classic").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByTestId("paper-texture-subtle").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("paper-border-style-single").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect((screen.getByTestId("paper-font-scale-input") as HTMLInputElement).value).toBe("1");
    expect((screen.getByTestId("paper-export-margin-input") as HTMLInputElement).value).toBe("48");
    expect(resetButton.disabled).toBe(true);
  });

  it("loads a previously saved appearance", () => {
    localStorage.setItem(
      "df:paperAppearance",
      JSON.stringify({
        colorThemeId: "azure",
        fontPresetId: "sans",
        textureId: "plain",
        hallName: "忠义堂",
      }),
    );

    render(<GenealogyBookPage />);

    expect(screen.getByTestId("paper-color-theme-azure").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("paper-font-preset-sans").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("paper-texture-plain").getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByTestId("paper-hall-name-input") as HTMLInputElement).value).toBe("忠义堂");
    expect(screen.getByTestId("paper-view").getAttribute("data-hall-name")).toBe("忠义堂");
  });

  it("applies the default font scale and forwards it to the view", () => {
    render(<GenealogyBookPage />);

    const slider = screen.getByTestId("paper-font-scale-input") as HTMLInputElement;
    expect(slider.value).toBe("1");
    expect(screen.getByTestId("paper-view").getAttribute("data-font-scale")).toBe("1");
  });

  it("persists font scale changes globally and forwards them to the view", () => {
    render(<GenealogyBookPage />);

    fireEvent.change(screen.getByTestId("paper-font-scale-input"), { target: { value: "1.3" } });

    expect(screen.getByTestId("paper-view").getAttribute("data-font-scale")).toBe("1.3");
    expect(JSON.parse(localStorage.getItem("df:paperAppearance") || "{}").fontScale).toBe(1.3);
  });

  it("passes css vars and the export margin to export", () => {
    render(<GenealogyBookPage />);
    fireEvent.click(screen.getByTitle("Export PDF"));

    expect(mocks.exportPdf).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      "ou",
      expect.objectContaining({
        "--df-paper-test-font": "classic",
      }),
      48,
    );
  });

  it("adjusts and persists the export margin, forwarding it to export", () => {
    render(<GenealogyBookPage />);

    fireEvent.change(screen.getByTestId("paper-export-margin-input"), { target: { value: "72" } });
    expect(JSON.parse(localStorage.getItem("df:paperAppearance") || "{}").exportMarginPx).toBe(72);

    fireEvent.click(screen.getByTitle("Export PDF"));
    expect(mocks.exportPdf).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      "ou",
      expect.anything(),
      72,
    );
  });

  it("loads a previously saved font scale", () => {
    localStorage.setItem(
      "df:paperAppearance",
      JSON.stringify({
        colorThemeId: "xuan",
        fontPresetId: "classic",
        textureId: "subtle",
        hallName: null,
        fontScale: 1.4,
      }),
    );

    render(<GenealogyBookPage />);

    expect((screen.getByTestId("paper-font-scale-input") as HTMLInputElement).value).toBe("1.4");
    expect(screen.getByTestId("paper-view").getAttribute("data-font-scale")).toBe("1.4");
  });

  it("prefills the hall name with the default and persists overrides globally", () => {
    render(<GenealogyBookPage />);

    const input = screen.getByTestId("paper-hall-name-input") as HTMLInputElement;
    // Default: prefilled with the i18n hall name; no override forwarded to the view.
    expect(input.value).toBe("DeepFamily");
    expect(screen.getByTestId("paper-view").getAttribute("data-hall-name")).toBe("");

    fireEvent.change(input, { target: { value: "忠义堂" } });
    expect(screen.getByTestId("paper-view").getAttribute("data-hall-name")).toBe("忠义堂");
    expect(JSON.parse(localStorage.getItem("df:paperAppearance") || "{}").hallName).toBe("忠义堂");

    // Clearing falls back to the default hall name (override removed from storage).
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByTestId("paper-view").getAttribute("data-hall-name")).toBe("");
    expect(JSON.parse(localStorage.getItem("df:paperAppearance") || "{}").hallName).toBeNull();
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

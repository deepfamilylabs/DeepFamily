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
    clearAllCaches: vi.fn(),
  },
  getStoryData: vi.fn().mockResolvedValue(null),
  exportPdf: vi.fn().mockResolvedValue(undefined),
  chromeCollapsed: false,
  readingView: {
    goPrev: vi.fn(),
    goNext: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    fitPage: vi.fn(),
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

vi.mock("./family/FamilyVolumeNav", () => ({
  FamilyVolumeNav: () => <nav data-testid="family-volume-nav" />,
}));

vi.mock("../domains/config", () => ({
  useConfig: () => ({ rootHash: "0xroot", rootVersionIndex: 1 }),
  FamilyTreeConfigForm: () => <div data-testid="family-tree-config-form" />,
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
    borderStyleId: "wenwu",
    hallName: null,
    fontScale: 1,
    exportMarginPx: 48,
    coverEnabled: false,
    coverInscription: null,
    coverStyleId: "traditional-slip",
    backCoverMode: "matched",
    showCoverSpine: true,
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
  PAPER_COLOR_THEME_IDS: [
    "xuan",
    "plain",
    "bamboo",
    "azure",
    "vermilion",
    "ochre",
    "indigo",
    "sumi",
    "rubbing",
    "imperial",
  ],
  PAPER_FONT_PRESET_IDS: ["classic", "song", "lishu", "sans"],
  PAPER_TEXTURE_IDS: ["subtle", "strong", "plain"],
  PAPER_BORDER_STYLE_IDS: ["wenwu", "single", "double", "sides"],
  PAPER_COVER_STYLE_IDS: [
    "traditional-slip",
    "centered-classic",
    "minimal-thread",
    "archive-frame",
  ],
  PAPER_BACK_COVER_MODES: ["matched", "blank"],
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
      borderStyleId: "wenwu",
      hallName: null,
      fontScale: 1,
      exportMarginPx: 48,
      coverEnabled: false,
      coverInscription: null,
      coverStyleId: "traditional-slip",
      backCoverMode: "matched",
      showCoverSpine: true,
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
      data-cover-style={props.coverStyleId ?? ""}
      data-back-cover-mode={props.backCoverMode ?? ""}
      data-show-cover-spine={String(props.showCoverSpine ?? "")}
    />
  ),
  useFamilyTreeProjection: () => mocks.projection,
  usePaperPdfExport: () => ({ exporting: false, exportPdf: mocks.exportPdf }),
  useTreeNodeAccess: () => ({ getStoryData: mocks.getStoryData }),
  useTreeGraphData: () => ({
    rootId: mocks.projection.rootId,
    rootExists: mocks.rootExists,
    nodesData: mocks.projection.nodesData,
  }),
  useTreeStatus: () => mocks.status,
  usePaperReadingView: ({ fontScale = 1 }: { fontScale?: number }) => ({
    sheetScale: fontScale,
    zoomPercent: Math.round(fontScale * 100),
    fitMode: false,
    canZoomIn: true,
    canZoomOut: true,
    leaf: { index: 2, count: 7, volume: 1, isCover: false },
    chromeCollapsed: mocks.chromeCollapsed,
    canGoPrev: true,
    canGoNext: true,
    ...mocks.readingView,
  }),
  MetadataUnlockControl: () => <div data-testid="metadata-unlock-control" />,
}));

describe("GenealogyBookPage", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.rootExists = true;
    mocks.status.loading = false;
    mocks.status.progress = { created: 1, depth: 1 };
    mocks.status.contractMessage = "ready";
    mocks.status.refresh.mockReset();
    mocks.status.clearAllCaches.mockReset();
    mocks.getStoryData.mockReset();
    mocks.getStoryData.mockResolvedValue(null);
    Object.values(mocks.readingView).forEach((spy) => spy.mockReset());
    mocks.chromeCollapsed = false;
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

  // The settings are a slide-over now rather than a docked column, and their four groups are tabs
  // rather than stacked accordions, so a test that touches a control opens the drawer and selects
  // the tab that owns it.
  type SettingsTab = "book" | "cover" | "paper" | "typesetting";
  const openSettings = (tab: SettingsTab = "book") => {
    const toggle = screen.getByTestId("paper-settings-toggle");
    if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId(`paper-settings-tab-${tab}`));
  };

  it("renders the paper view and persists style changes in realtime", () => {
    render(<GenealogyBookPage />);

    expect(screen.getByTestId("paper-view").dataset.style).toBe("ou");
    expect(screen.getByTestId("paper-view").dataset.hasRoot).toBe("true");

    const toolbar = screen.getByTestId("paper-book-toolbar");
    const styleSwitcher = screen.getByTestId("paper-style-switcher");
    const toolbarActions = screen.getByTestId("paper-toolbar-actions");
    const exportButton = screen.getByTestId("paper-export-button");
    expect(screen.getByText("Style")).toBeTruthy();
    // One 46px row that the 族谱 volume owns, with no title block repeating the volume tab above it.
    expect(toolbar.className).toContain("h-[46px]");
    expect(toolbarActions.className).toContain("gap-2");
    expect(
      styleSwitcher.compareDocumentPosition(exportButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(exportButton.className).toContain("bg-primary");

    const cases = [
      ["Su-style", "su"],
      ["Dieji-style", "dieji"],
      ["Lineage Chart", "lineage"],
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

  it("keeps the family bar in place when there is no genealogy to read", () => {
    mocks.rootExists = false;
    // Even if the reading view were to report a collapse, an empty page must keep the bar: it
    // carries refresh, clear-caches and settings, which are the only ways out of that state.
    mocks.chromeCollapsed = true;

    render(<GenealogyBookPage />);

    const slot = screen.getByTestId("paper-family-bar-slot");
    expect(slot.dataset.collapsed).toBe("false");
    expect(slot.style.height).toBe("56px");
    expect(slot.style.visibility).toBe("visible");
    expect(screen.getByTitle("Refresh")).toBeTruthy();
  });

  it("prefills the spine title input with the auto title and persists overrides per root", () => {
    render(<GenealogyBookPage />);
    openSettings("book");

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
    openSettings("book");

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
    openSettings("book");
    fireEvent.change(screen.getByTestId("paper-spine-title-input"), {
      target: { value: "曹氏宗谱" },
    });
    expect(localStorage.getItem("df:paperSpineTitle:0xrootA-v-1")).toBe("曹氏宗谱");
    unmount();
    cleanup();

    // A different root starts from the auto title, unaffected by the other root's override.
    mocks.projection.rootId = "0xrootB-v-1";
    render(<GenealogyBookPage />);
    openSettings("book");
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

    // The settings drawer opens with the page so its controls are in reach right away.
    expect(screen.getByTestId("paper-settings-drawer")).toBeTruthy();

    openSettings("book");
    expect(screen.getByTestId("paper-settings-drawer")).toBeTruthy();
    expect(screen.getByTestId("paper-info-settings")).toBeTruthy();
    expect(screen.getByTestId("paper-hall-name-input")).toBeTruthy();

    // Each group is one tab away, and only the selected group is mounted.
    const groups = [
      ["cover", "paper-cover-settings"],
      ["paper", "paper-appearance-settings"],
      ["typesetting", "paper-typesetting-settings"],
    ] as const;
    for (const [tab, panel] of groups) {
      openSettings(tab);
      expect(screen.getByTestId(panel)).toBeTruthy();
      expect(screen.getByTestId(`paper-settings-tab-${tab}`).getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(screen.queryByTestId("paper-info-settings")).toBeNull();
    }

    openSettings("cover");
    expect(screen.getByLabelText("Enable front & back cover")).toBeTruthy();
    const coverFieldset = screen.getByTestId("paper-cover-settings").querySelector("fieldset");
    const frontCoverSettings = screen.getByTestId("paper-front-cover-settings");
    const spineSettings = screen.getByTestId("paper-spine-settings");
    const backCoverSettings = screen.getByTestId("paper-back-cover-settings");
    expect(coverFieldset?.firstElementChild).toBe(frontCoverSettings);
    expect(
      frontCoverSettings.compareDocumentPosition(spineSettings) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      spineSettings.compareDocumentPosition(backCoverSettings) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(spineSettings.contains(screen.getByTestId("paper-cover-spine-input"))).toBe(true);
    const coverStyleButton = screen.getByTestId("paper-cover-style-traditional-slip");
    const coverInscriptionInput = screen.getByTestId("paper-cover-inscription-input");
    const backCoverButton = screen.getByTestId("paper-back-cover-mode-blank");
    expect(
      coverStyleButton.compareDocumentPosition(coverInscriptionInput) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      coverInscriptionInput.compareDocumentPosition(backCoverButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      screen.getByTestId("paper-cover-style-traditional-slip").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByTestId("paper-back-cover-mode-matched").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByTestId("paper-cover-style-traditional-slip").className).toContain(
      "border-orange-400",
    );
    expect(screen.getByTestId("paper-cover-style-traditional-slip").className).not.toContain(
      "border-red",
    );
    expect(screen.getByTestId("paper-cover-style-thumbnail-traditional-slip")).toBeTruthy();
    expect(screen.getByTestId("paper-back-cover-mode-matched").className).toContain(
      "text-orange-700",
    );
    expect(screen.getByTestId("paper-cover-enabled-input").getAttribute("role")).toBe("switch");
    expect(screen.getByTestId("paper-cover-spine-input").getAttribute("role")).toBe("switch");
    expect(screen.getByTestId("paper-cover-enabled-input").nextElementSibling?.className).toContain(
      "bg-stone-300",
    );
    expect(screen.getByTestId("paper-cover-spine-input").nextElementSibling?.className).toContain(
      "bg-orange-500",
    );
    expect((screen.getByTestId("paper-cover-enabled-input") as HTMLInputElement).checked).toBe(
      false,
    );
    expect(coverFieldset?.hasAttribute("disabled")).toBe(true);

    openSettings("paper");
    expect(screen.getByTestId("paper-color-theme-xuan").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("paper-texture-subtle").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("paper-color-theme-plain").className).toContain(
      "hover:border-orange-300",
    );
    expect(screen.getByTestId("paper-color-theme-plain").classList.contains("group/option")).toBe(
      true,
    );
    expect(screen.getByTestId("paper-color-theme-plain").classList.contains("group")).toBe(false);
    expect(screen.getByTestId("paper-border-style-single").className).toContain(
      "hover:border-orange-300",
    );

    openSettings("typesetting");
    expect(screen.getByTestId("paper-font-preset-classic").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByTestId("paper-font-preset-song").className).toContain(
      "hover:text-orange-700",
    );
    expect(screen.getByTestId("paper-font-scale-input").className).toContain(
      "hover:accent-orange-600",
    );

    const view = screen.getByTestId("paper-view");
    expect(view.getAttribute("data-color-theme")).toBe("xuan");
    expect(view.getAttribute("data-font")).toBe("classic");
    expect(view.getAttribute("data-texture")).toBe("subtle");
  });

  it("closes the settings drawer again from its own header", () => {
    render(<GenealogyBookPage />);

    openSettings("book");
    expect(screen.getByTestId("paper-settings-toggle").getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByTestId("paper-settings-close"));
    expect(screen.queryByTestId("paper-settings-drawer")).toBeNull();
    expect(screen.getByTestId("paper-settings-toggle").getAttribute("aria-expanded")).toBe("false");
  });

  it("floats a reading bar over the sheet and wires it to the reading view", () => {
    render(<GenealogyBookPage />);

    const bar = screen.getByTestId("paper-reading-bar");
    // The address the book never had, plus the scale that stops the outer leaf being clipped.
    expect(screen.getByTestId("paper-reading-position").textContent).toContain("Volume 1");
    expect(screen.getByTestId("paper-reading-position").textContent).toContain("Leaf 2 / 7");
    expect(screen.getByTestId("paper-reading-zoom").textContent).toBe("100%");
    // The book opens at 100%; fit page is an action the reader takes, not the starting state.
    expect(screen.getByTestId("paper-reading-fit").getAttribute("aria-pressed")).toBe("false");
    expect(bar.className).toContain("bg-surface/95");

    fireEvent.click(screen.getByTestId("paper-reading-next"));
    fireEvent.click(screen.getByTestId("paper-reading-prev"));
    fireEvent.click(screen.getByTestId("paper-reading-zoom-in"));
    fireEvent.click(screen.getByTestId("paper-reading-zoom-out"));
    fireEvent.click(screen.getByTestId("paper-reading-fit"));

    expect(mocks.readingView.goNext).toHaveBeenCalledTimes(1);
    expect(mocks.readingView.goPrev).toHaveBeenCalledTimes(1);
    expect(mocks.readingView.zoomIn).toHaveBeenCalledTimes(1);
    expect(mocks.readingView.zoomOut).toHaveBeenCalledTimes(1);
    expect(mocks.readingView.fitPage).toHaveBeenCalledTimes(1);
  });

  it("folds the shared family bar away while reading down the book", () => {
    const { unmount } = render(<GenealogyBookPage />);

    // Expanded: the bar holds its own height and stays in the focus order.
    const slot = screen.getByTestId("paper-family-bar-slot");
    expect(slot.dataset.collapsed).toBe("false");
    expect(slot.style.height).toBe("56px");
    expect(slot.style.visibility).toBe("visible");

    unmount();
    cleanup();
    mocks.chromeCollapsed = true;
    render(<GenealogyBookPage />);

    const collapsed = screen.getByTestId("paper-family-bar-slot");
    expect(collapsed.dataset.collapsed).toBe("true");
    expect(collapsed.style.height).toBe("0px");
    // `visibility` as well as height, so the hidden nav cannot be tabbed into.
    expect(collapsed.style.visibility).toBe("hidden");
    // The 谱式 row is what meets the site header once the family bar folds away.
    expect(screen.getByTestId("paper-book-toolbar")).toBeTruthy();
  });

  it("turns leaves with the arrow keys, but not while a settings field has focus", () => {
    render(<GenealogyBookPage />);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(mocks.readingView.goNext).toHaveBeenCalledTimes(1);
    expect(mocks.readingView.goPrev).toHaveBeenCalledTimes(1);

    openSettings("book");
    const input = screen.getByTestId("paper-spine-title-input");
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(mocks.readingView.goNext).toHaveBeenCalledTimes(1);
  });

  it("persists color theme, font and texture changes globally and forwards them to the view", () => {
    render(<GenealogyBookPage />);

    openSettings("paper");
    fireEvent.click(screen.getByTestId("paper-color-theme-bamboo"));
    fireEvent.click(screen.getByTestId("paper-texture-strong"));
    openSettings("typesetting");
    fireEvent.click(screen.getByTestId("paper-font-preset-lishu"));

    const view = screen.getByTestId("paper-view");
    expect(view.getAttribute("data-color-theme")).toBe("bamboo");
    expect(view.getAttribute("data-font")).toBe("lishu");
    expect(view.getAttribute("data-texture")).toBe("strong");

    const saved = JSON.parse(localStorage.getItem("df:paperAppearance") || "{}");
    expect(saved.colorThemeId).toBe("bamboo");
    expect(saved.fontPresetId).toBe("lishu");
    expect(saved.textureId).toBe("strong");
  });

  it("persists the paired cover layout, back-cover mode and spine visibility", () => {
    render(<GenealogyBookPage />);
    openSettings("cover");

    fireEvent.click(screen.getByTestId("paper-cover-enabled-input"));
    fireEvent.click(screen.getByTestId("paper-cover-style-archive-frame"));
    fireEvent.click(screen.getByTestId("paper-back-cover-mode-blank"));
    fireEvent.click(screen.getByTestId("paper-cover-spine-input"));

    const view = screen.getByTestId("paper-view");
    expect(view.getAttribute("data-cover-style")).toBe("archive-frame");
    expect(view.getAttribute("data-back-cover-mode")).toBe("blank");
    expect(view.getAttribute("data-show-cover-spine")).toBe("false");

    const saved = JSON.parse(localStorage.getItem("df:paperAppearance") || "{}");
    expect(saved.coverStyleId).toBe("archive-frame");
    expect(saved.backCoverMode).toBe("blank");
    expect(saved.showCoverSpine).toBe(false);
  });

  it("restores the sidebar display settings to their defaults", () => {
    render(<GenealogyBookPage />);
    openSettings("book");

    const resetButton = screen.getByTestId("paper-reset-display-settings") as HTMLButtonElement;
    expect(resetButton.disabled).toBe(true);

    fireEvent.change(screen.getByTestId("paper-spine-title-input"), {
      target: { value: "曹氏宗谱" },
    });
    fireEvent.change(screen.getByTestId("paper-hall-name-input"), { target: { value: "忠义堂" } });
    openSettings("paper");
    fireEvent.click(screen.getByTestId("paper-color-theme-bamboo"));
    fireEvent.click(screen.getByTestId("paper-texture-strong"));
    fireEvent.click(screen.getByTestId("paper-border-style-double"));
    openSettings("typesetting");
    fireEvent.click(screen.getByTestId("paper-font-preset-song"));
    fireEvent.change(screen.getByTestId("paper-font-scale-input"), { target: { value: "1.3" } });
    fireEvent.change(screen.getByTestId("paper-export-margin-input"), { target: { value: "72" } });
    expect(resetButton.disabled).toBe(false);

    fireEvent.click(resetButton);

    expect(localStorage.getItem("df:paperSpineTitle:0xroot-v-1")).toBeNull();
    expect(JSON.parse(localStorage.getItem("df:paperAppearance") || "{}")).toEqual({
      colorThemeId: "xuan",
      fontPresetId: "classic",
      textureId: "subtle",
      borderStyleId: "wenwu",
      hallName: null,
      fontScale: 1,
      exportMarginPx: 48,
      coverEnabled: false,
      coverInscription: null,
      coverStyleId: "traditional-slip",
      backCoverMode: "matched",
      showCoverSpine: true,
    });
    expect((screen.getByTestId("paper-font-scale-input") as HTMLInputElement).value).toBe("1");
    expect((screen.getByTestId("paper-export-margin-input") as HTMLInputElement).value).toBe("48");
    expect(screen.getByTestId("paper-font-preset-classic").getAttribute("aria-pressed")).toBe(
      "true",
    );
    openSettings("paper");
    expect(screen.getByTestId("paper-color-theme-xuan").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("paper-texture-subtle").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("paper-border-style-wenwu").getAttribute("aria-pressed")).toBe(
      "true",
    );
    openSettings("book");
    expect((screen.getByTestId("paper-spine-title-input") as HTMLInputElement).value).toBe(
      "自动族谱",
    );
    expect((screen.getByTestId("paper-hall-name-input") as HTMLInputElement).value).toBe(
      "DeepFamily",
    );
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

    openSettings("paper");
    expect(screen.getByTestId("paper-color-theme-azure").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("paper-texture-plain").getAttribute("aria-pressed")).toBe("true");
    openSettings("typesetting");
    expect(screen.getByTestId("paper-font-preset-sans").getAttribute("aria-pressed")).toBe("true");
    openSettings("book");
    expect((screen.getByTestId("paper-hall-name-input") as HTMLInputElement).value).toBe("忠义堂");
    expect(screen.getByTestId("paper-view").getAttribute("data-hall-name")).toBe("忠义堂");
  });

  it("applies the default font scale and forwards it to the view", () => {
    render(<GenealogyBookPage />);
    openSettings("typesetting");

    const slider = screen.getByTestId("paper-font-scale-input") as HTMLInputElement;
    expect(slider.value).toBe("1");
    expect(screen.getByTestId("paper-view").getAttribute("data-font-scale")).toBe("1");
  });

  it("persists font scale changes globally and forwards them to the view", () => {
    render(<GenealogyBookPage />);
    openSettings("typesetting");

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
    openSettings("typesetting");

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
    openSettings("typesetting");

    expect((screen.getByTestId("paper-font-scale-input") as HTMLInputElement).value).toBe("1.4");
    expect(screen.getByTestId("paper-view").getAttribute("data-font-scale")).toBe("1.4");
  });

  it("prefills the hall name with the default and persists overrides globally", () => {
    render(<GenealogyBookPage />);
    openSettings("book");

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

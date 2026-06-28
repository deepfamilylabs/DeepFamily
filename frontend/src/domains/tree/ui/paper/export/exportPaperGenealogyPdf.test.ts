// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toPng = vi.fn(async (_el: HTMLElement, _options?: unknown) => "data:image/png;base64,AAAA");
const addPage = vi.fn();
const addImage = vi.fn();
const setFillColor = vi.fn();
const rect = vi.fn();
const save = vi.fn();
const jsPDF = vi.fn(function jsPDFMock() {
  return { addPage, addImage, setFillColor, rect, save };
});

vi.mock("html-to-image", () => ({ toPng }));
vi.mock("jspdf", () => ({ jsPDF }));

import { exportPaperGenealogyPdf, NoPaperSpreadsError } from "./exportPaperGenealogyPdf";
import { PAPER_FONT_PRESETS } from "../paperAppearance";

function buildRoot(spreadCount: number): HTMLElement {
  const root = document.createElement("div");
  for (let i = 0; i < spreadCount; i += 1) {
    const spread = document.createElement("div");
    spread.setAttribute("data-paper-spread", "");
    // jsdom returns 0 for offset dimensions; that's fine for the assertions here.
    root.appendChild(spread);
  }
  return root;
}

describe("exportPaperGenealogyPdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders one image per spread, adds N-1 pages, and saves once", async () => {
    const root = buildRoot(3);

    const result = await exportPaperGenealogyPdf({ root, fileName: "genealogy-modern.pdf" });

    expect(result.pageCount).toBe(3);
    expect(toPng).toHaveBeenCalledTimes(3);
    expect(toPng).toHaveBeenLastCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ skipFonts: true }),
    );
    expect(addImage).toHaveBeenCalledTimes(3);
    expect(addPage).toHaveBeenCalledTimes(2); // first spread reuses the initial page
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("genealogy-modern.pdf");
  });

  it("rasterizes the lishu preset with system fonts and embeds no webfont", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await exportPaperGenealogyPdf({
      root: buildRoot(1),
      fileName: "lishu.pdf",
      cssVars: PAPER_FONT_PRESETS.lishu,
    });

    // The lishu preset now resolves to the device's own 隶书, so the exporter skips font inlining
    // and never fetches/embeds a bundled face — it relies on the browser rasterizing system fonts.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(toPng).toHaveBeenLastCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ skipFonts: true }),
    );
    const calls = toPng.mock.calls;
    const options = (calls[calls.length - 1]?.[1] ?? {}) as Record<string, unknown>;
    expect(options).not.toHaveProperty("fontEmbedCSS");
  });

  it("insets each leaf by the book-edge margin and fills the margin band", async () => {
    const root = buildRoot(1);

    // jsdom reports 0 offset dimensions, so the page is just the margin band on both axes.
    await exportPaperGenealogyPdf({ root, fileName: "su.pdf", marginPx: 48, marginColor: "#f7efd8" });

    expect(setFillColor).toHaveBeenCalledWith("#f7efd8");
    expect(rect).toHaveBeenCalledWith(0, 0, 96, 96, "F");
    // Image is inset by the margin, not pinned to the page edge.
    expect(addImage).toHaveBeenCalledWith("data:image/png;base64,AAAA", "PNG", 48, 48, 0, 0);
  });

  it("skips the margin band when marginPx is 0", async () => {
    const root = buildRoot(1);

    await exportPaperGenealogyPdf({ root, fileName: "su.pdf", marginPx: 0 });

    expect(rect).not.toHaveBeenCalled();
    expect(addImage).toHaveBeenCalledWith("data:image/png;base64,AAAA", "PNG", 0, 0, 0, 0);
  });

  it("inlines paper CSS vars on the spread during capture and cleans them up after", async () => {
    const root = buildRoot(1);
    const spread = root.querySelector<HTMLElement>("[data-paper-spread]")!;

    // The SVG connector strokes use var(--df-paper-line-accent); html-to-image only carries it if
    // the variable is present inline on the captured node, so it must be set while toPng runs.
    let accentDuringCapture: string | undefined;
    toPng.mockImplementationOnce(async (el: HTMLElement) => {
      accentDuringCapture = el.style.getPropertyValue("--df-paper-line-accent");
      return "data:image/png;base64,AAAA";
    });

    await exportPaperGenealogyPdf({ root, fileName: "su.pdf" });

    expect(accentDuringCapture).toBe("#c18070");
    // Restored afterwards so the live DOM is left untouched.
    expect(spread.style.getPropertyValue("--df-paper-line-accent")).toBe("");
  });

  it("does not change the visible preview scale during capture", async () => {
    const root = document.createElement("div");
    const zoomLayer = document.createElement("div");
    zoomLayer.setAttribute("data-paper-zoom", "");
    zoomLayer.style.transform = "scale(1.4)";
    const spread = document.createElement("div");
    spread.setAttribute("data-paper-spread", "");
    zoomLayer.appendChild(spread);
    root.appendChild(zoomLayer);

    // The spread itself is captured at its fixed offset dimensions. Its zoomed ancestor must stay
    // untouched so the preview does not visibly shrink and grow while the export runs.
    let transformDuringCapture: string | undefined;
    toPng.mockImplementationOnce(async () => {
      transformDuringCapture = zoomLayer.style.transform;
      return "data:image/png;base64,AAAA";
    });

    await exportPaperGenealogyPdf({ root, fileName: "zoomed.pdf" });

    expect(transformDuringCapture).toBe("scale(1.4)");
    expect(zoomLayer.style.transform).toBe("scale(1.4)");
  });

  it("throws NoPaperSpreadsError when there are no spreads", async () => {
    const root = buildRoot(0);

    await expect(
      exportPaperGenealogyPdf({ root, fileName: "empty.pdf" }),
    ).rejects.toBeInstanceOf(NoPaperSpreadsError);

    expect(jsPDF).not.toHaveBeenCalled();
    expect(toPng).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});

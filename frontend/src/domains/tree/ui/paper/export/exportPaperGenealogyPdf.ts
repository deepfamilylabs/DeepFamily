// Rasterizes each fixed-size paper "spread" (a left/spine/right double page) into a PNG and lays
// one spread per landscape PDF page. The paper view renders spreads at exact pixel dimensions
// (~1180×872), so a spread maps cleanly to a single PDF page. CJK glyphs are rendered by the
// browser using system fonts and baked into the raster, so the resulting PDF is portable.

import type { CSSProperties } from "react";
import { PAPER_VARS } from "../paperStyles";

// Fallback paper sheet color when the active vars omit --df-paper-sheet; keeps the raster from
// getting a transparent background if the CSS variable fails to resolve on the cloned node.
const PAPER_SHEET_COLOR_FALLBACK = "#f7efd8";
const DEFAULT_PIXEL_RATIO = 2;

// The `--df-paper-*` custom properties are defined on the scroll-container ancestor, outside the
// captured spread. html-to-image clones only the spread subtree and does NOT carry CSS custom
// properties used in SVG presentation attributes (e.g. stroke="var(--df-paper-line-accent)") or
// var()-based fonts, so connector lines/fonts render invalid and vanish. Setting the active vars
// inline on the captured element makes the clone inherit them so those `var(...)` references resolve.
function toPaperVarEntries(vars: CSSProperties): Array<[string, string]> {
  return Object.entries(vars as Record<string, string>).filter(([name]) => name.startsWith("--"));
}

async function withInlinePaperVars<T>(
  el: HTMLElement,
  entries: Array<[string, string]>,
  run: () => Promise<T>,
): Promise<T> {
  for (const [name, value] of entries) el.style.setProperty(name, value);
  try {
    return await run();
  } finally {
    for (const [name] of entries) el.style.removeProperty(name);
  }
}

function getSpreadPageSize(spread: HTMLElement): {
  width: number;
  height: number;
} {
  return {
    width: spread.offsetWidth,
    height: spread.offsetHeight,
  };
}

export interface ExportPaperGenealogyPdfOptions {
  /** The paper-genealogy-view container holding the rendered spreads. */
  root: HTMLElement;
  fileName: string;
  /** Raster scale; higher = crisper text but larger file. Defaults to 2. */
  pixelRatio?: number;
  /** Active appearance vars to inline during capture; defaults to PAPER_VARS (default theme). */
  cssVars?: CSSProperties;
}

export class NoPaperSpreadsError extends Error {
  constructor() {
    super("No paper spreads found to export");
    this.name = "NoPaperSpreadsError";
  }
}

export async function exportPaperGenealogyPdf(
  options: ExportPaperGenealogyPdfOptions,
): Promise<{ pageCount: number }> {
  const {
    root,
    fileName,
    pixelRatio = DEFAULT_PIXEL_RATIO,
    cssVars = PAPER_VARS,
  } = options;
  const varEntries = toPaperVarEntries(cssVars);
  const sheetColor =
    (cssVars as Record<string, string>)["--df-paper-sheet"] || PAPER_SHEET_COLOR_FALLBACK;
  const spreads = Array.from(root.querySelectorAll<HTMLElement>("[data-paper-spread]"));
  if (!spreads.length) throw new NoPaperSpreadsError();

  // Lazy-load the heavy export libs so they are code-split out of the main bundle.
  const [{ toPng }, { jsPDF }] = await Promise.all([
    import("html-to-image"),
    import("jspdf"),
  ]);

  const capture = async () => {
    const firstSize = getSpreadPageSize(spreads[0]);
    const pageWidth = firstSize.width;
    const pageHeight = firstSize.height;

    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "px",
      format: [pageWidth, pageHeight],
    });

    for (let index = 0; index < spreads.length; index += 1) {
      const spread = spreads[index];
      const { width, height } = getSpreadPageSize(spread);
      // Sequential (not concurrent) to keep peak memory bounded on large books.
      const dataUrl = await withInlinePaperVars(spread, varEntries, () =>
        toPng(spread, {
          pixelRatio,
          backgroundColor: sheetColor,
          cacheBust: true,
          // The app's global Google Fonts stylesheets are cross-origin, so reading their cssRules
          // throws a SecurityError inside html-to-image. Paper spreads deliberately use system CJK
          // font stacks, which remain available to the browser while rasterizing, so no web-font
          // embedding is required (or desirable) for this export.
          skipFonts: true,
        }),
      );

      if (index > 0) pdf.addPage([width, height], "landscape");
      pdf.addImage(dataUrl, "PNG", 0, 0, width, height);
    }

    pdf.save(fileName);
    return { pageCount: spreads.length };
  };

  // `toPng` clones the spread, not its zoomed ancestor. offsetWidth/offsetHeight are likewise
  // unaffected by an ancestor transform, so this keeps the PDF at its fixed print size without
  // mutating the visible preview while the asynchronous rasterization is in progress.
  return capture();
}

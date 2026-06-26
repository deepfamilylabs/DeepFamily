// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const toPng = vi.fn(async (_el: HTMLElement, _options?: unknown) => "data:image/png;base64,AAAA");
const addPage = vi.fn();
const addImage = vi.fn();
const save = vi.fn();
const jsPDF = vi.fn(function jsPDFMock() {
  return { addPage, addImage, save };
});

vi.mock("html-to-image", () => ({ toPng }));
vi.mock("jspdf", () => ({ jsPDF }));

import { exportPaperGenealogyPdf, NoPaperSpreadsError } from "./exportPaperGenealogyPdf";

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

  it("renders one image per spread, adds N-1 pages, and saves once", async () => {
    const root = buildRoot(3);

    const result = await exportPaperGenealogyPdf({ root, fileName: "genealogy-modern.pdf" });

    expect(result.pageCount).toBe(3);
    expect(toPng).toHaveBeenCalledTimes(3);
    expect(addImage).toHaveBeenCalledTimes(3);
    expect(addPage).toHaveBeenCalledTimes(2); // first spread reuses the initial page
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("genealogy-modern.pdf");
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

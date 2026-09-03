import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PAPER_PREVIEW_MAX_WIDTH_PX, PAPER_SPREAD_HEIGHT_PX } from "./paperStyles";

export const PAPER_VIEW_ZOOM_MIN = 0.3;
export const PAPER_VIEW_ZOOM_MAX = 2;
export const PAPER_VIEW_ZOOM_STEP = 0.1;

// Each renderer's scroll container carries `p-4 md:p-6`, so reserve the md value across the width.
const STAGE_INSET_X_PX = 48;
// Vertically there is the same 24px above plus the floating reading bar below (h-11 at bottom-5,
// with a little air): a fitted leaf stops short of the bar instead of having it sit on the page.
const STAGE_INSET_Y_PX = 24 + 76;
// Collapsing the page chrome is a function of POSITION in the book, not of scroll direction — the
// same deal /people gives you, where the family bar is simply part of the document and only comes
// back once you have returned to the top. The two thresholds are hysteresis: the bar goes once you
// are a bar's height into the book, and returns near the top, so hovering at the boundary or a
// trackpad's jitter cannot flap it.
const CHROME_COLLAPSE_AT_PX = 56;
const CHROME_RELEASE_AT_PX = 24;

export interface PaperReadingLeaf {
  /** 1-based position of the leaf nearest the stage centre. 0 when the book is empty. */
  index: number;
  count: number;
  /** Volume (卷) the current leaf belongs to, or null on the cover spread / an empty book. */
  volume: number | null;
  isCover: boolean;
}

export interface PaperReadingView {
  /** Whole-sheet scale handed to the renderers: the document type scale times the view zoom. */
  sheetScale: number;
  /** Percent shown on the reading bar. */
  zoomPercent: number;
  fitMode: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
  leaf: PaperReadingLeaf;
  /** True while the reader is moving down the book: the caller collapses its outer chrome. */
  chromeCollapsed: boolean;
  canGoPrev: boolean;
  canGoNext: boolean;
  goPrev: () => void;
  goNext: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitPage: () => void;
}

function clampZoom(value: number): number {
  return Math.min(PAPER_VIEW_ZOOM_MAX, Math.max(PAPER_VIEW_ZOOM_MIN, value));
}

function readVolume(spread: Element): { volume: number | null; isCover: boolean } {
  const testId = spread.getAttribute("data-testid") ?? "";
  const match = /-spread-(\d+)-\d+$/.exec(testId);
  if (match) return { volume: Number(match[1]), isCover: false };
  return { volume: null, isCover: testId === "paper-cover-spread" };
}

/**
 * Drives the /genealogyBook reading view: how big the sheet is drawn and which leaf you are on.
 *
 * The sheet is laid out at a fixed 1320×872 (PAPER_PREVIEW_MAX_WIDTH_PX × PAPER_SPREAD_HEIGHT_PX),
 * which is wider than the stage on a 1440px window — that is what used to clip the outer leaf, since
 * the renderers' scroll container never had a scale to fall back on. "Fit page" derives the scale
 * from those two constants rather than from the rendered element, because the element's own width is
 * a function of the scale we are computing (PaperZoomViewport widens its base to 1320 as soon as the
 * scale leaves 1), which would otherwise oscillate.
 */
export function usePaperReadingView({
  stageRef,
  fontScale = 1,
  exportMarginPx = 0,
  /**
   * Full height of the chrome the caller collapses while reading down, and a ref to the element
   * holding it. Fit deliberately ignores that chrome: the stage grows by exactly what the slot
   * gives up, so folding the slot's LIVE height back in keeps the fitted scale constant — including
   * every frame of the collapse transition, which is why this compensates with the measured height
   * rather than the collapsed flag (the flag flips instantly, the layout takes 200ms, and sampling
   * the stage in between left the sheet resizing by ~1% on each scroll).
   */
  collapsibleChromePx = 0,
  chromeRef,
  /** Anything that re-paginates the book; re-measures the leaves when it changes. */
  contentKey,
}: {
  stageRef: React.RefObject<HTMLElement | null>;
  fontScale?: number;
  exportMarginPx?: number;
  collapsibleChromePx?: number;
  chromeRef?: React.RefObject<HTMLElement | null>;
  contentKey?: unknown;
}): PaperReadingView {
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  // The book opens at its natural size; "fit page" is a deliberate action, not the starting state.
  // `null` means "follow the fit zoom", so the default is an explicit 1.
  const [manualZoom, setManualZoom] = useState<number | null>(1);
  const [leaf, setLeaf] = useState<PaperReadingLeaf>({
    index: 0,
    count: 0,
    volume: null,
    isCover: false,
  });
  const [chromeCollapsed, setChromeCollapsed] = useState(false);
  const [chromeHeight, setChromeHeight] = useState(collapsibleChromePx);
  const spreadsRef = useRef<HTMLElement[]>([]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof window === "undefined") return undefined;

    let frame = 0;
    const chromeEl = chromeRef?.current ?? null;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      setStageSize((prev) =>
        Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
          ? prev
          : { width, height },
      );
      // Measured in the SAME frame as the stage, so the pair always sums to the shell's height.
      const nextChrome = chromeEl ? chromeEl.getBoundingClientRect().height : collapsibleChromePx;
      setChromeHeight((prev) => (Math.abs(prev - nextChrome) < 1 ? prev : nextChrome));
    };
    measure();

    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    observer?.observe(el);
    if (chromeEl) observer?.observe(chromeEl);
    window.addEventListener("resize", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [chromeRef, collapsibleChromePx, stageRef]);

  const safeFontScale = fontScale > 0 ? fontScale : 1;

  // The zoom that makes one whole leaf — sheet plus its book-edge margin — land inside the stage.
  const fitZoom = useMemo(() => {
    if (stageSize.width <= 0 || stageSize.height <= 0) return 1;
    const naturalWidth = PAPER_PREVIEW_MAX_WIDTH_PX;
    const naturalHeight = PAPER_SPREAD_HEIGHT_PX + exportMarginPx * 2;
    // stage + slot is a constant (they are siblings in a fixed-height column), so this is the
    // stage height as it would be with the chrome fully expanded, at any point in the transition.
    const usableHeight = stageSize.height + chromeHeight - collapsibleChromePx;
    const byWidth = (stageSize.width - STAGE_INSET_X_PX) / naturalWidth;
    const byHeight = (usableHeight - STAGE_INSET_Y_PX) / naturalHeight;
    return clampZoom(Math.min(byWidth, byHeight) / safeFontScale);
  }, [
    chromeHeight,
    collapsibleChromePx,
    exportMarginPx,
    safeFontScale,
    stageSize.height,
    stageSize.width,
  ]);

  const fitMode = manualZoom === null;
  const zoom = fitMode ? fitZoom : manualZoom;
  const sheetScale = safeFontScale * zoom;

  // Track which leaf sits nearest the stage centre, and how many there are. Both are read from the
  // live DOM: pagination decides the leaf count, and it depends on the data, the style and the width.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof window === "undefined") return undefined;

    let frame = 0;
    const sync = () => {
      const scroller = stage.querySelector<HTMLElement>("[data-paper-scroller]");
      const spreads = Array.from(stage.querySelectorAll<HTMLElement>("[data-paper-spread]"));
      spreadsRef.current = spreads;
      if (!scroller || spreads.length === 0) {
        setLeaf((prev) =>
          prev.count === 0 && prev.index === 0
            ? prev
            : { index: 0, count: 0, volume: null, isCover: false },
        );
        // A book that empties out while the chrome is folded away (the genealogy failed to load, the
        // root changed) must hand the chrome back: with nothing to scroll there is no way to earn it
        // again, and it carries the refresh the reader now needs.
        setChromeCollapsed(false);
        return;
      }

      // Fold the caller's chrome away once the reader is into the book, and give it back only on
      // the way back to the top — scrolling up mid-book does NOT summon it. Skipped when the book
      // is too short to scroll, so a one-leaf genealogy never hides the navigation.
      const scrollTop = scroller.scrollTop;
      const scrollable = scroller.scrollHeight - scroller.clientHeight > collapsibleChromePx;
      setChromeCollapsed((was) => {
        if (!scrollable || scrollTop <= CHROME_RELEASE_AT_PX) return false;
        if (scrollTop > CHROME_COLLAPSE_AT_PX) return true;
        return was;
      });

      const stageMid = scroller.getBoundingClientRect().top + scroller.clientHeight / 2;
      let nearest = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      spreads.forEach((spread, i) => {
        const rect = spread.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - stageMid);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = i;
        }
      });

      const { volume, isCover } = readVolume(spreads[nearest]);
      setLeaf((prev) =>
        prev.index === nearest + 1 &&
        prev.count === spreads.length &&
        prev.volume === volume &&
        prev.isCover === isCover
          ? prev
          : { index: nearest + 1, count: spreads.length, volume, isCover },
      );
    };

    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(sync);
    };

    schedule();
    const scroller = stage.querySelector<HTMLElement>("[data-paper-scroller]");
    scroller?.addEventListener("scroll", schedule, { passive: true });
    const observer =
      typeof MutationObserver !== "undefined" ? new MutationObserver(schedule) : null;
    observer?.observe(stage, { childList: true, subtree: true });
    return () => {
      window.cancelAnimationFrame(frame);
      scroller?.removeEventListener("scroll", schedule);
      observer?.disconnect();
    };
  }, [collapsibleChromePx, contentKey, sheetScale, stageRef]);

  const goTo = useCallback((target: number) => {
    const spreads = spreadsRef.current;
    if (spreads.length === 0) return;
    const index = Math.min(spreads.length - 1, Math.max(0, target));
    spreads[index]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const goPrev = useCallback(() => goTo(leaf.index - 2), [goTo, leaf.index]);
  const goNext = useCallback(() => goTo(leaf.index), [goTo, leaf.index]);

  const zoomIn = useCallback(() => setManualZoom(clampZoom(zoom + PAPER_VIEW_ZOOM_STEP)), [zoom]);
  const zoomOut = useCallback(() => setManualZoom(clampZoom(zoom - PAPER_VIEW_ZOOM_STEP)), [zoom]);
  const fitPage = useCallback(() => setManualZoom(null), []);

  return {
    sheetScale,
    zoomPercent: Math.round(sheetScale * 100),
    fitMode,
    canZoomIn: zoom < PAPER_VIEW_ZOOM_MAX - 1e-6,
    canZoomOut: zoom > PAPER_VIEW_ZOOM_MIN + 1e-6,
    leaf,
    chromeCollapsed,
    canGoPrev: leaf.count > 0 && leaf.index > 1,
    canGoNext: leaf.count > 0 && leaf.index < leaf.count,
    goPrev,
    goNext,
    zoomIn,
    zoomOut,
    fitPage,
  };
}

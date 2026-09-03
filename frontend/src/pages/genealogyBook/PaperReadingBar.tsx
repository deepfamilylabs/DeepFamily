import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus } from "lucide-react";
import type { TFunction } from "i18next";
import type { PaperReadingView } from "../../domains/tree";

export interface PaperReadingBarProps {
  t: TFunction;
  view: PaperReadingView;
}

function BarButton({
  label,
  onClick,
  disabled,
  testId,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      data-testid={testId}
      className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:text-ink-subtle disabled:opacity-60"
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-0.5 h-[18px] w-px shrink-0 bg-hairline" aria-hidden />;

/**
 * Floating over the sheet: the controls for how the book is *read*, as opposed to what the book is.
 *
 * "Fit page" is the reason this bar exists. The sheet is laid out at a fixed 1320px, wider than the
 * stage on a 1440px window, and the renderers' scroll container clipped the outer leaf with no way
 * to scale or scroll to it. The pager gives the book a 卷·叶 address it never had.
 */
export function PaperReadingBar({ t, view }: PaperReadingBarProps) {
  const { leaf } = view;
  const position = leaf.isCover
    ? t("genealogyBook.reading.coverLeaf", "Cover")
    : t("genealogyBook.reading.leafPosition", "Leaf {{index}} / {{count}}", {
        index: leaf.index,
        count: leaf.count,
      });

  return (
    <div
      className="pointer-events-auto inline-flex h-11 w-max items-center gap-0.5 whitespace-nowrap rounded-xl border border-hairline bg-surface/95 px-[7px] shadow-[0_2px_4px_rgba(15,23,42,.06),0_14px_28px_-10px_rgba(15,23,42,.28)] backdrop-blur-sm"
      data-testid="paper-reading-bar"
    >
      <BarButton
        label={t("genealogyBook.reading.prevLeaf", "Previous leaf")}
        onClick={view.goPrev}
        disabled={!view.canGoPrev}
        testId="paper-reading-prev"
      >
        <ChevronLeft className="h-4 w-4" />
      </BarButton>

      <span
        className="inline-flex shrink-0 items-baseline gap-1.5 px-2 text-[13px] text-ink-muted"
        data-testid="paper-reading-position"
      >
        {leaf.volume !== null ? (
          <b className="font-semibold text-ink">
            {t("genealogyBook.volumeLabel", "Volume {{number}}", { number: leaf.volume })}
          </b>
        ) : null}
        <span className="tabular-nums">{position}</span>
      </span>

      <BarButton
        label={t("genealogyBook.reading.nextLeaf", "Next leaf")}
        onClick={view.goNext}
        disabled={!view.canGoNext}
        testId="paper-reading-next"
      >
        <ChevronRight className="h-4 w-4" />
      </BarButton>

      <Sep />

      <BarButton
        label={t("genealogyBook.reading.zoomOut", "Zoom out")}
        onClick={view.zoomOut}
        disabled={!view.canZoomOut}
        testId="paper-reading-zoom-out"
      >
        <Minus className="h-4 w-4" />
      </BarButton>
      <span
        className="min-w-[44px] shrink-0 text-center text-[13px] font-semibold tabular-nums text-ink"
        data-testid="paper-reading-zoom"
      >
        {view.zoomPercent}%
      </span>
      <BarButton
        label={t("genealogyBook.reading.zoomIn", "Zoom in")}
        onClick={view.zoomIn}
        disabled={!view.canZoomIn}
        testId="paper-reading-zoom-in"
      >
        <Plus className="h-4 w-4" />
      </BarButton>

      <Sep />

      <button
        type="button"
        onClick={view.fitPage}
        aria-pressed={view.fitMode}
        data-testid="paper-reading-fit"
        className={`inline-flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13px] font-semibold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 ${
          view.fitMode
            ? "bg-surface-muted text-orange-700 dark:text-orange-200"
            : "text-ink-muted hover:bg-surface-muted hover:text-ink"
        }`}
      >
        <Maximize2 className="h-[15px] w-[15px]" />
        {t("genealogyBook.reading.fitPage", "Fit page")}
      </button>
    </div>
  );
}

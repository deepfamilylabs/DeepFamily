import type { TranslateFn } from "../paperData";
import { PAPER_LINE, PAPER_MARK_BG, PAPER_TEXT } from "../paperStyles";
import { getPaperSpinePageLabel, getPaperSpineVolumeLabel } from "../paperText";

// Traditional woodblock 鱼尾 (fishtail) center-fold marks. A classical 版心 carries a pair:
// the upper mark points downward and the lower one points upward, framing the spine text.
function PaperSpineFishtail({
  direction,
  className,
}: {
  direction: "up" | "down";
  className?: string;
}) {
  // Solid 黑鱼尾: a flat outer edge with vertical sides and a V swallowtail notch cut into the
  // inner edge, leaving the two inner corners as points. The upper mark notches downward, the
  // lower mark notches upward (mirrored), framing the spine text like a classical 版心.
  const clip =
    direction === "down"
      ? "[clip-path:polygon(0%_0%,100%_0%,100%_100%,50%_50%,0%_100%)]"
      : "[clip-path:polygon(0%_100%,100%_100%,100%_0%,50%_50%,0%_0%)]";
  return (
    <div
      className={`-mx-1 h-12 self-stretch ${clip} ${className ?? ""}`}
      style={{ backgroundColor: PAPER_MARK_BG }}
      aria-hidden="true"
    />
  );
}

export function PaperSpine({
  chartIndex,
  spreadIndex,
  title,
  hallName,
  t,
  testIdPrefix,
  pageOrder,
}: {
  chartIndex: number;
  spreadIndex: number;
  title: string;
  // User-provided hall name (堂号); when blank, falls back to the default i18n hall name.
  hallName?: string;
  t: TranslateFn;
  testIdPrefix: string;
  pageOrder: "ltr" | "rtl";
}) {
  const hallText = hallName?.trim() || t("genealogyBook.ouHallName", "DeepFamily");
  const leftPageLabel = getPaperSpinePageLabel((spreadIndex - 1) * 2 + 1, t);
  const rightPageLabel = getPaperSpinePageLabel((spreadIndex - 1) * 2 + 2, t);
  const volumeLabel = getPaperSpineVolumeLabel(chartIndex, t);
  const pageLabels =
    pageOrder === "ltr" ? [leftPageLabel, rightPageLabel] : [rightPageLabel, leftPageLabel];

  return (
    <aside
      className="relative flex h-[872px] flex-col items-center border-x px-1 py-3"
      style={{
        backgroundColor: "var(--df-paper-spine)",
        borderColor: PAPER_LINE.strong,
        color: "var(--df-paper-ink)",
      }}
      data-testid={`${testIdPrefix}-${chartIndex}-${spreadIndex}`}
    >
      <div
        className="leading-none tracking-normal"
        style={{
          ...PAPER_TEXT.spineTitle,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
      >
        {title}
      </div>
      <PaperSpineFishtail direction="down" className="mt-6 mb-3" />
      <div
        className="flex w-full justify-center border-y py-2"
        style={{ borderColor: PAPER_LINE.soft }}
      >
        <div className="grid grid-cols-2 gap-4" style={{ ...PAPER_TEXT.spineLabel }}>
          <span style={{ writingMode: "vertical-rl" }}>{volumeLabel}</span>
          <span style={{ writingMode: "vertical-rl" }}>{volumeLabel}</span>
        </div>
      </div>
      <div
        className="mt-auto flex h-9 w-full items-end justify-center border-b pb-3"
        style={{ borderColor: PAPER_LINE.soft }}
        aria-label={t("genealogyBook.spinePageNumbers", "page {{left}} / {{right}}", {
          left: leftPageLabel,
          right: rightPageLabel,
        })}
      >
        <div
          className="grid grid-cols-2 gap-4 text-center leading-none tracking-normal"
          style={{ ...PAPER_TEXT.spineLabel }}
          data-testid={`${testIdPrefix}-${chartIndex}-${spreadIndex}-pages`}
        >
          {pageLabels.map((label) => (
            <span key={label} className="block min-w-3">
              {label}
            </span>
          ))}
        </div>
      </div>
      <PaperSpineFishtail direction="up" className="mt-3 mb-3" />
      <div
        className="mt-3 leading-none tracking-normal"
        style={{
          ...PAPER_TEXT.spineHall,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
        data-testid={`${testIdPrefix}-${chartIndex}-${spreadIndex}-hall`}
      >
        {hallText}
      </div>
    </aside>
  );
}

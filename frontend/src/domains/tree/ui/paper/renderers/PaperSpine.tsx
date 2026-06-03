import type { TranslateFn } from "../paperData";
import { PAPER_NOTE_FONT_STACK, PAPER_TITLE_FONT_STACK } from "../paperStyles";
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
      className={`-mx-1 h-12 self-stretch bg-[#1f1a14] ${clip} ${className ?? ""}`}
      aria-hidden="true"
    />
  );
}

export function PaperSpine({
  chartIndex,
  spreadIndex,
  title,
  t,
  testIdPrefix,
  pageOrder,
}: {
  chartIndex: number;
  spreadIndex: number;
  title: string;
  t: TranslateFn;
  testIdPrefix: string;
  pageOrder: "ltr" | "rtl";
}) {
  const leftPageLabel = getPaperSpinePageLabel((spreadIndex - 1) * 2 + 1, t);
  const rightPageLabel = getPaperSpinePageLabel((spreadIndex - 1) * 2 + 2, t);
  const volumeLabel = getPaperSpineVolumeLabel(chartIndex, t);
  const pageLabels =
    pageOrder === "ltr" ? [leftPageLabel, rightPageLabel] : [rightPageLabel, leftPageLabel];

  return (
    <aside
      className="relative flex h-[872px] flex-col items-center border-x bg-[#f3e8cc] px-1 py-3"
      style={{
        borderColor: "var(--df-paper-line)",
        color: "var(--df-paper-ink)",
      }}
      data-testid={`${testIdPrefix}-${chartIndex}-${spreadIndex}`}
    >
      <div
        className="text-[31px] font-black leading-none tracking-normal"
        style={{
          fontFamily: PAPER_TITLE_FONT_STACK,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
      >
        {title}
      </div>
      <PaperSpineFishtail direction="down" className="mt-6 mb-3" />
      <div
        className="flex w-full justify-center border-y py-2"
        style={{ borderColor: "var(--df-paper-line-soft)" }}
      >
        <div
          className="grid grid-cols-2 gap-4 text-[13px] font-bold"
          style={{ fontFamily: PAPER_NOTE_FONT_STACK }}
        >
          <span style={{ writingMode: "vertical-rl" }}>{volumeLabel}</span>
          <span style={{ writingMode: "vertical-rl" }}>{volumeLabel}</span>
        </div>
      </div>
      <div
        className="mt-auto flex h-7 w-full items-start justify-center border-b pb-1"
        style={{ borderColor: "var(--df-paper-line-soft)" }}
        aria-label={t("genealogyBook.spinePageNumbers", "page {{left}} / {{right}}", {
          left: leftPageLabel,
          right: rightPageLabel,
        })}
      >
        <div
          className="grid grid-cols-2 gap-4 text-center text-[13px] font-bold leading-none tracking-normal"
          style={{ fontFamily: PAPER_NOTE_FONT_STACK }}
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
        className="mt-3 text-[30px] font-black leading-none tracking-normal"
        style={{
          fontFamily: PAPER_TITLE_FONT_STACK,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
      >
        {t("genealogyBook.ouHallName", "DeepFamily")}
      </div>
    </aside>
  );
}

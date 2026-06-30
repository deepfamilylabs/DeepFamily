import type { CSSProperties, ReactNode } from "react";
import {
  PAPER_BACK_COVER_MODE,
  PAPER_COVER_STYLE,
  type PaperBackCoverMode,
  type PaperCoverStyleId,
} from "../paperAppearance";
import type { PaperGeneration, TranslateFn } from "../paperData";
import { PAPER_LINE, PAPER_SHEET_STYLE, PAPER_TEXT } from "../paperStyles";
import { getPaperSpineTitle, toChineseDigitString, toChineseNumeral } from "../paperText";
import { PaperFrameOverlay } from "./PaperFrameOverlay";

// The cover spread (封面对开页): the book's opening leaf, laid out exactly like a genealogy spread —
// a left page, a center fold and a right page inside one `[data-paper-spread]` — so it shares the
// active 版框/纸纹/配色, the same width, and the same reading order as the body. The cover sits on the
// reading-first page and the matching back cover (封底) on the other, so the book opens and closes
// symmetrically on a single double page. The exporter (which queries every `[data-paper-spread]` in
// DOM order) emits it as page one.
const COVER_PAGE_HEIGHT = 872;
const COVER_SPINE_WIDTH = 72;
const COVER_SLIP_BG = "var(--df-paper-cover-slip-bg, var(--df-paper-panel))";
const COVER_SLIP_BORDER = "var(--df-paper-cover-slip-border, var(--df-paper-line))";
const COVER_SLIP_INK = "var(--df-paper-cover-slip-ink, var(--df-paper-ink))";

// A single full-height cover/back sheet. Its contents choose their own traditional placement.
function CoverPage({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ ...PAPER_SHEET_STYLE, height: COVER_PAGE_HEIGHT }}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

// The bound spine needs enough information to identify the book when it is shelved. Keep it much
// quieter than a body-page 版心: title in the optical center and hall at the foot.
function CoverSpine({
  title,
  hallText,
}: {
  title: string;
  hallText: string;
}) {
  return (
    <aside
      className="relative border-x"
      style={{
        height: COVER_PAGE_HEIGHT,
        width: COVER_SPINE_WIDTH,
        background: "var(--df-paper-spine)",
        borderColor: PAPER_LINE.strong,
        color: "var(--df-paper-ink)",
      }}
      data-testid="paper-cover-spine"
    >
      <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
        <span
          className="leading-none"
          style={{
            ...PAPER_TEXT.spineTitle,
            fontSize: 26,
            letterSpacing: "0.12em",
            writingMode: "vertical-rl",
            textOrientation: "mixed",
          }}
        >
          {title}
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-14 flex justify-center">
        <span
          className="leading-none"
          style={{
            ...PAPER_TEXT.spineLabel,
            writingMode: "vertical-rl",
            textOrientation: "mixed",
          }}
        >
          {hallText}
        </span>
      </div>
    </aside>
  );
}

function BlankCoverSpine() {
  return (
    <aside
      className="border-x"
      style={{
        height: COVER_PAGE_HEIGHT,
        width: COVER_SPINE_WIDTH,
        background: "var(--df-paper-spine)",
        borderColor: PAPER_LINE.strong,
      }}
      data-testid="paper-cover-spine"
      data-visible="false"
      aria-hidden="true"
    />
  );
}

// Traditional thread-bound books carry their identity on one pasted vertical title slip rather
// than scattering a large title, seal and date across the cover. The slip sits toward the fore edge
// (opposite the binding) and contains the title plus smaller hall, volume and optional inscription.
function CoverTitleSlip({
  title,
  hallText,
  volumeText,
  inscription,
  foreEdge,
}: {
  title: string;
  hallText: string;
  volumeText: string;
  inscription?: string;
  foreEdge: "left" | "right";
}) {
  return (
    <section
      className={`absolute top-24 h-[610px] w-[132px] border ${foreEdge === "right" ? "right-24" : "left-24"}`}
      style={{
        backgroundColor: COVER_SLIP_BG,
        borderColor: COVER_SLIP_BORDER,
      }}
      data-testid="paper-cover-title-slip"
    >
      <h1
        className="absolute left-1/2 top-1/2 m-0 -translate-x-1/2 -translate-y-1/2 leading-none"
        style={{
          ...PAPER_TEXT.spineTitle,
          color: COVER_SLIP_INK,
          fontSize: 48,
          letterSpacing: "0.1em",
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
        data-testid="paper-cover-title"
      >
        {title}
      </h1>
      <span
        className="absolute right-4 top-7 leading-none"
        style={
          {
            ...PAPER_TEXT.spineLabel,
            color: COVER_SLIP_INK,
            writingMode: "vertical-rl",
            textOrientation: "mixed",
          } as CSSProperties
        }
        data-testid="paper-cover-hall"
      >
        {hallText}
      </span>
      {inscription ? (
        <span
          className="absolute bottom-7 right-4 leading-none"
          style={
            {
              ...PAPER_TEXT.spineLabel,
              color: COVER_SLIP_INK,
              writingMode: "vertical-rl",
              textOrientation: "mixed",
            } as CSSProperties
          }
          data-testid="paper-cover-inscription"
        >
          {inscription}
        </span>
      ) : null}
      <span
        className="absolute bottom-7 left-4 leading-none"
        style={
          {
            ...PAPER_TEXT.spineLabel,
            color: COVER_SLIP_INK,
            writingMode: "vertical-rl",
            textOrientation: "mixed",
          } as CSSProperties
        }
        data-testid="paper-cover-volume"
      >
        {volumeText}
      </span>
    </section>
  );
}

function CenteredCover({
  title,
  hallText,
  volumeText,
  inscription,
}: {
  title: string;
  hallText: string;
  volumeText: string;
  inscription?: string;
}) {
  return (
    <section className="contents" data-testid="paper-cover-layout-centered-classic">
      <span
        className="absolute right-14 top-14 border px-3 py-5 leading-none"
        style={{
          ...PAPER_TEXT.spineLabel,
          borderColor: PAPER_LINE.strong,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
        data-testid="paper-cover-hall"
      >
        {hallText}
      </span>
      <div className="flex -translate-y-6 flex-col items-center gap-7">
        <h1
          className="m-0 leading-none"
          style={{
            ...PAPER_TEXT.spineTitle,
            fontSize: 60,
            letterSpacing: "0.08em",
            writingMode: "vertical-rl",
            textOrientation: "mixed",
          }}
          data-testid="paper-cover-title"
        >
          {title}
        </h1>
        <span
          className="leading-none"
          style={{
            ...PAPER_TEXT.spineLabel,
            writingMode: "vertical-rl",
            textOrientation: "mixed",
          }}
          data-testid="paper-cover-volume"
        >
          {volumeText}
        </span>
      </div>
      {inscription ? (
        <span
          className="absolute bottom-16 left-1/2 -translate-x-1/2 leading-none"
          style={{
            ...PAPER_TEXT.spineLabel,
            writingMode: "vertical-rl",
            textOrientation: "mixed",
          }}
          data-testid="paper-cover-inscription"
        >
          {inscription}
        </span>
      ) : null}
    </section>
  );
}

function MinimalCover({
  title,
  hallText,
  volumeText,
  inscription,
  foreEdge,
}: {
  title: string;
  hallText: string;
  volumeText: string;
  inscription?: string;
  foreEdge: "left" | "right";
}) {
  return (
    <section
      className={`absolute top-28 h-[520px] w-[94px] border ${foreEdge === "right" ? "right-28" : "left-28"}`}
      style={{ backgroundColor: COVER_SLIP_BG, borderColor: COVER_SLIP_BORDER }}
      data-testid="paper-cover-layout-minimal-thread"
    >
      <h1
        className="absolute left-1/2 top-1/2 m-0 -translate-x-1/2 -translate-y-1/2 leading-none"
        style={{
          ...PAPER_TEXT.spineTitle,
          color: COVER_SLIP_INK,
          fontSize: 40,
          letterSpacing: "0.08em",
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
        data-testid="paper-cover-title"
      >
        {title}
      </h1>
      <span
        className="absolute right-3 top-6 leading-none"
        style={{
          ...PAPER_TEXT.spineLabel,
          color: COVER_SLIP_INK,
          fontSize: 11,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
        data-testid="paper-cover-hall"
      >
        {hallText}
      </span>
      <span
        className="absolute bottom-6 left-3 leading-none"
        style={{
          ...PAPER_TEXT.spineLabel,
          color: COVER_SLIP_INK,
          fontSize: 11,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
        data-testid="paper-cover-volume"
      >
        {volumeText}
      </span>
      {inscription ? (
        <span
          className="absolute bottom-6 right-3 leading-none"
          style={{
            ...PAPER_TEXT.spineLabel,
            color: COVER_SLIP_INK,
            fontSize: 11,
            writingMode: "vertical-rl",
            textOrientation: "mixed",
          }}
          data-testid="paper-cover-inscription"
        >
          {inscription}
        </span>
      ) : null}
    </section>
  );
}

function ArchiveCover({
  title,
  hallText,
  volumeText,
  inscription,
}: {
  title: string;
  hallText: string;
  volumeText: string;
  inscription?: string;
}) {
  return (
    <section
      className="relative h-[620px] w-[240px] border-2"
      style={{
        backgroundColor: COVER_SLIP_BG,
        borderColor: COVER_SLIP_BORDER,
        boxShadow: `inset 0 0 0 6px ${COVER_SLIP_BG}, inset 0 0 0 7px ${COVER_SLIP_BORDER}`,
      }}
      data-testid="paper-cover-layout-archive-frame"
    >
      <h1
        className="absolute left-1/2 top-1/2 m-0 -translate-x-1/2 -translate-y-1/2 leading-none"
        style={{
          ...PAPER_TEXT.spineTitle,
          color: COVER_SLIP_INK,
          fontSize: 52,
          letterSpacing: "0.1em",
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
        data-testid="paper-cover-title"
      >
        {title}
      </h1>
      <span
        className="absolute right-8 top-10 leading-none"
        style={{
          ...PAPER_TEXT.spineLabel,
          color: COVER_SLIP_INK,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
        data-testid="paper-cover-hall"
      >
        {hallText}
      </span>
      <span
        className="absolute bottom-10 left-8 leading-none"
        style={{
          ...PAPER_TEXT.spineLabel,
          color: COVER_SLIP_INK,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
        data-testid="paper-cover-volume"
      >
        {volumeText}
      </span>
      {inscription ? (
        <span
          className="absolute bottom-10 right-8 leading-none"
          style={{
            ...PAPER_TEXT.spineLabel,
            color: COVER_SLIP_INK,
            writingMode: "vertical-rl",
            textOrientation: "mixed",
          }}
          data-testid="paper-cover-inscription"
        >
          {inscription}
        </span>
      ) : null}
    </section>
  );
}

// 牌记 — a compact ruled block for the back cover: the hall's 编印 line (main, larger) and the
// compilation year read as vertical columns from right to left.
function Colophon({
  yearText,
  holderText,
  testId,
}: {
  yearText: string;
  holderText: string;
  testId: string;
}) {
  return (
    <div
      className="flex min-h-[230px] min-w-[124px] flex-row-reverse items-center justify-center gap-6 border px-7 py-9"
      style={{ borderColor: PAPER_LINE.strong }}
      data-testid={testId}
    >
      {[yearText, holderText].map((text, index) => (
        <span
          key={text}
          style={
            {
              ...(index === 1 ? PAPER_TEXT.spineHall : PAPER_TEXT.spineLabel),
              writingMode: "vertical-rl",
              textOrientation: "mixed",
            } as CSSProperties
          }
        >
          {text}
        </span>
      ))}
    </div>
  );
}

function CenteredBackCover({ yearText, holderText }: { yearText: string; holderText: string }) {
  return (
    <div
      className="flex flex-row-reverse items-center justify-center gap-9"
      data-testid="paper-back-cover-colophon"
    >
      <span
        style={{
          ...PAPER_TEXT.spineHall,
          fontSize: 26,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
      >
        {holderText}
      </span>
      <span
        style={{
          ...PAPER_TEXT.spineLabel,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
      >
        {yearText}
      </span>
    </div>
  );
}

function ArchiveBackCover({
  title,
  yearText,
  holderText,
  volumeText,
}: {
  title: string;
  yearText: string;
  holderText: string;
  volumeText: string;
}) {
  return (
    <div
      className="flex min-h-[390px] min-w-[240px] flex-row-reverse items-center justify-center gap-8 border-2 px-10 py-12"
      style={{
        backgroundColor: COVER_SLIP_BG,
        borderColor: COVER_SLIP_BORDER,
        boxShadow: `inset 0 0 0 6px ${COVER_SLIP_BG}, inset 0 0 0 7px ${COVER_SLIP_BORDER}`,
      }}
      data-testid="paper-back-cover-colophon"
    >
      {[title, holderText, yearText, volumeText].map((text, index) => (
        <span
          key={`${index}-${text}`}
          style={{
            ...(index === 0 ? PAPER_TEXT.spineTitle : PAPER_TEXT.spineLabel),
            color: COVER_SLIP_INK,
            fontSize: index === 0 ? 25 : undefined,
            writingMode: "vertical-rl",
            textOrientation: "mixed",
          }}
        >
          {text}
        </span>
      ))}
    </div>
  );
}

function resolveHallText(hallName: string | undefined, t: TranslateFn): string {
  return hallName?.trim() || t("genealogyBook.ouHallName", "DeepFamily");
}

function resolveColophonYear(t: TranslateFn, year: number): string {
  return t("genealogyBook.cover.colophonYear", "{{year}}", {
    year,
    hanYear: toChineseDigitString(year),
  });
}

function resolveColophonHolder(hallText: string, t: TranslateFn): string {
  return t("genealogyBook.cover.colophonHolder", "Revised by {{hall}}", { hall: hallText });
}

function SpreadShell({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div
      className="relative grid min-w-[1180px] grid-cols-[1fr_72px_1fr] border"
      style={{
        borderColor: PAPER_LINE.strong,
        borderWidth: "var(--df-paper-frame-outer)",
        background: "var(--df-paper-sheet)",
        paddingBlock: "var(--df-paper-frame-pad-tb)",
        paddingInline: "var(--df-paper-frame-pad-lr)",
      }}
      data-paper-spread=""
      data-testid={testId}
    >
      <PaperFrameOverlay />
      {children}
    </div>
  );
}

export function PaperCover({
  generations,
  spineTitleOverride,
  hallName,
  inscription,
  volumeCount = 1,
  pageOrder = "rtl",
  coverStyleId = PAPER_COVER_STYLE.TRADITIONAL,
  backCoverMode = PAPER_BACK_COVER_MODE.MATCHED,
  showCoverSpine = true,
  t,
}: {
  generations: PaperGeneration[];
  // Same override the spine/renderers use; blank falls back to the auto-generated genealogy title.
  spineTitleOverride?: string;
  // User hall name (堂号); blank falls back to the default i18n hall name.
  hallName?: string;
  // Optional custom inscription (落款/副标题) placed inside the title slip.
  inscription?: string;
  // Total volume (卷) count after the active style's pagination, shown on the title slip.
  volumeCount?: number;
  // Reading order, matching the body. "rtl" (traditional) puts the cover on the right page.
  pageOrder?: "ltr" | "rtl";
  coverStyleId?: PaperCoverStyleId;
  backCoverMode?: PaperBackCoverMode;
  showCoverSpine?: boolean;
  t: TranslateFn;
}) {
  const title = spineTitleOverride?.trim() || getPaperSpineTitle(generations, t);
  const hallText = resolveHallText(hallName, t);
  const colophonYear = resolveColophonYear(t, new Date().getFullYear());
  const inscriptionText = inscription?.trim();
  const volumeText = t("genealogyBook.cover.volumeCount", "{{count}} Volumes", {
    count: volumeCount,
    han: toChineseNumeral(volumeCount),
  });

  const foreEdge = pageOrder === "rtl" ? "right" : "left";
  let coverContent: ReactNode;
  switch (coverStyleId) {
    case PAPER_COVER_STYLE.CENTERED:
      coverContent = (
        <CenteredCover
          title={title}
          hallText={hallText}
          volumeText={volumeText}
          inscription={inscriptionText}
        />
      );
      break;
    case PAPER_COVER_STYLE.MINIMAL:
      coverContent = (
        <MinimalCover
          title={title}
          hallText={hallText}
          volumeText={volumeText}
          inscription={inscriptionText}
          foreEdge={foreEdge}
        />
      );
      break;
    case PAPER_COVER_STYLE.ARCHIVE:
      coverContent = (
        <ArchiveCover
          title={title}
          hallText={hallText}
          volumeText={volumeText}
          inscription={inscriptionText}
        />
      );
      break;
    default:
      coverContent = (
        <div className="contents" data-testid="paper-cover-layout-traditional-slip">
          <CoverTitleSlip
            title={title}
            hallText={hallText}
            volumeText={volumeText}
            inscription={inscriptionText}
            foreEdge={foreEdge}
          />
        </div>
      );
  }

  const coverPage = <CoverPage testId="paper-cover">{coverContent}</CoverPage>;

  let backCoverContent: ReactNode = null;
  if (backCoverMode === PAPER_BACK_COVER_MODE.MATCHED) {
    switch (coverStyleId) {
      case PAPER_COVER_STYLE.CENTERED:
        backCoverContent = (
          <CenteredBackCover
            yearText={colophonYear}
            holderText={resolveColophonHolder(hallText, t)}
          />
        );
        break;
      case PAPER_COVER_STYLE.MINIMAL:
        backCoverContent = null;
        break;
      case PAPER_COVER_STYLE.ARCHIVE:
        backCoverContent = (
          <ArchiveBackCover
            title={title}
            yearText={colophonYear}
            holderText={resolveColophonHolder(hallText, t)}
            volumeText={volumeText}
          />
        );
        break;
      default:
        backCoverContent = (
          <Colophon
            yearText={colophonYear}
            holderText={resolveColophonHolder(hallText, t)}
            testId="paper-back-cover-colophon"
          />
        );
    }
  }
  // Keep the back cover in the printable cover spread with only the compact publication plaque;
  // 谱终 is a body-text end mark and does not belong on the outer cover.
  const backPage = (
    <CoverPage testId="paper-back-cover">{backCoverContent}</CoverPage>
  );
  // RTL (traditional) reads the right page first, so the cover sits on the right and the back cover
  // on the left; LTR mirrors it.
  const [leftPage, rightPage] = pageOrder === "rtl" ? [backPage, coverPage] : [coverPage, backPage];

  return (
    <SpreadShell testId="paper-cover-spread">
      {leftPage}
      {showCoverSpine ? (
        <CoverSpine title={title} hallText={hallText} />
      ) : (
        <BlankCoverSpine />
      )}
      {rightPage}
    </SpreadShell>
  );
}

export default PaperCover;

import type { CSSProperties } from "react";

export const PAPER_BODY_FONT_STACK =
  '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", "SimSun", "PMingLiU", Georgia, serif';
export const PAPER_TITLE_FONT_STACK =
  '"STKaiti", "KaiTi", "Kaiti SC", "Songti SC", "STSong", "Noto Serif CJK SC", serif';
export const PAPER_NOTE_FONT_STACK =
  '"FangSong", "STFangsong", "FangSong_GB2312", "Songti SC", "SimSun", serif';

export const PAPER_VARS = {
  "--df-paper-bg": "#e6d6ad",
  "--df-paper-sheet": "#f7efd8",
  "--df-paper-panel": "#fbf6e8",
  "--df-paper-line": "#8a6a3b",
  "--df-paper-line-soft": "rgba(138, 106, 59, 0.32)",
  "--df-paper-line-tint": "rgba(138, 106, 59, 0.07)",
  "--df-paper-ink": "#332414",
  "--df-paper-muted": "#755f3c",
  "--df-paper-red": "#9b2f25",
} as CSSProperties;

export const PAPER_SHEET_STYLE: CSSProperties = {
  backgroundColor: "var(--df-paper-sheet)",
  backgroundImage:
    "linear-gradient(90deg, rgba(138, 106, 59, 0.045) 1px, transparent 1px), linear-gradient(0deg, rgba(138, 106, 59, 0.035) 1px, transparent 1px)",
  backgroundSize: "28px 28px",
};

// Generation-mark tab colors: a black woodblock tab with light ink, shared by every style.
export const PAPER_MARK_BG = "#1f1a14";
export const PAPER_MARK_FG = "#f7efd8";

// Single source of truth for line/divider colors, keyed by semantic weight. `strong` frames the
// structure (outer/page frames, SVG connectors, the Modern ledger grid); `soft` is every in-page
// divider/separator (lane & cell dividers, generation/row separators, section/spine dividers);
// `tint` is a faint background wash (Ou generation column). Customizing a weight is a one-line
// edit here (or its `--df-paper-line*` var in PAPER_VARS).
export const PAPER_LINE = {
  strong: "var(--df-paper-line)",
  soft: "var(--df-paper-line-soft)",
  tint: "var(--df-paper-line-tint)",
} as const;

export type PaperLineWeight = keyof typeof PAPER_LINE;

// Single source of truth for paper-genealogy text size/weight/color/font, keyed by semantic
// role. Every style renderer (Su/Ou/Pagoda/Lineage/Modern) and the shared spine consume these
// so the look stays consistent and customizing a role's size or color is a one-line edit here.
// Tokens carry only the customizable typography (plus body line-height); layout properties
// (writingMode, textAlign, letterSpacing, leading-*, tracking-*) stay at each call site.
export const PAPER_TEXT = {
  // Person content
  name: {
    fontSize: 19,
    fontWeight: 700,
    color: "var(--df-paper-ink)",
    fontFamily: PAPER_TITLE_FONT_STACK,
  },
  relation: {
    fontSize: 13,
    fontWeight: 400,
    color: "var(--df-paper-muted)",
    fontFamily: PAPER_NOTE_FONT_STACK,
  },
  body: {
    fontSize: 13,
    fontWeight: 400,
    color: "var(--df-paper-muted)",
    fontFamily: PAPER_NOTE_FONT_STACK,
    lineHeight: 1.55,
  },
  femaleMark: {
    fontSize: 11,
    fontWeight: 400,
    color: "var(--df-paper-ink)",
    fontFamily: PAPER_TITLE_FONT_STACK,
  },
  // Structural marks
  generationMark: {
    fontSize: 15,
    fontWeight: 700,
    color: PAPER_MARK_FG,
    fontFamily: PAPER_TITLE_FONT_STACK,
  },
  tag: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--df-paper-red)",
    fontFamily: PAPER_NOTE_FONT_STACK,
  },
  // Modern ledger headers (keep their distinctive large size; centralized only)
  generationRow: {
    fontSize: 24,
    fontWeight: 900,
    color: "var(--df-paper-ink)",
    fontFamily: PAPER_TITLE_FONT_STACK,
  },
  tableHeader: {
    fontSize: 18,
    fontWeight: 900,
    color: "var(--df-paper-ink)",
    fontFamily: PAPER_TITLE_FONT_STACK,
  },
  // Section header shared by every style
  sectionTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--df-paper-ink)",
    fontFamily: PAPER_TITLE_FONT_STACK,
  },
  sectionRule: {
    fontSize: 14,
    fontWeight: 700,
    color: "var(--df-paper-red)",
    fontFamily: PAPER_BODY_FONT_STACK,
  },
  // Spine (PaperSpine, shared)
  spineTitle: {
    fontSize: 31,
    fontWeight: 900,
    color: "var(--df-paper-ink)",
    fontFamily: PAPER_TITLE_FONT_STACK,
  },
  spineHall: {
    fontSize: 30,
    fontWeight: 900,
    color: "var(--df-paper-ink)",
    fontFamily: PAPER_TITLE_FONT_STACK,
  },
  spineLabel: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--df-paper-ink)",
    fontFamily: PAPER_NOTE_FONT_STACK,
  },
} as const satisfies Record<string, CSSProperties>;

export type PaperTextRole = keyof typeof PAPER_TEXT;

// SVG <text> needs `fill` instead of `color`; map a role token accordingly.
export function paperSvgTextStyle(role: PaperTextRole): CSSProperties {
  const { color, ...rest } = PAPER_TEXT[role];
  return { ...rest, fill: color };
}

import type { CSSProperties } from "react";

export const PAPER_BODY_FONT_STACK =
  '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", "SimSun", "AR PL UMing CN", "PMingLiU", Georgia, serif';
// Kaiti title stack. List real kaiti family names for every OS FIRST (macOS/Windows/Linux + the
// cross-platform open-source LXGW WenKai) so a system that HAS a kaiti renders it; only after every
// kaiti option fall back to a CJK serif (song) then generic serif. Previously the song fallback sat
// ahead of the only Linux kaiti (AR PL UKai), so kaiti was never used there and "Kaiti" looked
// identical to "Song". Keep AR PL UKai variants high since they are the common Linux kaiti.
export const PAPER_TITLE_FONT_STACK =
  '"STKaiti", "KaiTi", "Kaiti SC", "Kaiti TC", "BiauKai", "DFKai-SB", "标楷体", "楷体", "楷体_GB2312", "KaiTi_GB2312", "TW-Kai", "AR PL UKai CN", "AR PL UKai TW", "AR PL UKai HK", "AR PL KaitiM GB", "LXGW WenKai", "霞鹜文楷", "Noto Serif CJK SC", serif';
export const PAPER_NOTE_FONT_STACK =
  '"FangSong", "STFangsong", "FangSong_GB2312", "仿宋", "仿宋_GB2312", "Songti SC", "SimSun", "AR PL UMing CN", "Noto Serif CJK SC", serif';
// Ou records use Tailwind's px-2.5 spacing. Keep the numeric value shared so absolute-layout
// renderers can reserve the same visual distance from the spine without changing pagination.
export const PAPER_RECORD_INLINE_PADDING = 10;

// Sheet grid background, expressed via theme/texture vars so a color theme can re-tint the grid
// lines (--df-paper-grid-*) and a texture preset can change density (--df-paper-sheet-size) or
// remove it entirely (--df-paper-sheet-image: none). Nested var() resolves at paint time.
const PAPER_SHEET_GRID_IMAGE =
  "linear-gradient(90deg, var(--df-paper-grid-major) 1px, transparent 1px), linear-gradient(0deg, var(--df-paper-grid-minor) 1px, transparent 1px)";

// Default color theme (宣纸 / warm aged paper). Color themes in paperAppearance override this whole
// set; keeping it here as the single default lets PAPER_VARS and the "xuan" theme share one source.
export const PAPER_COLOR_VARS_XUAN: Record<string, string> = {
  "--df-paper-bg": "#e6d6ad",
  "--df-paper-sheet": "#f7efd8",
  "--df-paper-panel": "#fbf6e8",
  "--df-paper-spine": "#f3e8cc",
  "--df-paper-line": "#8a6a3b",
  "--df-paper-line-soft": "rgba(138, 106, 59, 0.32)",
  "--df-paper-line-tint": "rgba(138, 106, 59, 0.07)",
  "--df-paper-line-accent": "#c18070",
  "--df-paper-ink": "#332414",
  "--df-paper-muted": "#755f3c",
  "--df-paper-red": "#9b2f25",
  "--df-paper-grid-major": "rgba(138, 106, 59, 0.045)",
  "--df-paper-grid-minor": "rgba(138, 106, 59, 0.035)",
};

// Default font preset (classical): kaiti titles, serif body, fangsong notes. Font presets in
// paperAppearance override these three vars so every PAPER_TEXT role re-points to the chosen stack.
export const PAPER_FONT_VARS_DEFAULT: Record<string, string> = {
  "--df-paper-font-title": PAPER_TITLE_FONT_STACK,
  "--df-paper-font-body": PAPER_BODY_FONT_STACK,
  "--df-paper-font-note": PAPER_NOTE_FONT_STACK,
};

// Default texture (subtle grid). Texture presets in paperAppearance override these two vars to
// change grid density or turn the sheet pattern off.
export const PAPER_TEXTURE_VARS_DEFAULT: Record<string, string> = {
  "--df-paper-sheet-image": PAPER_SHEET_GRID_IMAGE,
  "--df-paper-sheet-size": "28px 28px",
};

// Default version-frame (版框) geometry: a single thin rule. The OUTER line is each leaf's own
// border (width = --df-paper-frame-outer). A multi-line frame reserves a blank gap INSIDE the leaf
// via --df-paper-frame-pad-* (applied as the spread's padding); the optional INNER line is drawn by
// PaperFrameOverlay at exactly that padding offset, so it lands on the content edge and closes with
// the page's own dividers while the reserved gap sits between the inner and outer lines. The inner
// widths are per-axis so a preset can enable the second line on all four sides (四周双边/文武边) or
// left/right only (左右双边). Border-style presets in paperAppearance override these; the default
// keeps the inner line off and reserves no gap (a plain single frame, identical to the original).
export const PAPER_FRAME_VARS_DEFAULT: Record<string, string> = {
  "--df-paper-frame-outer": "1px",
  "--df-paper-frame-inner-tb": "0px",
  "--df-paper-frame-inner-lr": "0px",
  "--df-paper-frame-pad-tb": "0px",
  "--df-paper-frame-pad-lr": "0px",
};

// Full default variable set (xuan colors + classical fonts + subtle texture). Every paper renderer
// roots its subtree with these vars; paperAppearance.buildPaperVars produces theme-swapped variants
// with the same shape. Kept exported so non-themed call sites (export fallback) stay correct.
export const PAPER_VARS = {
  ...PAPER_COLOR_VARS_XUAN,
  ...PAPER_FONT_VARS_DEFAULT,
  ...PAPER_TEXTURE_VARS_DEFAULT,
  ...PAPER_FRAME_VARS_DEFAULT,
} as CSSProperties;

export const PAPER_SHEET_STYLE: CSSProperties = {
  backgroundColor: "var(--df-paper-sheet)",
  backgroundImage: "var(--df-paper-sheet-image)",
  backgroundSize: "var(--df-paper-sheet-size)",
};

// Generation-mark tab colors: a black woodblock tab with light ink, shared by every style/theme.
export const PAPER_MARK_BG = "#1f1a14";
export const PAPER_MARK_FG = "#f7efd8";

// Single source of truth for line/divider colors, keyed by semantic weight. `strong` frames the
// structure (outer/page frames, SVG connectors, the Modern ledger grid); `soft` is every in-page
// divider/separator (lane & cell dividers, generation/row separators, section/spine dividers);
// `tint` is a faint background wash (Ou generation column); `accent` is the pale-red ink used by
// relationship lines that need visual distinction. Customizing a weight is a one-line edit here
// (or its `--df-paper-line*` var in PAPER_VARS).
export const PAPER_LINE = {
  strong: "var(--df-paper-line)",
  soft: "var(--df-paper-line-soft)",
  tint: "var(--df-paper-line-tint)",
  accent: "var(--df-paper-line-accent)",
} as const;

export type PaperLineWeight = keyof typeof PAPER_LINE;

// Single source of truth for paper-genealogy text size/weight/color/font, keyed by semantic
// role. Every paper style renderer and the shared spine consume these
// so the look stays consistent and customizing a role's size or color is a one-line edit here.
// Tokens carry only the customizable typography (plus body line-height); layout properties
// (writingMode, textAlign, letterSpacing, leading-*, tracking-*) stay at each call site. Font
// families resolve through --df-paper-font-* so a font preset re-points every role at once.
export const PAPER_TEXT = {
  // Person content
  name: {
    fontSize: 19,
    fontWeight: 700,
    color: "var(--df-paper-ink)",
    fontFamily: "var(--df-paper-font-title)",
  },
  relation: {
    fontSize: 13,
    fontWeight: 400,
    color: "var(--df-paper-muted)",
    fontFamily: "var(--df-paper-font-note)",
  },
  body: {
    fontSize: 13,
    fontWeight: 400,
    color: "var(--df-paper-muted)",
    fontFamily: "var(--df-paper-font-note)",
    lineHeight: 1.55,
  },
  femaleMark: {
    fontSize: 11,
    fontWeight: 400,
    color: "var(--df-paper-ink)",
    fontFamily: "var(--df-paper-font-title)",
  },
  // Structural marks
  generationMark: {
    fontSize: 15,
    fontWeight: 700,
    color: PAPER_MARK_FG,
    fontFamily: "var(--df-paper-font-title)",
  },
  tag: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--df-paper-red)",
    fontFamily: "var(--df-paper-font-note)",
  },
  // Modern ledger headers (keep their distinctive large size; centralized only)
  generationRow: {
    fontSize: 24,
    fontWeight: 900,
    color: "var(--df-paper-ink)",
    fontFamily: "var(--df-paper-font-title)",
  },
  tableHeader: {
    fontSize: 18,
    fontWeight: 900,
    color: "var(--df-paper-ink)",
    fontFamily: "var(--df-paper-font-title)",
  },
  // Section header shared by every style
  sectionTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--df-paper-ink)",
    fontFamily: "var(--df-paper-font-title)",
  },
  sectionRule: {
    fontSize: 14,
    fontWeight: 700,
    color: "var(--df-paper-red)",
    fontFamily: "var(--df-paper-font-body)",
  },
  // Spine (PaperSpine, shared)
  spineTitle: {
    fontSize: 31,
    fontWeight: 900,
    color: "var(--df-paper-ink)",
    fontFamily: "var(--df-paper-font-title)",
  },
  spineHall: {
    fontSize: 30,
    fontWeight: 900,
    color: "var(--df-paper-ink)",
    fontFamily: "var(--df-paper-font-title)",
  },
  spineLabel: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--df-paper-ink)",
    fontFamily: "var(--df-paper-font-note)",
  },
} as const satisfies Record<string, CSSProperties>;

export type PaperTextRole = keyof typeof PAPER_TEXT;

// SVG <text> needs `fill` instead of `color`; map a role token accordingly.
export function paperSvgTextStyle(role: PaperTextRole): CSSProperties {
  const { color, ...rest } = PAPER_TEXT[role];
  return { ...rest, fill: color };
}

// ---- Preview font scale (whole-sheet zoom) ------------------------------------------------------
// Matches the renderer content column `max-w-[1320px]`. Spreads inside are min-w-[1180px].

export const PAPER_PREVIEW_MAX_WIDTH_PX = 1320;

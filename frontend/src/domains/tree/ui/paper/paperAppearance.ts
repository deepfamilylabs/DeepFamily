import type { CSSProperties } from "react";
import {
  PAPER_BODY_FONT_STACK,
  PAPER_COLOR_VARS_XUAN,
  PAPER_FRAME_VARS_DEFAULT,
  PAPER_LISHU_FONT_STACK,
  PAPER_TEXTURE_VARS_DEFAULT,
  PAPER_TITLE_FONT_STACK,
  PAPER_VARS,
} from "./paperStyles";

// Paper appearance = the user-tunable look of every paper-genealogy style: a color theme, a font
// preset, a texture level and an optional hall name (堂号). Each preset is just a set of
// --df-paper-* CSS variables, so applying one is a single style swap on each renderer root; nothing
// in the layout/structure changes. Settings are global (shared by every genealogy), unlike the
// per-root spine title.

const PAPER_SANS_FONT_STACK =
  '"Source Han Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", "Heiti SC", sans-serif';

// ---- Color themes -----------------------------------------------------------------------------

export const PAPER_COLOR_THEME = {
  XUAN: "xuan",
  PLAIN: "plain",
  BAMBOO: "bamboo",
  AZURE: "azure",
  VERMILION: "vermilion",
  OCHRE: "ochre",
  INDIGO: "indigo",
  SUMI: "sumi",
  RUBBING: "rubbing",
  IMPERIAL: "imperial",
} as const;

export type PaperColorThemeId = (typeof PAPER_COLOR_THEME)[keyof typeof PAPER_COLOR_THEME];

// Each theme is a full color-variable set so switching fully replaces the previous palette. The
// woodblock generation-mark tab (--df-paper-mark-*) keeps its base dark-on-light look for every
// light theme and is only overridden where a theme needs it (the dark 磁青 theme inverts it).
export const PAPER_COLOR_THEMES: Record<PaperColorThemeId, Record<string, string>> = {
  xuan: PAPER_COLOR_VARS_XUAN,
  // 素白: a clean, faintly cool neutral. Whites and grays now share one cool-neutral hue
  // (rgb ≈ 94/102/110) so the sheet no longer reads warm against the cool ink; the fish-tail tab is
  // a matching cool near-black. The accent stays a restrained brick so relationship lines read.
  plain: {
    "--df-paper-bg": "#d7dade",
    "--df-paper-sheet": "#fafbfc",
    "--df-paper-panel": "#ffffff",
    "--df-paper-spine": "#eceef1",
    "--df-paper-line": "#767c82",
    "--df-paper-line-soft": "rgba(94, 102, 110, 0.30)",
    "--df-paper-line-tint": "rgba(94, 102, 110, 0.06)",
    "--df-paper-line-accent": "#a06b63",
    "--df-paper-ink": "#23272c",
    "--df-paper-muted": "#59616a",
    "--df-paper-red": "#9b2f25",
    "--df-paper-mark-bg": "#1c1f23",
    "--df-paper-mark-fg": "#f1f3f5",
    "--df-paper-grid-major": "rgba(94, 102, 110, 0.05)",
    "--df-paper-grid-minor": "rgba(94, 102, 110, 0.04)",
  },
  // 竹青: a unified sage-green. All green tones share one hue (rgb ≈ 90/120/80); the accent is
  // pulled from olive toward a lighter sage so it harmonizes with the line instead of muddying it,
  // and the fish-tail tab is a deep green-black matching the ink.
  bamboo: {
    "--df-paper-bg": "#c5d4bb",
    "--df-paper-sheet": "#edf2e6",
    "--df-paper-panel": "#f5f9ef",
    "--df-paper-spine": "#dde7d1",
    "--df-paper-line": "#5a7850",
    "--df-paper-line-soft": "rgba(90, 120, 80, 0.32)",
    "--df-paper-line-tint": "rgba(90, 120, 80, 0.07)",
    "--df-paper-line-accent": "#84a06a",
    "--df-paper-ink": "#233021",
    "--df-paper-muted": "#4d6245",
    "--df-paper-red": "#9b2f25",
    "--df-paper-mark-bg": "#1b261a",
    "--df-paper-mark-fg": "#edf2e6",
    "--df-paper-grid-major": "rgba(90, 120, 80, 0.05)",
    "--df-paper-grid-minor": "rgba(90, 120, 80, 0.04)",
  },
  // 瓷青: shifted from a teal-leaning blue toward a cleaner 青花瓷 cobalt (less green in the line),
  // with whites/grays cooled to match and the fish-tail tab set to a deep blue-black matching the
  // ink, so the whole palette reads as one porcelain blue.
  azure: {
    "--df-paper-bg": "#bfd0d8",
    "--df-paper-sheet": "#e8eef2",
    "--df-paper-panel": "#f1f6f9",
    "--df-paper-spine": "#d3dfe6",
    "--df-paper-line": "#3a5f76",
    "--df-paper-line-soft": "rgba(58, 95, 118, 0.32)",
    "--df-paper-line-tint": "rgba(58, 95, 118, 0.07)",
    "--df-paper-line-accent": "#6b91a6",
    "--df-paper-ink": "#1c2a33",
    "--df-paper-muted": "#416070",
    "--df-paper-red": "#9b2f25",
    "--df-paper-mark-bg": "#14222c",
    "--df-paper-mark-fg": "#e8eef2",
    "--df-paper-grid-major": "rgba(58, 95, 118, 0.05)",
    "--df-paper-grid-minor": "rgba(58, 95, 118, 0.04)",
  },
  // 朱丝栏: cream antique sheet with red column rules (the historical 朱丝栏 manuscript look). Ink
  // stays a deep brown so records remain readable against the red ruling.
  vermilion: {
    "--df-paper-bg": "#e8dcc0",
    "--df-paper-sheet": "#f8f1de",
    "--df-paper-panel": "#fcf8ec",
    "--df-paper-spine": "#f1e7cf",
    "--df-paper-line": "#b23a2e",
    "--df-paper-line-soft": "rgba(178, 58, 46, 0.30)",
    "--df-paper-line-tint": "rgba(178, 58, 46, 0.06)",
    "--df-paper-line-accent": "#c0603f",
    "--df-paper-ink": "#2e211a",
    "--df-paper-muted": "#6f5a45",
    "--df-paper-red": "#9b2f25",
    "--df-paper-grid-major": "rgba(178, 58, 46, 0.045)",
    "--df-paper-grid-minor": "rgba(178, 58, 46, 0.035)",
  },
  // 茶褐做旧: a deeper, aged tea-brown variant of xuan for a heavier "antiqued" feel.
  ochre: {
    "--df-paper-bg": "#d8c4a0",
    "--df-paper-sheet": "#efe2c8",
    "--df-paper-panel": "#f5ecd9",
    "--df-paper-spine": "#e7d8b8",
    "--df-paper-line": "#6e4a2a",
    "--df-paper-line-soft": "rgba(110, 74, 42, 0.32)",
    "--df-paper-line-tint": "rgba(110, 74, 42, 0.08)",
    "--df-paper-line-accent": "#a8744a",
    "--df-paper-ink": "#2c1d10",
    "--df-paper-muted": "#6c5235",
    "--df-paper-red": "#9b2f25",
    "--df-paper-grid-major": "rgba(110, 74, 42, 0.05)",
    "--df-paper-grid-minor": "rgba(110, 74, 42, 0.04)",
  },
  // 磁青描金: a reversed (dark-on-light → light-on-dark) palette mirroring 磁青纸金书 古籍 — a deep
  // indigo sheet with gold column rules and pale gold ink. The seal red is brightened so it stays
  // legible on the dark ground. The generation-mark tab is inverted to a gold woodblock with dark
  // ink (--df-paper-mark-*) so it reads as part of the gilt theme instead of a stray black block.
  indigo: {
    "--df-paper-bg": "#1d2a3a",
    "--df-paper-sheet": "#25344a",
    "--df-paper-panel": "#2c3d56",
    "--df-paper-spine": "#223044",
    "--df-paper-line": "#b8a06a",
    "--df-paper-line-soft": "rgba(184, 160, 106, 0.35)",
    "--df-paper-line-tint": "rgba(184, 160, 106, 0.10)",
    "--df-paper-line-accent": "#c9b078",
    "--df-paper-ink": "#ece3cf",
    "--df-paper-muted": "#b6a886",
    "--df-paper-red": "#d4564a",
    "--df-paper-mark-bg": "#c9b078",
    "--df-paper-mark-fg": "#1d2a3a",
    "--df-paper-grid-major": "rgba(184, 160, 106, 0.06)",
    "--df-paper-grid-minor": "rgba(184, 160, 106, 0.045)",
  },
  // 乌丝栏: bright white sheet with crisp charcoal column rules and dark ink — the classical
  // companion to 朱丝栏 (vermilion). Higher-contrast than `plain`, whose rules are a soft warm gray.
  sumi: {
    "--df-paper-bg": "#d9dad6",
    "--df-paper-sheet": "#fcfcfa",
    "--df-paper-panel": "#ffffff",
    "--df-paper-spine": "#f1f1ee",
    "--df-paper-line": "#2c2c2a",
    "--df-paper-line-soft": "rgba(40, 40, 38, 0.30)",
    "--df-paper-line-tint": "rgba(40, 40, 38, 0.05)",
    "--df-paper-line-accent": "#9c6f64",
    "--df-paper-ink": "#1a1a18",
    "--df-paper-muted": "#4a4a47",
    "--df-paper-red": "#9b2f25",
    "--df-paper-grid-major": "rgba(40, 40, 38, 0.05)",
    "--df-paper-grid-minor": "rgba(40, 40, 38, 0.04)",
  },
  // 碑拓: a stone-rubbing palette — near-black ground with pale stone-white column rules and rubbing-
  // white ink. A second dark theme with a cold金石 feel (vs the gilt 磁青). Seal red is brightened
  // and the generation-mark tab is inverted to a light tab with dark ink so it reads on the black.
  rubbing: {
    "--df-paper-bg": "#121212",
    "--df-paper-sheet": "#1c1c1b",
    "--df-paper-panel": "#232322",
    "--df-paper-spine": "#181817",
    "--df-paper-line": "#cfcabf",
    "--df-paper-line-soft": "rgba(207, 202, 191, 0.30)",
    "--df-paper-line-tint": "rgba(207, 202, 191, 0.08)",
    "--df-paper-line-accent": "#c98b73",
    "--df-paper-ink": "#ece9e1",
    "--df-paper-muted": "#b7b2a7",
    "--df-paper-red": "#d4564a",
    "--df-paper-mark-bg": "#cfcabf",
    "--df-paper-mark-fg": "#1c1c1b",
    "--df-paper-grid-major": "rgba(207, 202, 191, 0.05)",
    "--df-paper-grid-minor": "rgba(207, 202, 191, 0.04)",
  },
  // 明黄: a bright, saturated imperial-yellow sheet with deep gold-brown rules and dark brown ink.
  // More vivid/golden than `xuan` (a muted cream) and warmer than `ochre` (a brown tea tone).
  imperial: {
    "--df-paper-bg": "#e8c860",
    "--df-paper-sheet": "#f9e7a8",
    "--df-paper-panel": "#fcf0c2",
    "--df-paper-spine": "#f2dd92",
    "--df-paper-line": "#9c6b1f",
    "--df-paper-line-soft": "rgba(156, 107, 31, 0.32)",
    "--df-paper-line-tint": "rgba(156, 107, 31, 0.08)",
    "--df-paper-line-accent": "#c08a3c",
    "--df-paper-ink": "#3a2a0e",
    "--df-paper-muted": "#7a5c22",
    "--df-paper-red": "#9b2f25",
    "--df-paper-grid-major": "rgba(156, 107, 31, 0.05)",
    "--df-paper-grid-minor": "rgba(156, 107, 31, 0.04)",
  },
};

export const PAPER_COLOR_THEME_IDS = Object.keys(PAPER_COLOR_THEMES) as PaperColorThemeId[];

// Three representative colors (sheet / line / seal-red) for rendering a theme swatch in the UI.
export function getPaperColorThemeSwatch(id: PaperColorThemeId): [string, string, string] {
  const theme = PAPER_COLOR_THEMES[id];
  return [theme["--df-paper-sheet"], theme["--df-paper-line"], theme["--df-paper-line-accent"]];
}

// ---- Font presets -----------------------------------------------------------------------------

export const PAPER_FONT_PRESET = {
  CLASSIC: "classic",
  SONG: "song",
  LISHU: "lishu",
  SANS: "sans",
} as const;

export type PaperFontPresetId = (typeof PAPER_FONT_PRESET)[keyof typeof PAPER_FONT_PRESET];

// Each preset unifies all three font roles (title/body/note) on one family so switching a preset
// restyles the whole page — names, biographies AND relationship/tag annotations. The lishu preset
// points every role at the lishu stack (PAPER_LISHU_FONT_STACK), which renders clerical wherever a
// 隶书 font is available and falls back to song only for glyphs no 隶书 covers.
export const PAPER_FONT_PRESETS: Record<PaperFontPresetId, Record<string, string>> = {
  classic: {
    "--df-paper-font-title": PAPER_TITLE_FONT_STACK,
    "--df-paper-font-body": PAPER_TITLE_FONT_STACK,
    "--df-paper-font-note": PAPER_TITLE_FONT_STACK,
  },
  song: {
    "--df-paper-font-title": PAPER_BODY_FONT_STACK,
    "--df-paper-font-body": PAPER_BODY_FONT_STACK,
    "--df-paper-font-note": PAPER_BODY_FONT_STACK,
  },
  lishu: {
    "--df-paper-font-title": PAPER_LISHU_FONT_STACK,
    "--df-paper-font-body": PAPER_LISHU_FONT_STACK,
    "--df-paper-font-note": PAPER_LISHU_FONT_STACK,
  },
  sans: {
    "--df-paper-font-title": PAPER_SANS_FONT_STACK,
    "--df-paper-font-body": PAPER_SANS_FONT_STACK,
    "--df-paper-font-note": PAPER_SANS_FONT_STACK,
  },
};

export const PAPER_FONT_PRESET_IDS = Object.keys(PAPER_FONT_PRESETS) as PaperFontPresetId[];

// ---- Texture levels ---------------------------------------------------------------------------

export const PAPER_TEXTURE = {
  SUBTLE: "subtle",
  STRONG: "strong",
  PLAIN: "plain",
} as const;

export type PaperTextureId = (typeof PAPER_TEXTURE)[keyof typeof PAPER_TEXTURE];

// Texture controls only the sheet grid: density via background-size, or removed entirely. The grid
// hue stays theme-driven (--df-paper-grid-*), so density is theme-independent.
export const PAPER_TEXTURE_PRESETS: Record<PaperTextureId, Record<string, string>> = {
  subtle: PAPER_TEXTURE_VARS_DEFAULT,
  strong: {
    "--df-paper-sheet-image": PAPER_TEXTURE_VARS_DEFAULT["--df-paper-sheet-image"],
    "--df-paper-sheet-size": "18px 18px",
  },
  plain: {
    "--df-paper-sheet-image": "none",
    "--df-paper-sheet-size": PAPER_TEXTURE_VARS_DEFAULT["--df-paper-sheet-size"],
  },
};

export const PAPER_TEXTURE_IDS = Object.keys(PAPER_TEXTURE_PRESETS) as PaperTextureId[];

// ---- Border (版框) styles ----------------------------------------------------------------------

export const PAPER_BORDER_STYLE = {
  // 四周单边: a single thin rule (the historical default and most plain look).
  SINGLE: "single",
  // 四周双边: a thin outer + thin inner line on all four sides (the most common 家谱 frame).
  DOUBLE: "double",
  // 左右双边: double line on the left/right edges only, single top/bottom (classic Ming/Qing books).
  SIDES: "sides",
  // 文武边: a thick outer line (武) paired with a thin inner line (文) on all four sides.
  WENWU: "wenwu",
} as const;

export type PaperBorderStyleId = (typeof PAPER_BORDER_STYLE)[keyof typeof PAPER_BORDER_STYLE];

// Each style is purely the --df-paper-frame-* geometry. The outer line is the leaf's own border
// (--df-paper-frame-outer). --df-paper-frame-pad-* both reserves the gap between the two lines and
// positions the inner line: the leaf pads its content by that amount and PaperFrameOverlay draws the
// inner line at the same offset, so the inner line lands on the content edge (closing with the page
// dividers) and the blank gap ends up between the inner and outer lines. The pad/inner widths are
// per-axis, so `sides` reserves the gap on the left/right only and its verticals span full height to
// meet the single top/bottom line. Switching a style is a single var swap on every leaf. Key order
// is the order the picker renders, and 文武边 (the default) is listed first.
export const PAPER_BORDER_STYLES: Record<PaperBorderStyleId, Record<string, string>> = {
  wenwu: {
    "--df-paper-frame-outer": "3px",
    "--df-paper-frame-inner-tb": "1px",
    "--df-paper-frame-inner-lr": "1px",
    "--df-paper-frame-pad-tb": "6px",
    "--df-paper-frame-pad-lr": "6px",
  },
  single: PAPER_FRAME_VARS_DEFAULT,
  double: {
    "--df-paper-frame-outer": "1px",
    "--df-paper-frame-inner-tb": "1px",
    "--df-paper-frame-inner-lr": "1px",
    "--df-paper-frame-pad-tb": "4px",
    "--df-paper-frame-pad-lr": "4px",
  },
  sides: {
    "--df-paper-frame-outer": "1px",
    "--df-paper-frame-inner-tb": "0px",
    "--df-paper-frame-inner-lr": "1px",
    "--df-paper-frame-pad-tb": "0px",
    "--df-paper-frame-pad-lr": "4px",
  },
};

export const PAPER_BORDER_STYLE_IDS = Object.keys(PAPER_BORDER_STYLES) as PaperBorderStyleId[];

// The four frame-geometry vars for a style, used to render a miniature frame preview in the UI.
export function getPaperBorderStyleVars(id: PaperBorderStyleId): Record<string, string> {
  return PAPER_BORDER_STYLES[id];
}

// ---- Font scale (whole-sheet zoom) ------------------------------------------------------------

// Global preview multiplier. It is applied as a proportional zoom on each renderer's content layer
// (NOT a CSS var / font-size), because every paper style uses a fixed sheet size + JS-computed slot
// coordinates: scaling only the glyphs would desync text from the layout (overlapping/clipped
// columns), so the whole sheet scales together. Pagination is still computed at the base size, so
// the page break-up never changes — only the rendered scale does.
export const PAPER_FONT_SCALE_MIN = 0.8;
export const PAPER_FONT_SCALE_MAX = 1.6;
export const PAPER_FONT_SCALE_STEP = 0.1;
export const PAPER_FONT_SCALE_DEFAULT = 1;

// Clamp a raw scale into the supported range; non-number/non-finite inputs fall back to the default.
// Rounded to 2 decimals so slider float drift never persists as a long fraction.
export function clampPaperFontScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return PAPER_FONT_SCALE_DEFAULT;
  const clamped = Math.min(PAPER_FONT_SCALE_MAX, Math.max(PAPER_FONT_SCALE_MIN, value));
  return Math.round(clamped * 100) / 100;
}

// ---- Export margin (book-edge 留白 in the exported PDF) ----------------------------------------

// Export-only: the paper margin (天头地脚/书边) painted around each printed leaf so the version
// frame (版框) sits inset instead of touching the page edge (which printers clip). Measured in
// spread px units; it does NOT affect the on-screen preview — only the generated PDF. The default
// mirrors the exporter's own DEFAULT_MARGIN_PX (48px ≈ 0.5in at 96dpi).
export const PAPER_EXPORT_MARGIN_MIN = 0;
export const PAPER_EXPORT_MARGIN_MAX = 120;
export const PAPER_EXPORT_MARGIN_STEP = 4;
export const PAPER_EXPORT_MARGIN_DEFAULT = 48;

// Clamp a raw margin into the supported range; non-number/non-finite inputs fall back to the
// default. Rounded to an integer so persisted values stay whole pixels.
export function clampPaperExportMargin(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return PAPER_EXPORT_MARGIN_DEFAULT;
  const clamped = Math.min(PAPER_EXPORT_MARGIN_MAX, Math.max(PAPER_EXPORT_MARGIN_MIN, value));
  return Math.round(clamped);
}

// ---- Appearance value + variable composition --------------------------------------------------

export interface PaperAppearance {
  colorThemeId: PaperColorThemeId;
  fontPresetId: PaperFontPresetId;
  textureId: PaperTextureId;
  // Version-frame (版框) style: single / double / sided / 文武 (see PAPER_BORDER_STYLES).
  borderStyleId: PaperBorderStyleId;
  // Hall name (堂号) override; null/empty means use the default i18n hall name.
  hallName: string | null;
  // Whole-sheet preview zoom multiplier (see PAPER_FONT_SCALE_* above).
  fontScale: number;
  // Book-edge margin (in spread px) applied only when exporting to PDF (see PAPER_EXPORT_MARGIN_*).
  exportMarginPx: number;
  // Whether to render a cover leaf (封面) as the first page of the book (preview + exported PDF).
  coverEnabled: boolean;
  // Optional custom inscription (落款/副标题) shown on the cover; null/empty means none.
  coverInscription: string | null;
}

export const DEFAULT_PAPER_APPEARANCE: PaperAppearance = {
  colorThemeId: PAPER_COLOR_THEME.XUAN,
  fontPresetId: PAPER_FONT_PRESET.CLASSIC,
  textureId: PAPER_TEXTURE.SUBTLE,
  borderStyleId: PAPER_BORDER_STYLE.WENWU,
  hallName: null,
  fontScale: PAPER_FONT_SCALE_DEFAULT,
  exportMarginPx: PAPER_EXPORT_MARGIN_DEFAULT,
  coverEnabled: true,
  coverInscription: null,
};

// Compose the full --df-paper-* variable set for a given appearance. Starts from PAPER_VARS so any
// variable a preset omits keeps its default, then layers color/font/texture overrides on top.
export function buildPaperVars(appearance: PaperAppearance): CSSProperties {
  return {
    ...PAPER_VARS,
    ...PAPER_COLOR_THEMES[appearance.colorThemeId],
    ...PAPER_FONT_PRESETS[appearance.fontPresetId],
    ...PAPER_TEXTURE_PRESETS[appearance.textureId],
    ...PAPER_BORDER_STYLES[appearance.borderStyleId],
  } as CSSProperties;
}

// ---- Persistence (global, single JSON key) ----------------------------------------------------

export const PAPER_APPEARANCE_STORAGE_KEY = "df:paperAppearance";

function isColorThemeId(value: unknown): value is PaperColorThemeId {
  return typeof value === "string" && value in PAPER_COLOR_THEMES;
}

function isFontPresetId(value: unknown): value is PaperFontPresetId {
  return typeof value === "string" && value in PAPER_FONT_PRESETS;
}

function isTextureId(value: unknown): value is PaperTextureId {
  return typeof value === "string" && value in PAPER_TEXTURE_PRESETS;
}

function isBorderStyleId(value: unknown): value is PaperBorderStyleId {
  return typeof value === "string" && value in PAPER_BORDER_STYLES;
}

// Read the saved appearance, falling back field-by-field to defaults so a partial/corrupt payload
// never throws and unknown ids degrade gracefully.
export function loadPaperAppearance(): PaperAppearance {
  if (typeof window === "undefined") return { ...DEFAULT_PAPER_APPEARANCE };
  try {
    const raw = window.localStorage.getItem(PAPER_APPEARANCE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PAPER_APPEARANCE };
    const parsed = JSON.parse(raw) as Partial<PaperAppearance>;
    const hallName =
      typeof parsed.hallName === "string" && parsed.hallName.trim() ? parsed.hallName : null;
    const coverInscription =
      typeof parsed.coverInscription === "string" && parsed.coverInscription.trim()
        ? parsed.coverInscription
        : null;
    return {
      colorThemeId: isColorThemeId(parsed.colorThemeId)
        ? parsed.colorThemeId
        : DEFAULT_PAPER_APPEARANCE.colorThemeId,
      fontPresetId: isFontPresetId(parsed.fontPresetId)
        ? parsed.fontPresetId
        : DEFAULT_PAPER_APPEARANCE.fontPresetId,
      textureId: isTextureId(parsed.textureId)
        ? parsed.textureId
        : DEFAULT_PAPER_APPEARANCE.textureId,
      borderStyleId: isBorderStyleId(parsed.borderStyleId)
        ? parsed.borderStyleId
        : DEFAULT_PAPER_APPEARANCE.borderStyleId,
      hallName,
      fontScale: clampPaperFontScale(parsed.fontScale),
      exportMarginPx: clampPaperExportMargin(parsed.exportMarginPx),
      coverEnabled:
        typeof parsed.coverEnabled === "boolean"
          ? parsed.coverEnabled
          : DEFAULT_PAPER_APPEARANCE.coverEnabled,
      coverInscription,
    };
  } catch {
    return { ...DEFAULT_PAPER_APPEARANCE };
  }
}

// Persist the appearance. A blank hall name is normalized to null so it never lingers in storage.
export function savePaperAppearance(appearance: PaperAppearance): void {
  if (typeof window === "undefined") return;
  const normalized: PaperAppearance = {
    ...appearance,
    hallName: appearance.hallName && appearance.hallName.trim() ? appearance.hallName : null,
    fontScale: clampPaperFontScale(appearance.fontScale),
    exportMarginPx: clampPaperExportMargin(appearance.exportMarginPx),
  };
  try {
    window.localStorage.setItem(PAPER_APPEARANCE_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    /* ignore quota/availability errors; appearance is non-critical */
  }
}

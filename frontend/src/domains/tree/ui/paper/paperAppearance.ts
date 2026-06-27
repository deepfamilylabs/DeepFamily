import type { CSSProperties } from "react";
import {
  PAPER_BODY_FONT_STACK,
  PAPER_COLOR_VARS_XUAN,
  PAPER_FRAME_VARS_DEFAULT,
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
} as const;

export type PaperColorThemeId = (typeof PAPER_COLOR_THEME)[keyof typeof PAPER_COLOR_THEME];

// Each theme is a full color-variable set so switching fully replaces the previous palette. The
// woodblock generation-mark tab (PAPER_MARK_BG/FG) stays constant across themes by design.
export const PAPER_COLOR_THEMES: Record<PaperColorThemeId, Record<string, string>> = {
  xuan: PAPER_COLOR_VARS_XUAN,
  plain: {
    "--df-paper-bg": "#dcdedb",
    "--df-paper-sheet": "#fbfbf8",
    "--df-paper-panel": "#ffffff",
    "--df-paper-spine": "#f0efe9",
    "--df-paper-line": "#7c8079",
    "--df-paper-line-soft": "rgba(90, 96, 90, 0.30)",
    "--df-paper-line-tint": "rgba(90, 96, 90, 0.06)",
    "--df-paper-line-accent": "#a8736c",
    "--df-paper-ink": "#23262a",
    "--df-paper-muted": "#5b6168",
    "--df-paper-red": "#9b2f25",
    "--df-paper-grid-major": "rgba(90, 96, 90, 0.05)",
    "--df-paper-grid-minor": "rgba(90, 96, 90, 0.04)",
  },
  bamboo: {
    "--df-paper-bg": "#cbd7c0",
    "--df-paper-sheet": "#eef3e6",
    "--df-paper-panel": "#f6f9f0",
    "--df-paper-spine": "#e2ead6",
    "--df-paper-line": "#5f7a4f",
    "--df-paper-line-soft": "rgba(95, 122, 79, 0.32)",
    "--df-paper-line-tint": "rgba(95, 122, 79, 0.08)",
    "--df-paper-line-accent": "#86984f",
    "--df-paper-ink": "#243024",
    "--df-paper-muted": "#4f6347",
    "--df-paper-red": "#9b2f25",
    "--df-paper-grid-major": "rgba(95, 122, 79, 0.05)",
    "--df-paper-grid-minor": "rgba(95, 122, 79, 0.04)",
  },
  azure: {
    "--df-paper-bg": "#c1d1d5",
    "--df-paper-sheet": "#e9eff1",
    "--df-paper-panel": "#f2f7f8",
    "--df-paper-spine": "#d7e1e4",
    "--df-paper-line": "#3f6470",
    "--df-paper-line-soft": "rgba(63, 100, 112, 0.32)",
    "--df-paper-line-tint": "rgba(63, 100, 112, 0.08)",
    "--df-paper-line-accent": "#6f93a0",
    "--df-paper-ink": "#1f2a30",
    "--df-paper-muted": "#44606b",
    "--df-paper-red": "#9b2f25",
    "--df-paper-grid-major": "rgba(63, 100, 112, 0.05)",
    "--df-paper-grid-minor": "rgba(63, 100, 112, 0.04)",
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
  SANS: "sans",
} as const;

export type PaperFontPresetId = (typeof PAPER_FONT_PRESET)[keyof typeof PAPER_FONT_PRESET];

// Each preset unifies ALL three font roles (title/body/note) on one family so switching a preset
// restyles the whole page (names, body records AND notes), not just titles: "classic" = kaiti
// everywhere, "song" = serif everywhere, "sans" = a CJK sans family. Keeping every preset
// single-family also makes the switch visibly consistent regardless of which roles a renderer uses.
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
}

export const DEFAULT_PAPER_APPEARANCE: PaperAppearance = {
  colorThemeId: PAPER_COLOR_THEME.XUAN,
  fontPresetId: PAPER_FONT_PRESET.CLASSIC,
  textureId: PAPER_TEXTURE.SUBTLE,
  borderStyleId: PAPER_BORDER_STYLE.WENWU,
  hallName: null,
  fontScale: PAPER_FONT_SCALE_DEFAULT,
  exportMarginPx: PAPER_EXPORT_MARGIN_DEFAULT,
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

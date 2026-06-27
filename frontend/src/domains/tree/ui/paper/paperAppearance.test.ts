// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildPaperVars,
  DEFAULT_PAPER_APPEARANCE,
  getPaperColorThemeSwatch,
  loadPaperAppearance,
  PAPER_APPEARANCE_STORAGE_KEY,
  PAPER_COLOR_THEMES,
  PAPER_COLOR_THEME_IDS,
  PAPER_FONT_PRESETS,
  PAPER_FONT_PRESET_IDS,
  PAPER_EXPORT_MARGIN_MAX,
  PAPER_EXPORT_MARGIN_MIN,
  PAPER_FONT_SCALE_MAX,
  PAPER_FONT_SCALE_MIN,
  PAPER_TEXTURE_PRESETS,
  PAPER_TEXTURE_IDS,
  PAPER_BORDER_STYLES,
  PAPER_BORDER_STYLE_IDS,
  savePaperAppearance,
  type PaperAppearance,
} from "./paperAppearance";

type Vars = Record<string, string>;

describe("buildPaperVars", () => {
  it("composes the default appearance into the xuan/classic/subtle variable set", () => {
    const vars = buildPaperVars(DEFAULT_PAPER_APPEARANCE) as Vars;
    expect(vars["--df-paper-bg"]).toBe(PAPER_COLOR_THEMES.xuan["--df-paper-bg"]);
    expect(vars["--df-paper-spine"]).toBe(PAPER_COLOR_THEMES.xuan["--df-paper-spine"]);
    expect(vars["--df-paper-font-title"]).toBe(PAPER_FONT_PRESETS.classic["--df-paper-font-title"]);
    expect(vars["--df-paper-sheet-size"]).toBe(
      PAPER_TEXTURE_PRESETS.subtle["--df-paper-sheet-size"],
    );
  });

  it("overrides color variables when a different color theme is selected", () => {
    const vars = buildPaperVars({ ...DEFAULT_PAPER_APPEARANCE, colorThemeId: "bamboo" }) as Vars;
    expect(vars["--df-paper-bg"]).toBe(PAPER_COLOR_THEMES.bamboo["--df-paper-bg"]);
    expect(vars["--df-paper-ink"]).toBe(PAPER_COLOR_THEMES.bamboo["--df-paper-ink"]);
  });

  it("overrides font variables when a different font preset is selected", () => {
    const vars = buildPaperVars({ ...DEFAULT_PAPER_APPEARANCE, fontPresetId: "sans" }) as Vars;
    expect(vars["--df-paper-font-title"]).toBe(PAPER_FONT_PRESETS.sans["--df-paper-font-title"]);
    expect(vars["--df-paper-font-body"]).toBe(PAPER_FONT_PRESETS.sans["--df-paper-font-body"]);
  });

  it("removes the sheet grid image for the plain texture", () => {
    const vars = buildPaperVars({ ...DEFAULT_PAPER_APPEARANCE, textureId: "plain" }) as Vars;
    expect(vars["--df-paper-sheet-image"]).toBe("none");
  });

  it("keeps the inner frame line off and reserves no gap for the single border style", () => {
    const vars = buildPaperVars(DEFAULT_PAPER_APPEARANCE) as Vars;
    expect(vars["--df-paper-frame-outer"]).toBe("1px");
    expect(vars["--df-paper-frame-inner-tb"]).toBe("0px");
    expect(vars["--df-paper-frame-inner-lr"]).toBe("0px");
    expect(vars["--df-paper-frame-pad-tb"]).toBe("0px");
    expect(vars["--df-paper-frame-pad-lr"]).toBe("0px");
  });

  it("reserves the frame gap on the axes that carry an inner line so it closes with content", () => {
    // double: gap reserved on both axes (inner line on all four sides).
    const doubleVars = buildPaperVars({
      ...DEFAULT_PAPER_APPEARANCE,
      borderStyleId: "double",
    }) as Vars;
    expect(doubleVars["--df-paper-frame-pad-tb"]).not.toBe("0px");
    expect(doubleVars["--df-paper-frame-pad-lr"]).not.toBe("0px");

    // sides: gap reserved on the left/right only; top/bottom stay flush (single line).
    const sidesVars = buildPaperVars({
      ...DEFAULT_PAPER_APPEARANCE,
      borderStyleId: "sides",
    }) as Vars;
    expect(sidesVars["--df-paper-frame-pad-tb"]).toBe("0px");
    expect(sidesVars["--df-paper-frame-pad-lr"]).not.toBe("0px");
  });

  it("enables the inner frame line when a non-single border style is selected", () => {
    const doubleVars = buildPaperVars({
      ...DEFAULT_PAPER_APPEARANCE,
      borderStyleId: "double",
    }) as Vars;
    expect(doubleVars["--df-paper-frame-inner-tb"]).toBe("1px");
    expect(doubleVars["--df-paper-frame-inner-lr"]).toBe("1px");

    const sidesVars = buildPaperVars({
      ...DEFAULT_PAPER_APPEARANCE,
      borderStyleId: "sides",
    }) as Vars;
    expect(sidesVars["--df-paper-frame-inner-tb"]).toBe("0px");
    expect(sidesVars["--df-paper-frame-inner-lr"]).toBe("1px");

    const wenwuVars = buildPaperVars({
      ...DEFAULT_PAPER_APPEARANCE,
      borderStyleId: "wenwu",
    }) as Vars;
    expect(wenwuVars["--df-paper-frame-outer"]).toBe("3px");
  });

  it("keeps every preset list non-empty and in sync with its table", () => {
    expect(PAPER_COLOR_THEME_IDS.length).toBe(Object.keys(PAPER_COLOR_THEMES).length);
    expect(PAPER_FONT_PRESET_IDS.length).toBe(Object.keys(PAPER_FONT_PRESETS).length);
    expect(PAPER_TEXTURE_IDS.length).toBe(Object.keys(PAPER_TEXTURE_PRESETS).length);
    expect(PAPER_BORDER_STYLE_IDS.length).toBe(Object.keys(PAPER_BORDER_STYLES).length);
  });
});

describe("getPaperColorThemeSwatch", () => {
  it("returns the sheet/line/accent triple for a theme", () => {
    const [sheet, line, accent] = getPaperColorThemeSwatch("xuan");
    expect(sheet).toBe(PAPER_COLOR_THEMES.xuan["--df-paper-sheet"]);
    expect(line).toBe(PAPER_COLOR_THEMES.xuan["--df-paper-line"]);
    expect(accent).toBe(PAPER_COLOR_THEMES.xuan["--df-paper-line-accent"]);
  });
});

describe("paperAppearance storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns the default appearance when nothing is stored", () => {
    expect(loadPaperAppearance()).toEqual(DEFAULT_PAPER_APPEARANCE);
  });

  it("persists and reloads an appearance under the global key", () => {
    const next: PaperAppearance = {
      colorThemeId: "azure",
      fontPresetId: "song",
      textureId: "strong",
      borderStyleId: "double",
      hallName: "忠义堂",
      fontScale: 1.2,
      exportMarginPx: 64,
    };
    savePaperAppearance(next);
    expect(localStorage.getItem(PAPER_APPEARANCE_STORAGE_KEY)).toBeTruthy();
    expect(loadPaperAppearance()).toEqual(next);
  });

  it("clamps an out-of-range font scale on save and load", () => {
    savePaperAppearance({ ...DEFAULT_PAPER_APPEARANCE, fontScale: 5 });
    expect(loadPaperAppearance().fontScale).toBe(PAPER_FONT_SCALE_MAX);

    localStorage.setItem(
      PAPER_APPEARANCE_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_PAPER_APPEARANCE, fontScale: 0.1 }),
    );
    expect(loadPaperAppearance().fontScale).toBe(PAPER_FONT_SCALE_MIN);
  });

  it("clamps an out-of-range export margin on save and load", () => {
    savePaperAppearance({ ...DEFAULT_PAPER_APPEARANCE, exportMarginPx: 999 });
    expect(loadPaperAppearance().exportMarginPx).toBe(PAPER_EXPORT_MARGIN_MAX);

    localStorage.setItem(
      PAPER_APPEARANCE_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_PAPER_APPEARANCE, exportMarginPx: -40 }),
    );
    expect(loadPaperAppearance().exportMarginPx).toBe(PAPER_EXPORT_MARGIN_MIN);
  });

  it("normalizes a blank hall name to null on save", () => {
    savePaperAppearance({ ...DEFAULT_PAPER_APPEARANCE, hallName: "   " });
    expect(loadPaperAppearance().hallName).toBeNull();
  });

  it("falls back field-by-field for unknown ids", () => {
    localStorage.setItem(
      PAPER_APPEARANCE_STORAGE_KEY,
      JSON.stringify({
        colorThemeId: "neon",
        fontPresetId: "comic",
        textureId: "dots",
        hallName: "忠义堂",
      }),
    );
    const loaded = loadPaperAppearance();
    expect(loaded.colorThemeId).toBe(DEFAULT_PAPER_APPEARANCE.colorThemeId);
    expect(loaded.fontPresetId).toBe(DEFAULT_PAPER_APPEARANCE.fontPresetId);
    expect(loaded.textureId).toBe(DEFAULT_PAPER_APPEARANCE.textureId);
    // A valid hall name survives even when the ids are invalid.
    expect(loaded.hallName).toBe("忠义堂");
    // A missing font scale falls back to the default.
    expect(loaded.fontScale).toBe(DEFAULT_PAPER_APPEARANCE.fontScale);
  });

  it("falls back to defaults when the stored payload is corrupt", () => {
    localStorage.setItem(PAPER_APPEARANCE_STORAGE_KEY, "{not json");
    expect(loadPaperAppearance()).toEqual(DEFAULT_PAPER_APPEARANCE);
  });
});

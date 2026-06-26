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
  PAPER_TEXTURE_PRESETS,
  PAPER_TEXTURE_IDS,
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

  it("keeps every preset list non-empty and in sync with its table", () => {
    expect(PAPER_COLOR_THEME_IDS.length).toBe(Object.keys(PAPER_COLOR_THEMES).length);
    expect(PAPER_FONT_PRESET_IDS.length).toBe(Object.keys(PAPER_FONT_PRESETS).length);
    expect(PAPER_TEXTURE_IDS.length).toBe(Object.keys(PAPER_TEXTURE_PRESETS).length);
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
      hallName: "忠义堂",
    };
    savePaperAppearance(next);
    expect(localStorage.getItem(PAPER_APPEARANCE_STORAGE_KEY)).toBeTruthy();
    expect(loadPaperAppearance()).toEqual(next);
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
  });

  it("falls back to defaults when the stored payload is corrupt", () => {
    localStorage.setItem(PAPER_APPEARANCE_STORAGE_KEY, "{not json");
    expect(loadPaperAppearance()).toEqual(DEFAULT_PAPER_APPEARANCE);
  });
});

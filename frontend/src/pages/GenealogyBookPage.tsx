import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  FileDown,
  GitMerge,
  Loader2,
  RefreshCw,
  ScrollText,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import {
  buildPaperGenerations,
  buildPaperVars,
  DEFAULT_PAPER_APPEARANCE,
  getPaperBorderStyleVars,
  getPaperColorThemeSwatch,
  getPaperSpineTitle,
  isPaperGenealogyStyle,
  loadPaperAppearance,
  loadPaperSpineTitleOverride,
  PAPER_BORDER_STYLE_IDS,
  PAPER_COLOR_THEME_IDS,
  PAPER_EXPORT_MARGIN_MAX,
  PAPER_EXPORT_MARGIN_MIN,
  PAPER_EXPORT_MARGIN_STEP,
  PAPER_FONT_PRESET_IDS,
  PAPER_FONT_SCALE_MAX,
  PAPER_FONT_SCALE_MIN,
  PAPER_FONT_SCALE_STEP,
  PAPER_GENEALOGY_STYLE,
  PAPER_GENEALOGY_STYLES,
  PAPER_TEXTURE_IDS,
  PaperGenealogyView,
  savePaperAppearance,
  savePaperSpineTitleOverride,
  type PaperAppearance,
  type PaperBorderStyleId,
  type PaperColorThemeId,
  type PaperFontPresetId,
  type PaperGenealogyStyle,
  type PaperTextureId,
  type TranslateFn,
  useFamilyTreeProjection,
  usePaperPdfExport,
  useTreeNodeAccess,
  useTreeGraphData,
  useTreeStatus,
} from "../domains/tree";
import type { NodeId } from "../shared/model";

const LS_STYLE_KEY = "df:paperGenealogyStyle";

function usePersistedPaperStyle() {
  const [style, setStyle] = useState<PaperGenealogyStyle>(() => {
    if (typeof window === "undefined") return PAPER_GENEALOGY_STYLE.OU;
    const saved = localStorage.getItem(LS_STYLE_KEY);
    return isPaperGenealogyStyle(saved) ? saved : PAPER_GENEALOGY_STYLE.OU;
  });

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(LS_STYLE_KEY, style);
  }, [style]);

  return { style, setStyle };
}

// Manual spine-title override persisted per rootId. `stored === null` means "no override" (the view
// uses the auto-generated title); an empty saved value is cleared on write, so it never lingers.
function usePersistedSpineTitle(rootId: NodeId | null) {
  const [stored, setStored] = useState<string | null>(() => loadPaperSpineTitleOverride(rootId));

  // Re-hydrate when the active genealogy changes so each root shows its own saved title.
  useEffect(() => {
    setStored(loadPaperSpineTitleOverride(rootId));
  }, [rootId]);

  const setSpineTitle = useCallback(
    (value: string) => {
      setStored(value.trim() ? value : null);
      savePaperSpineTitleOverride(rootId, value);
    },
    [rootId],
  );

  return { stored, setSpineTitle };
}

// Paper appearance (color theme / font / texture / hall name) persisted globally — shared by every
// genealogy, unlike the per-root spine title.
function usePersistedPaperAppearance() {
  const [appearance, setAppearance] = useState<PaperAppearance>(() => loadPaperAppearance());

  const updateAppearance = useCallback((patch: Partial<PaperAppearance>) => {
    setAppearance((prev) => {
      const next = { ...prev, ...patch };
      savePaperAppearance(next);
      return next;
    });
  }, []);

  const resetAppearance = useCallback(() => {
    const next = { ...DEFAULT_PAPER_APPEARANCE };
    setAppearance(next);
    savePaperAppearance(next);
  }, []);

  return { appearance, updateAppearance, resetAppearance };
}

function isDefaultPaperAppearance(appearance: PaperAppearance): boolean {
  return (
    appearance.colorThemeId === DEFAULT_PAPER_APPEARANCE.colorThemeId &&
    appearance.fontPresetId === DEFAULT_PAPER_APPEARANCE.fontPresetId &&
    appearance.textureId === DEFAULT_PAPER_APPEARANCE.textureId &&
    appearance.borderStyleId === DEFAULT_PAPER_APPEARANCE.borderStyleId &&
    appearance.hallName === DEFAULT_PAPER_APPEARANCE.hallName &&
    appearance.fontScale === DEFAULT_PAPER_APPEARANCE.fontScale &&
    appearance.exportMarginPx === DEFAULT_PAPER_APPEARANCE.exportMarginPx &&
    appearance.coverEnabled === DEFAULT_PAPER_APPEARANCE.coverEnabled &&
    appearance.coverInscription === DEFAULT_PAPER_APPEARANCE.coverInscription
  );
}

export default function GenealogyBookPage() {
  const { t } = useTranslation();
  const { style, setStyle } = usePersistedPaperStyle();
  const projection = useFamilyTreeProjection();
  const { getStoryData } = useTreeNodeAccess();
  const { rootExists } = useTreeGraphData();
  const { loading, progress, contractMessage, refresh } = useTreeStatus();
  const { exporting, exportPdf } = usePaperPdfExport();
  const { stored: spineTitleStored, setSpineTitle } = usePersistedSpineTitle(projection.rootId);
  const { appearance, updateAppearance, resetAppearance } = usePersistedPaperAppearance();
  const exportRef = useRef<HTMLDivElement>(null);

  const styleLabels = useMemo(
    (): Record<PaperGenealogyStyle, string> => ({
      [PAPER_GENEALOGY_STYLE.OU]: t("genealogyBook.styles.ou", "Ou-style"),
      [PAPER_GENEALOGY_STYLE.SU]: t("genealogyBook.styles.su", "Su-style"),
      [PAPER_GENEALOGY_STYLE.DIEJI]: t("genealogyBook.styles.dieji", "Dieji-style"),
      [PAPER_GENEALOGY_STYLE.LINEAGE]: t("genealogyBook.styles.lineage", "Lineage"),
      [PAPER_GENEALOGY_STYLE.MODERN]: t("genealogyBook.styles.modern", "Modern"),
    }),
    [t],
  );

  const colorThemeLabels = useMemo(
    (): Record<PaperColorThemeId, string> => ({
      xuan: t("genealogyBook.settings.themes.xuan", "Rice paper"),
      plain: t("genealogyBook.settings.themes.plain", "Plain white"),
      bamboo: t("genealogyBook.settings.themes.bamboo", "Bamboo green"),
      azure: t("genealogyBook.settings.themes.azure", "Porcelain blue"),
      vermilion: t("genealogyBook.settings.themes.vermilion", "Vermilion rules"),
      ochre: t("genealogyBook.settings.themes.ochre", "Aged tea"),
      indigo: t("genealogyBook.settings.themes.indigo", "Indigo & gold"),
      sumi: t("genealogyBook.settings.themes.sumi", "Ink rules"),
      rubbing: t("genealogyBook.settings.themes.rubbing", "Stone rubbing"),
      imperial: t("genealogyBook.settings.themes.imperial", "Imperial yellow"),
    }),
    [t],
  );
  const fontPresetLabels = useMemo(
    (): Record<PaperFontPresetId, string> => ({
      classic: t("genealogyBook.settings.fonts.classic", "Classical"),
      song: t("genealogyBook.settings.fonts.song", "Song"),
      lishu: t("genealogyBook.settings.fonts.lishu", "Lishu"),
      sans: t("genealogyBook.settings.fonts.sans", "Sans"),
    }),
    [t],
  );
  const textureLabels = useMemo(
    (): Record<PaperTextureId, string> => ({
      subtle: t("genealogyBook.settings.textures.subtle", "Subtle"),
      strong: t("genealogyBook.settings.textures.strong", "Strong"),
      plain: t("genealogyBook.settings.textures.plain", "None"),
    }),
    [t],
  );
  const borderStyleLabels = useMemo(
    (): Record<PaperBorderStyleId, string> => ({
      single: t("genealogyBook.settings.borders.single", "Single rule"),
      double: t("genealogyBook.settings.borders.double", "Double rule"),
      sides: t("genealogyBook.settings.borders.sides", "Side double"),
      wenwu: t("genealogyBook.settings.borders.wenwu", "Thick-thin"),
    }),
    [t],
  );
  const paperVars = useMemo(() => buildPaperVars(appearance), [appearance]);
  const hasRoot = Boolean(projection.rootId && rootExists);
  const defaultHallName = t("genealogyBook.ouHallName", "DeepFamily");
  const hallNameInputValue = appearance.hallName ?? defaultHallName;
  const fieldInputClassName =
    "h-9 w-full rounded-md border border-stone-300 bg-white px-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/30 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-orange-400 dark:focus:ring-orange-400/30";
  const segmentGroupClassName =
    "inline-flex w-full items-center gap-1 rounded-md border border-stone-200 bg-stone-100 p-1 dark:border-slate-700 dark:bg-slate-900";
  const segmentButtonClassName = (selected: boolean) =>
    `h-7 flex-1 rounded px-1 text-xs font-medium transition-colors ${
      selected
        ? "bg-white text-red-700 shadow-sm ring-1 ring-black/5 dark:bg-slate-700 dark:text-orange-200 dark:ring-white/10"
        : "text-stone-600 hover:bg-white/70 dark:text-slate-300 dark:hover:bg-slate-800"
    }`;

  // Mirror the view model's translate wrapper so the page derives the same auto spine title that
  // the renderers fall back to when the override is blank.
  const translateForPaper = useCallback<TranslateFn>(
    (key, fallback, options) => t(key, { defaultValue: fallback, ...(options || {}) }),
    [t],
  );
  const autoSpineTitle = useMemo(() => {
    const generations = buildPaperGenerations({
      graph: projection.graph,
      nodesData: projection.nodesData,
      spouseLinks: projection.spouseLinks,
      t: translateForPaper,
    });
    return getPaperSpineTitle(generations, translateForPaper);
  }, [projection.graph, projection.nodesData, projection.spouseLinks, translateForPaper]);

  // Prefill the input with the auto title when there is no saved override; pass the override (blank
  // when the user cleared it) to the view so all renderers stay in sync with the input.
  const spineTitleInputValue = spineTitleStored ?? autoSpineTitle;
  const spineTitleOverride = spineTitleStored ?? undefined;
  const hasCustomDisplaySettings =
    spineTitleStored !== null || !isDefaultPaperAppearance(appearance);
  const resetDisplaySettings = useCallback(() => {
    setSpineTitle("");
    resetAppearance();
  }, [resetAppearance, setSpineTitle]);

  useEffect(() => {
    if (!hasRoot) return;

    projection.graph.nodes.forEach((node) => {
      const nodeData = projection.nodesData[node.id];
      const tokenId = nodeData?.tokenId;
      const totalChunks = Number(nodeData?.storyMetadata?.totalChunks || 0);
      const loadedChunks = Array.isArray(nodeData?.storyChunks) ? nodeData.storyChunks.length : 0;
      if (!tokenId || totalChunks <= 0 || loadedChunks >= totalChunks) return;
      getStoryData(tokenId, { nodeIdHint: node.id }).catch(() => {
        /* Paper view can still render the core story fallback. */
      });
    });
  }, [getStoryData, hasRoot, projection.graph.nodes, projection.nodesData]);

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full flex-col overflow-hidden bg-stone-100 dark:bg-slate-950">
      <div className="flex flex-col gap-3 border-b border-stone-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-black md:flex-row md:items-center md:justify-between md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-stone-50 text-stone-700 dark:border-slate-700 dark:bg-slate-900 dark:text-stone-200">
            <BookOpen className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
              <span className="min-w-0 truncate">{t("genealogyBook.title", "Genealogy Book")}</span>
            </h2>
            <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
              {t("genealogyBook.subtitle", "Paper-style genealogy preview")}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="hidden items-center gap-2 text-xs font-medium md:flex">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-stone-700 dark:bg-slate-900 dark:text-slate-300">
              <Users className="h-3.5 w-3.5" />
              {t("familyTree.ui.nodesLabelFull", "Nodes")}: {progress?.created || 0}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-stone-700 dark:bg-slate-900 dark:text-slate-300">
              <GitMerge className="h-3.5 w-3.5" />
              {t("familyTree.ui.depthLabelFull", "Depth")}: {progress?.depth || 0}
            </span>
          </div>

          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            title={t("familyTree.actions.refresh", "Refresh")}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{t("familyTree.actions.refresh", "Refresh")}</span>
          </button>

          <button
            type="button"
            onClick={() =>
              exportPdf(exportRef.current, style, paperVars, appearance.exportMarginPx)
            }
            disabled={!hasRoot || loading || exporting}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            title={t("genealogyBook.exportPdf", "Export PDF")}
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileDown className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">{t("genealogyBook.exportPdf", "Export PDF")}</span>
          </button>

          <div
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-stone-200 bg-stone-100 p-1 dark:border-slate-700 dark:bg-slate-900"
            aria-label={t("genealogyBook.styleSwitchLabel", "Genealogy book style")}
          >
            <ScrollText className="ml-1 hidden h-4 w-4 shrink-0 text-stone-500 dark:text-slate-400 sm:block" />
            {PAPER_GENEALOGY_STYLES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setStyle(item)}
                className={`h-7 rounded px-2.5 text-xs font-medium transition-colors md:px-3 ${
                  style === item
                    ? "bg-white text-red-700 shadow-sm ring-1 ring-black/5 dark:bg-slate-700 dark:text-orange-200 dark:ring-white/10"
                    : "text-stone-600 hover:bg-white/70 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
                aria-pressed={style === item}
                title={styleLabels[item]}
              >
                {styleLabels[item]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside
          className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-stone-200 bg-white p-4 dark:border-slate-800 dark:bg-black md:w-64"
          aria-label={t("genealogyBook.settings.title", "Display settings")}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <SlidersHorizontal className="h-4 w-4 shrink-0 text-stone-500 dark:text-slate-400" />
              <span className="truncate">
                {t("genealogyBook.settings.title", "Display settings")}
              </span>
            </div>
            <button
              type="button"
              onClick={resetDisplaySettings}
              disabled={!hasCustomDisplaySettings}
              className="shrink-0 text-xs font-medium text-stone-600 transition-colors hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:text-orange-200"
              title={t("genealogyBook.settings.resetDefault", "Reset defaults")}
              data-testid="paper-reset-display-settings"
            >
              {t("genealogyBook.settings.resetDefault", "Reset defaults")}
            </button>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {t("genealogyBook.settings.spineTitleLabel", "Spine title")}
            </span>
            <input
              type="text"
              value={spineTitleInputValue}
              onChange={(event) => setSpineTitle(event.target.value)}
              disabled={!hasRoot}
              placeholder={autoSpineTitle}
              aria-label={t("genealogyBook.settings.spineTitleLabel", "Spine title")}
              className={fieldInputClassName}
              data-testid="paper-spine-title-input"
            />
            <span className="text-[11px] leading-snug text-stone-500 dark:text-slate-400">
              {t(
                "genealogyBook.settings.spineTitleHint",
                "Leave blank to use the auto-generated title",
              )}
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {t("genealogyBook.settings.hallNameLabel", "Hall name")}
            </span>
            <input
              type="text"
              value={hallNameInputValue}
              onChange={(event) => updateAppearance({ hallName: event.target.value })}
              placeholder={defaultHallName}
              aria-label={t("genealogyBook.settings.hallNameLabel", "Hall name")}
              className={fieldInputClassName}
              data-testid="paper-hall-name-input"
            />
            <span className="text-[11px] leading-snug text-stone-500 dark:text-slate-400">
              {t("genealogyBook.settings.hallNameHint", "Leave blank to use the default hall name")}
            </span>
          </label>

          <div className="flex flex-col gap-1.5">
            <label className="flex cursor-pointer items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {t("genealogyBook.settings.coverEnabledLabel", "Cover page")}
              </span>
              <input
                type="checkbox"
                checked={appearance.coverEnabled}
                onChange={(event) => updateAppearance({ coverEnabled: event.target.checked })}
                aria-label={t("genealogyBook.settings.coverEnabledLabel", "Cover page")}
                className="h-4 w-4 shrink-0 accent-orange-500"
                data-testid="paper-cover-enabled-input"
              />
            </label>
            <input
              type="text"
              value={appearance.coverInscription ?? ""}
              onChange={(event) => updateAppearance({ coverInscription: event.target.value })}
              disabled={!appearance.coverEnabled}
              placeholder={t("genealogyBook.settings.coverInscriptionPlaceholder", "Inscription")}
              aria-label={t("genealogyBook.settings.coverInscriptionLabel", "Cover inscription")}
              className={fieldInputClassName}
              data-testid="paper-cover-inscription-input"
            />
            <span className="text-[11px] leading-snug text-stone-500 dark:text-slate-400">
              {t(
                "genealogyBook.settings.coverInscriptionHint",
                "Optional inscription shown on the cover under the title",
              )}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {t("genealogyBook.settings.colorThemeLabel", "Color theme")}
            </span>
            <div
              className="grid grid-cols-2 gap-2"
              role="group"
              aria-label={t("genealogyBook.settings.colorThemeLabel", "Color theme")}
            >
              {PAPER_COLOR_THEME_IDS.map((id) => {
                const [sheet, line, accent] = getPaperColorThemeSwatch(id);
                const selected = appearance.colorThemeId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => updateAppearance({ colorThemeId: id })}
                    aria-pressed={selected}
                    title={colorThemeLabels[id]}
                    className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                      selected
                        ? "border-orange-500 ring-1 ring-orange-500/30 dark:border-orange-400"
                        : "border-stone-200 hover:border-stone-300 dark:border-slate-700 dark:hover:border-slate-600"
                    }`}
                    data-testid={`paper-color-theme-${id}`}
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 overflow-hidden rounded-sm border border-black/10"
                      aria-hidden="true"
                    >
                      <span className="h-full w-1/3" style={{ backgroundColor: sheet }} />
                      <span className="h-full w-1/3" style={{ backgroundColor: line }} />
                      <span className="h-full w-1/3" style={{ backgroundColor: accent }} />
                    </span>
                    <span className="min-w-0 truncate text-xs text-slate-700 dark:text-slate-200">
                      {colorThemeLabels[id]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {t("genealogyBook.settings.fontLabel", "Font")}
            </span>
            <div
              className={segmentGroupClassName}
              role="group"
              aria-label={t("genealogyBook.settings.fontLabel", "Font")}
            >
              {PAPER_FONT_PRESET_IDS.map((id) => {
                const selected = appearance.fontPresetId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => updateAppearance({ fontPresetId: id })}
                    aria-pressed={selected}
                    title={fontPresetLabels[id]}
                    className={segmentButtonClassName(selected)}
                    data-testid={`paper-font-preset-${id}`}
                  >
                    {fontPresetLabels[id]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {t("genealogyBook.settings.textureLabel", "Paper texture")}
            </span>
            <div
              className={segmentGroupClassName}
              role="group"
              aria-label={t("genealogyBook.settings.textureLabel", "Paper texture")}
            >
              {PAPER_TEXTURE_IDS.map((id) => {
                const selected = appearance.textureId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => updateAppearance({ textureId: id })}
                    aria-pressed={selected}
                    title={textureLabels[id]}
                    className={segmentButtonClassName(selected)}
                    data-testid={`paper-texture-${id}`}
                  >
                    {textureLabels[id]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {t("genealogyBook.settings.borderStyleLabel", "Page frame")}
            </span>
            <div
              className="grid grid-cols-2 gap-2"
              role="group"
              aria-label={t("genealogyBook.settings.borderStyleLabel", "Page frame")}
            >
              {PAPER_BORDER_STYLE_IDS.map((id) => {
                const vars = getPaperBorderStyleVars(id);
                const selected = appearance.borderStyleId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => updateAppearance({ borderStyleId: id })}
                    aria-pressed={selected}
                    title={borderStyleLabels[id]}
                    className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                      selected
                        ? "border-orange-500 ring-1 ring-orange-500/30 dark:border-orange-400"
                        : "border-stone-200 hover:border-stone-300 dark:border-slate-700 dark:hover:border-slate-600"
                    }`}
                    data-testid={`paper-border-style-${id}`}
                  >
                    <span
                      className="relative block h-5 w-6 shrink-0 text-stone-500 dark:text-slate-300"
                      style={{
                        borderStyle: "solid",
                        borderColor: "currentColor",
                        borderWidth: vars["--df-paper-frame-outer"],
                      }}
                      aria-hidden="true"
                    >
                      <span
                        className="absolute"
                        style={{
                          top: vars["--df-paper-frame-pad-tb"],
                          bottom: vars["--df-paper-frame-pad-tb"],
                          left: vars["--df-paper-frame-pad-lr"],
                          right: vars["--df-paper-frame-pad-lr"],
                          borderStyle: "solid",
                          borderColor: "currentColor",
                          borderTopWidth: vars["--df-paper-frame-inner-tb"],
                          borderBottomWidth: vars["--df-paper-frame-inner-tb"],
                          borderLeftWidth: vars["--df-paper-frame-inner-lr"],
                          borderRightWidth: vars["--df-paper-frame-inner-lr"],
                        }}
                      />
                    </span>
                    <span className="min-w-0 truncate text-xs text-slate-700 dark:text-slate-200">
                      {borderStyleLabels[id]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {t("genealogyBook.settings.fontScaleLabel", "Font scale")}
              </span>
              <span className="text-[11px] tabular-nums text-stone-500 dark:text-slate-400">
                {Math.round(appearance.fontScale * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={PAPER_FONT_SCALE_MIN}
              max={PAPER_FONT_SCALE_MAX}
              step={PAPER_FONT_SCALE_STEP}
              value={appearance.fontScale}
              onChange={(event) => updateAppearance({ fontScale: Number(event.target.value) })}
              aria-label={t("genealogyBook.settings.fontScaleLabel", "Font scale")}
              className="w-full accent-orange-500"
              data-testid="paper-font-scale-input"
            />
            <span className="text-[11px] leading-snug text-stone-500 dark:text-slate-400">
              {t(
                "genealogyBook.settings.fontScaleHint",
                "Scales the whole sheet in the preview only",
              )}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {t("genealogyBook.settings.exportMarginLabel", "Page margin")}
              </span>
              <span className="text-[11px] tabular-nums text-stone-500 dark:text-slate-400">
                {appearance.exportMarginPx}px
              </span>
            </div>
            <input
              type="range"
              min={PAPER_EXPORT_MARGIN_MIN}
              max={PAPER_EXPORT_MARGIN_MAX}
              step={PAPER_EXPORT_MARGIN_STEP}
              value={appearance.exportMarginPx}
              onChange={(event) => updateAppearance({ exportMarginPx: Number(event.target.value) })}
              aria-label={t("genealogyBook.settings.exportMarginLabel", "PDF margin")}
              className="w-full accent-orange-500"
              data-testid="paper-export-margin-input"
            />
            <span className="text-[11px] leading-snug text-stone-500 dark:text-slate-400">
              {t(
                "genealogyBook.settings.exportMarginHint",
                "Blank book edge around each leaf, shown in the preview and the exported PDF",
              )}
            </span>
          </div>
        </aside>

        <div ref={exportRef} className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <PaperGenealogyView
            style={style}
            graph={projection.graph}
            rootId={projection.rootId}
            nodesData={projection.nodesData}
            spouseLinks={projection.spouseLinks}
            hasRoot={hasRoot}
            loading={loading}
            contractMessage={contractMessage}
            spineTitleOverride={spineTitleOverride}
            paperVars={paperVars}
            hallName={appearance.hallName ?? undefined}
            fontScale={appearance.fontScale}
            exportMarginPx={appearance.exportMarginPx}
            coverEnabled={appearance.coverEnabled}
            coverInscription={appearance.coverInscription ?? undefined}
          />
        </div>
      </div>
    </div>
  );
}

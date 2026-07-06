import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  ChevronDown,
  FileDown,
  GitMerge,
  Loader2,
  RefreshCw,
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
  PAPER_BACK_COVER_MODES,
  PAPER_BORDER_STYLE_IDS,
  PAPER_COLOR_THEME_IDS,
  PAPER_COVER_STYLE_IDS,
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
  type PaperBackCoverMode,
  type PaperBorderStyleId,
  type PaperColorThemeId,
  type PaperCoverStyleId,
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
    appearance.coverInscription === DEFAULT_PAPER_APPEARANCE.coverInscription &&
    appearance.coverStyleId === DEFAULT_PAPER_APPEARANCE.coverStyleId &&
    appearance.backCoverMode === DEFAULT_PAPER_APPEARANCE.backCoverMode &&
    appearance.showCoverSpine === DEFAULT_PAPER_APPEARANCE.showCoverSpine
  );
}

function CoverStyleThumbnail({ styleId }: { styleId: PaperCoverStyleId }) {
  const verticalText = (
    <span className="absolute left-1/2 top-1/2 h-7 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
  );

  return (
    <span
      className="relative block h-14 w-10 overflow-hidden rounded-[2px] border border-current/50 bg-[#f4eddd] shadow-sm dark:bg-slate-800"
      aria-hidden="true"
      data-testid={`paper-cover-style-thumbnail-${styleId}`}
    >
      {styleId === "traditional-slip" ? (
        <span className="absolute bottom-1.5 right-1.5 top-1.5 w-3 border border-current/70 bg-white/55">
          {verticalText}
        </span>
      ) : null}
      {styleId === "centered-classic" ? (
        <>
          {verticalText}
          <span className="absolute right-1.5 top-1.5 h-2.5 w-1.5 border border-current/60" />
          <span className="absolute bottom-2 left-1/2 h-1 w-1 -translate-x-1/2 bg-current/70" />
        </>
      ) : null}
      {styleId === "minimal-thread" ? (
        <>
          <span className="absolute bottom-2 right-2 top-2 w-2.5 border border-current/60 bg-white/45">
            {verticalText}
          </span>
          <span className="absolute bottom-0 left-1 top-0 border-l border-dashed border-current/60" />
          <span className="absolute left-0.5 top-3 h-1 w-1 rounded-full bg-current/70" />
          <span className="absolute bottom-3 left-0.5 h-1 w-1 rounded-full bg-current/70" />
        </>
      ) : null}
      {styleId === "archive-frame" ? (
        <span className="absolute inset-1.5 border-2 border-current/70 shadow-[inset_0_0_0_2px_rgba(255,255,255,0.45)]">
          {verticalText}
        </span>
      ) : null}
    </span>
  );
}

function SettingsSwitch({
  checked,
  onChange,
  ariaLabel,
  testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
  testId: string;
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={ariaLabel}
        className="peer sr-only"
        data-testid={testId}
      />
      <span
        aria-hidden="true"
        className={`relative h-5 w-9 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-orange-500/40 peer-focus-visible:ring-offset-2 peer-disabled:cursor-not-allowed ${
          checked ? "bg-orange-500" : "bg-stone-300 dark:bg-slate-600"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </span>
    </span>
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
  const coverStyleLabels = useMemo(
    (): Record<PaperCoverStyleId, string> => ({
      "traditional-slip": t("genealogyBook.settings.coverStyles.traditional", "Title slip"),
      "centered-classic": t("genealogyBook.settings.coverStyles.centered", "Centered"),
      "minimal-thread": t("genealogyBook.settings.coverStyles.minimal", "Minimal"),
      "archive-frame": t("genealogyBook.settings.coverStyles.archive", "Archive frame"),
    }),
    [t],
  );
  const backCoverModeLabels = useMemo(
    (): Record<PaperBackCoverMode, string> => ({
      matched: t("genealogyBook.settings.backCoverModes.matched", "Publication colophon"),
      blank: t("genealogyBook.settings.backCoverModes.blank", "Blank"),
    }),
    [t],
  );
  const paperVars = useMemo(() => buildPaperVars(appearance), [appearance]);
  const hasRoot = Boolean(projection.rootId && rootExists);
  const defaultHallName = t("genealogyBook.ouHallName", "DeepFamily");
  const hallNameInputValue = appearance.hallName ?? defaultHallName;
  const fieldInputClassName =
    "h-9 w-full rounded-md border border-stone-300 bg-white px-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-stone-400 hover:border-orange-300 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/30 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:hover:border-orange-700 dark:focus:border-orange-400 dark:focus:ring-orange-400/30";
  const segmentGroupClassName =
    "inline-flex w-full items-center gap-1 rounded-md border border-stone-200 bg-stone-100 p-1 dark:border-slate-700 dark:bg-slate-900";
  const segmentButtonClassName = (selected: boolean) =>
    `h-7 flex-1 rounded px-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 ${
      selected
        ? "bg-white text-orange-700 shadow-sm ring-1 ring-orange-500/20 dark:bg-slate-700 dark:text-orange-200 dark:ring-orange-400/20"
        : "text-stone-600 hover:bg-white/70 hover:text-orange-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-orange-200"
    }`;
  const optionCardStateClassName = (selected: boolean) =>
    selected
      ? "border-orange-400 bg-orange-50/70 text-orange-800 ring-1 ring-orange-500/20 dark:border-orange-600 dark:bg-orange-950/30 dark:text-orange-200 dark:ring-orange-400/20"
      : "border-stone-200 bg-white text-stone-600 hover:border-orange-300 hover:bg-orange-50/50 hover:text-orange-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-orange-800 dark:hover:bg-orange-950/10 dark:hover:text-orange-200";
  const rangeInputClassName =
    "w-full cursor-pointer accent-orange-500 transition-opacity hover:accent-orange-600 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/30 dark:accent-orange-400 dark:hover:accent-orange-300";
  const settingsSummaryClassName =
    "flex cursor-pointer list-none items-center justify-between gap-2 rounded-md px-0.5 py-1.5 text-[13px] font-semibold leading-5 text-slate-800 transition-colors hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 dark:text-slate-100 dark:hover:text-orange-200 [&::-webkit-details-marker]:hidden";

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
      <div className="flex flex-col gap-3 border-b border-stone-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-black md:px-6 xl:flex-row xl:items-center xl:justify-between">
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

        <div
          className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 xl:justify-end"
          data-testid="paper-book-toolbar"
        >
          <div className="hidden items-center gap-2 md:flex" data-testid="paper-book-stats">
            <span className="inline-flex items-baseline gap-1.5 rounded-md bg-stone-100 px-2.5 py-1 dark:bg-slate-800/60">
              <Users
                className="h-3.5 w-3.5 shrink-0 self-center text-stone-400 dark:text-slate-500"
                aria-hidden="true"
              />
              <span className="text-sm font-semibold leading-none tabular-nums text-slate-700 dark:text-slate-200">
                {progress?.created || 0}
              </span>
              <span className="text-xs leading-none text-stone-500 dark:text-slate-400">
                {t("genealogyBook.peopleUnit", "People")}
              </span>
            </span>
            <span className="inline-flex items-baseline gap-1.5 rounded-md bg-stone-100 px-2.5 py-1 dark:bg-slate-800/60">
              <GitMerge
                className="h-3.5 w-3.5 shrink-0 self-center text-stone-400 dark:text-slate-500"
                aria-hidden="true"
              />
              <span className="text-sm font-semibold leading-none tabular-nums text-slate-700 dark:text-slate-200">
                {progress?.depth || 0}
              </span>
              <span className="text-xs leading-none text-stone-500 dark:text-slate-400">
                {t("genealogyBook.generationsUnit", "Generations")}
              </span>
            </span>
          </div>

          <div
            className="order-1 flex min-w-0 max-w-full basis-full items-center gap-2 md:basis-auto"
            data-testid="paper-style-switcher"
          >
            <span className="shrink-0 text-xs font-medium text-stone-500 dark:text-slate-400">
              {t("genealogyBook.styleLabel", "Style")}
            </span>
            <div className="min-w-0 overflow-x-auto rounded-md">
              <div
                className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-stone-100 p-1 dark:border-slate-700 dark:bg-slate-900"
                role="group"
                aria-label={t("genealogyBook.styleSwitchLabel", "Genealogy book style")}
              >
                {PAPER_GENEALOGY_STYLES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setStyle(item)}
                    className={`h-7 shrink-0 rounded px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 ${
                      style === item
                        ? "bg-white text-orange-700 shadow-sm ring-1 ring-orange-500/20 dark:bg-slate-700 dark:text-orange-200 dark:ring-orange-400/20"
                        : "text-stone-600 hover:bg-white/70 hover:text-orange-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-orange-200"
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

          <div
            className="order-2 flex shrink-0 items-center gap-2"
            data-testid="paper-toolbar-actions"
          >
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-600 transition-colors hover:border-orange-300 hover:bg-orange-50/60 hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-orange-800 dark:hover:bg-orange-950/20 dark:hover:text-orange-200"
              title={t("familyTree.actions.refresh", "Refresh")}
              aria-label={t("familyTree.actions.refresh", "Refresh")}
              data-testid="paper-refresh-button"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>

            <button
              type="button"
              onClick={() =>
                exportPdf(exportRef.current, style, paperVars, appearance.exportMarginPx)
              }
              disabled={!hasRoot || loading || exporting}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-orange-600 bg-orange-600 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:border-orange-700 hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 dark:border-orange-500 dark:bg-orange-500 dark:hover:border-orange-400 dark:hover:bg-orange-400"
              title={t("genealogyBook.exportPdf", "Export PDF")}
              data-testid="paper-export-button"
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileDown className="h-3.5 w-3.5" />
              )}
              <span>{t("genealogyBook.exportPdf", "Export PDF")}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside
          className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-stone-200 bg-white p-4 dark:border-slate-800 dark:bg-black md:w-64"
          aria-label={t("genealogyBook.settings.title", "Paper book settings")}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <SlidersHorizontal className="h-4 w-4 shrink-0 text-stone-500 dark:text-slate-400" />
              <span className="truncate">
                {t("genealogyBook.settings.title", "Paper book settings")}
              </span>
            </div>
            <button
              type="button"
              onClick={resetDisplaySettings}
              disabled={!hasCustomDisplaySettings}
              className="shrink-0 text-xs font-medium text-stone-600 transition-colors hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:text-orange-200"
              title={t("genealogyBook.settings.resetDefault", "Reset defaults")}
              data-testid="paper-reset-display-settings"
            >
              {t("genealogyBook.settings.resetDefault", "Reset defaults")}
            </button>
          </div>

          <details open className="group/settings" data-testid="paper-info-settings">
            <summary className={settingsSummaryClassName} data-testid="paper-info-settings-summary">
              <span>{t("genealogyBook.settings.paperInfoLabel", "Book information")}</span>
              <ChevronDown
                className="h-4 w-4 shrink-0 text-stone-400 transition-transform group-open/settings:rotate-180 group-open/settings:text-orange-500 dark:text-slate-500"
                aria-hidden="true"
              />
            </summary>
            <div className="mt-3 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t("genealogyBook.settings.spineTitleLabel", "Genealogy title")}
                </span>
                <input
                  type="text"
                  value={spineTitleInputValue}
                  onChange={(event) => setSpineTitle(event.target.value)}
                  disabled={!hasRoot}
                  placeholder={autoSpineTitle}
                  aria-label={t("genealogyBook.settings.spineTitleLabel", "Genealogy title")}
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
                  {t(
                    "genealogyBook.settings.hallNameHint",
                    "Leave blank to use the default hall name",
                  )}
                </span>
              </label>
            </div>
          </details>

          <details
            className="group/settings border-t border-stone-200 pt-4 dark:border-slate-800"
            data-testid="paper-cover-settings"
          >
            <summary
              className={settingsSummaryClassName}
              data-testid="paper-cover-settings-summary"
            >
              <span>{t("genealogyBook.settings.coverSectionLabel", "Front & back cover")}</span>
              <ChevronDown
                className="h-4 w-4 shrink-0 text-stone-400 transition-transform group-open/settings:rotate-180 group-open/settings:text-orange-500 dark:text-slate-500"
                aria-hidden="true"
              />
            </summary>
            <div className="mt-2 flex flex-col">
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900/70">
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {t("genealogyBook.settings.coverEnabledLabel", "Enable front & back cover")}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-stone-500 dark:text-slate-400">
                    {t(
                      "genealogyBook.settings.coverEnabledHint",
                      "When disabled, the book starts directly with its contents",
                    )}
                  </span>
                </span>
                <SettingsSwitch
                  checked={appearance.coverEnabled}
                  onChange={(checked) => updateAppearance({ coverEnabled: checked })}
                  ariaLabel={t(
                    "genealogyBook.settings.coverEnabledLabel",
                    "Enable front & back cover",
                  )}
                  testId="paper-cover-enabled-input"
                />
              </label>
              {/* Every cover/back-cover control lives inside one disabled fieldset so the whole
                  group dims and locks together when the cover page is turned off. */}
              <fieldset
                className="mt-3 flex flex-col gap-3 transition-opacity disabled:opacity-45"
                disabled={!appearance.coverEnabled}
                aria-label={t("genealogyBook.settings.coverSectionLabel", "Front & back cover")}
              >
                <section
                  className="rounded-lg border border-stone-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/45"
                  data-testid="paper-front-cover-settings"
                >
                  <h4 className="mb-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {t("genealogyBook.settings.frontCoverSectionLabel", "Front cover")}
                  </h4>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium text-stone-500 dark:text-slate-400">
                      {t("genealogyBook.settings.coverStyleLabel", "Layout")}
                    </span>
                    <div
                      className="grid grid-cols-2 gap-2"
                      role="group"
                      aria-label={t("genealogyBook.settings.coverStyleLabel", "Layout")}
                    >
                      {PAPER_COVER_STYLE_IDS.map((id) => {
                        const selected = appearance.coverStyleId === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => updateAppearance({ coverStyleId: id })}
                            className={`flex min-h-[92px] flex-col items-center justify-center gap-1.5 rounded-md border p-2 text-center text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 ${optionCardStateClassName(selected)}`}
                            aria-pressed={selected}
                            data-testid={`paper-cover-style-${id}`}
                          >
                            <CoverStyleThumbnail styleId={id} />
                            <span className="leading-tight">{coverStyleLabels[id]}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-col gap-1.5 border-t border-stone-100 pt-3 dark:border-slate-800">
                    <label
                      htmlFor="paper-cover-inscription-input"
                      className="text-[11px] font-medium text-stone-500 dark:text-slate-400"
                    >
                      {t("genealogyBook.settings.coverInscriptionLabel", "Cover inscription")}
                    </label>
                    <input
                      id="paper-cover-inscription-input"
                      type="text"
                      value={appearance.coverInscription ?? ""}
                      onChange={(event) => updateAppearance({ coverInscription: event.target.value })}
                      placeholder={t(
                        "genealogyBook.settings.coverInscriptionPlaceholder",
                        "For example: Revised in spring 2024",
                      )}
                      className={fieldInputClassName}
                      data-testid="paper-cover-inscription-input"
                    />
                    <span className="text-[11px] leading-snug text-stone-500 dark:text-slate-400">
                      {t(
                        "genealogyBook.settings.coverInscriptionHint",
                        "Optional; use for a revision date or short inscription",
                      )}
                    </span>
                  </div>
                </section>

                <section
                  className="rounded-lg border border-stone-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/45"
                  data-testid="paper-spine-settings"
                >
                  <h4 className="mb-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {t("genealogyBook.settings.spineSectionLabel", "Spine")}
                  </h4>
                  <label className="flex cursor-pointer items-center justify-between gap-3">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      {t("genealogyBook.settings.coverSpineLabel", "Show title and hall name")}
                    </span>
                    <SettingsSwitch
                      checked={appearance.showCoverSpine}
                      onChange={(checked) => updateAppearance({ showCoverSpine: checked })}
                      ariaLabel={t(
                        "genealogyBook.settings.coverSpineLabel",
                        "Show title and hall name",
                      )}
                      testId="paper-cover-spine-input"
                    />
                  </label>
                </section>

                <section
                  className="rounded-lg border border-stone-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/45"
                  data-testid="paper-back-cover-settings"
                >
                  <h4 className="mb-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {t("genealogyBook.settings.backCoverSectionLabel", "Back cover")}
                  </h4>
                  <div className={segmentGroupClassName} role="group">
                    {PAPER_BACK_COVER_MODES.map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => updateAppearance({ backCoverMode: mode })}
                        className={segmentButtonClassName(appearance.backCoverMode === mode)}
                        aria-pressed={appearance.backCoverMode === mode}
                        data-testid={`paper-back-cover-mode-${mode}`}
                      >
                        {backCoverModeLabels[mode]}
                      </button>
                    ))}
                  </div>
                  {appearance.backCoverMode === "matched" ? (
                    <span className="mt-1.5 block text-[11px] leading-snug text-stone-500 dark:text-slate-400">
                      {t(
                        "genealogyBook.settings.backCoverMatchedHint",
                        "The print year and volume count are generated automatically",
                      )}
                    </span>
                  ) : null}
                </section>
              </fieldset>
            </div>
          </details>

          <details
            open
            className="group/settings border-t border-stone-200 pt-4 dark:border-slate-800"
            data-testid="paper-appearance-settings"
          >
            <summary
              className={settingsSummaryClassName}
              data-testid="paper-appearance-settings-summary"
            >
              <span>{t("genealogyBook.settings.paperAppearanceLabel", "Paper appearance")}</span>
              <ChevronDown
                className="h-4 w-4 shrink-0 text-stone-400 transition-transform group-open/settings:rotate-180 group-open/settings:text-orange-500 dark:text-slate-500"
                aria-hidden="true"
              />
            </summary>
            <div className="mt-3 flex flex-col gap-4">
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
                        className={`group/option flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 ${optionCardStateClassName(selected)}`}
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
                        <span
                          className={`min-w-0 truncate text-xs transition-colors ${
                            selected
                              ? "text-orange-800 dark:text-orange-200"
                              : "text-slate-700 group-hover/option:text-orange-700 dark:text-slate-200 dark:group-hover/option:text-orange-200"
                          }`}
                        >
                          {colorThemeLabels[id]}
                        </span>
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
                  {t("genealogyBook.settings.borderStyleLabel", "Page border")}
                </span>
                <div
                  className="grid grid-cols-2 gap-2"
                  role="group"
                  aria-label={t("genealogyBook.settings.borderStyleLabel", "Page border")}
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
                        className={`group/option flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 ${optionCardStateClassName(selected)}`}
                        data-testid={`paper-border-style-${id}`}
                      >
                        <span
                          className={`relative block h-5 w-6 shrink-0 transition-colors ${
                            selected
                              ? "text-orange-700 dark:text-orange-200"
                              : "text-stone-500 group-hover/option:text-orange-700 dark:text-slate-300 dark:group-hover/option:text-orange-200"
                          }`}
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
                        <span
                          className={`min-w-0 truncate text-xs transition-colors ${
                            selected
                              ? "text-orange-800 dark:text-orange-200"
                              : "text-slate-700 group-hover/option:text-orange-700 dark:text-slate-200 dark:group-hover/option:text-orange-200"
                          }`}
                        >
                          {borderStyleLabels[id]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </details>

          <details
            open
            className="group/settings border-t border-stone-200 pt-4 dark:border-slate-800"
            data-testid="paper-typesetting-settings"
          >
            <summary
              className={settingsSummaryClassName}
              data-testid="paper-typesetting-settings-summary"
            >
              <span>{t("genealogyBook.settings.typesettingLabel", "Typesetting")}</span>
              <ChevronDown
                className="h-4 w-4 shrink-0 text-stone-400 transition-transform group-open/settings:rotate-180 group-open/settings:text-orange-500 dark:text-slate-500"
                aria-hidden="true"
              />
            </summary>
            <div className="mt-3 flex flex-col gap-4">
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
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    {t("genealogyBook.settings.fontScaleLabel", "Type scale")}
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
                  aria-label={t("genealogyBook.settings.fontScaleLabel", "Type scale")}
                  className={rangeInputClassName}
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
                  onChange={(event) =>
                    updateAppearance({ exportMarginPx: Number(event.target.value) })
                  }
                  aria-label={t("genealogyBook.settings.exportMarginLabel", "PDF margin")}
                  className={rangeInputClassName}
                  data-testid="paper-export-margin-input"
                />
                <span className="text-[11px] leading-snug text-stone-500 dark:text-slate-400">
                  {t(
                    "genealogyBook.settings.exportMarginHint",
                    "Blank book edge around each leaf, shown in the preview and the exported PDF",
                  )}
                </span>
              </div>
            </div>
          </details>
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
            coverStyleId={appearance.coverStyleId}
            backCoverMode={appearance.backCoverMode}
            showCoverSpine={appearance.showCoverSpine}
          />
        </div>
      </div>
    </div>
  );
}

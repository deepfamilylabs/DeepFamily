import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  buildPaperGenerations,
  buildPaperVars,
  DEFAULT_PAPER_APPEARANCE,
  getPaperSpineTitle,
  isPaperGenealogyStyle,
  loadPaperAppearance,
  loadPaperSpineTitleOverride,
  PAPER_GENEALOGY_STYLE,
  PaperGenealogyView,
  MetadataUnlockControl,
  savePaperAppearance,
  savePaperSpineTitleOverride,
  usePaperReadingView,
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
import { useConfig } from "../domains/config";
import { isMetadataUnlockUsable, type NodeId } from "../shared/model";
import { FamilySettingsDrawer } from "./family/FamilySettingsDrawer";
import { TreePageBar } from "./tree/sections/TreePageBar";
import { PaperBookBar } from "./genealogyBook/PaperBookBar";
import { PaperReadingBar } from "./genealogyBook/PaperReadingBar";
import { PaperSettingsDrawer } from "./genealogyBook/PaperSettingsDrawer";

const LS_STYLE_KEY = "df:paperGenealogyStyle";

// TreePageBar's own height (h-14). It is the chrome that collapses while reading down the book,
// the way /people's family bar gives way to its sticky toolbar.
const FAMILY_BAR_HEIGHT_PX = 56;

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

/**
 * /genealogyBook — the paper volume.
 *
 * The page is a reading surface first: the family bar at the top is shared with /familyTree and
 * /people and stays as it is, and everything below it belongs to this volume. The book gets the
 * whole stage, the settings that shape it slide over on demand rather than holding a column, and
 * how the sheet is viewed (fit, zoom, which leaf) lives on a bar floating over the desk.
 */
export default function GenealogyBookPage() {
  const { t } = useTranslation();
  const [familySettingsOpen, setFamilySettingsOpen] = useState(false);
  const [paperSettingsOpen, setPaperSettingsOpen] = useState(false);
  const [metadataUnlockOpen, setMetadataUnlockOpen] = useState(false);
  const { style, setStyle } = usePersistedPaperStyle();
  const projection = useFamilyTreeProjection();
  const { getStoryData } = useTreeNodeAccess();
  const { rootId, rootExists, nodesData } = useTreeGraphData();
  const { loading, progress, contractMessage, refresh, clearAllCaches } = useTreeStatus();
  const { rootHash, rootVersionIndex } = useConfig();
  const { exporting, exportPdf } = usePaperPdfExport();
  const { stored: spineTitleStored, setSpineTitle } = usePersistedSpineTitle(projection.rootId);
  const { appearance, updateAppearance, resetAppearance } = usePersistedPaperAppearance();
  const exportRef = useRef<HTMLDivElement>(null);
  const familyBarSlotRef = useRef<HTMLDivElement>(null);

  const styleLabels = useMemo(
    (): Record<PaperGenealogyStyle, string> => ({
      [PAPER_GENEALOGY_STYLE.OU]: t("genealogyBook.styles.ou", "Ou-style"),
      [PAPER_GENEALOGY_STYLE.SU]: t("genealogyBook.styles.su", "Su-style"),
      [PAPER_GENEALOGY_STYLE.DIEJI]: t("genealogyBook.styles.dieji", "Dieji-style"),
      [PAPER_GENEALOGY_STYLE.LINEAGE]: t("genealogyBook.styles.lineage", "Lineage Chart"),
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
  const rootLabel = useMemo(() => {
    const fullName = (rootId ? nodesData[rootId]?.fullName : "")?.trim();
    if (fullName) return fullName;
    const hash = (rootHash || "").trim();
    return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
  }, [nodesData, rootHash, rootId]);
  const unlockedCount = useMemo(
    () => Object.values(nodesData).filter(isMetadataUnlockUsable).length,
    [nodesData],
  );
  const defaultHallName = t("genealogyBook.ouHallName", "DeepFamily");
  const hallNameInputValue = appearance.hallName ?? defaultHallName;

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

  // The reading view scales the sheet to the stage and tracks which leaf is in front of the reader.
  // It keys off everything that re-paginates the book, plus the drawer, which narrows the stage.
  const readingView = usePaperReadingView({
    stageRef: exportRef,
    fontScale: appearance.fontScale,
    exportMarginPx: appearance.exportMarginPx,
    collapsibleChromePx: FAMILY_BAR_HEIGHT_PX,
    chromeRef: familyBarSlotRef,
    contentKey: `${style}:${hasRoot}:${paperSettingsOpen}:${projection.graph.nodes.length}`,
  });

  // Without a genealogy there is nothing to read and nothing to scroll, and the family bar carries
  // the only way out of that state (refresh, clear caches, settings) — so it always stays put.
  const familyBarCollapsed = hasRoot && readingView.chromeCollapsed;

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

  // ← / → turn leaves, the way they do in any reader. Ignored while a field has focus so typing a
  // hall name into the drawer never pages the book out from under it.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        readingView.goPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        readingView.goNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readingView]);

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full flex-col overflow-hidden bg-stone-100 dark:bg-slate-950">
      {/* Reading down the book folds the shared family bar away so the 谱式 row meets the site
      header, giving the sheet another 56px; any upward scroll brings it straight back. Hidden via
      `visibility` as well as height so the collapsed nav leaves the focus order. */}
      <div
        ref={familyBarSlotRef}
        className="shrink-0 overflow-hidden"
        style={{
          height: familyBarCollapsed ? 0 : FAMILY_BAR_HEIGHT_PX,
          visibility: familyBarCollapsed ? "hidden" : "visible",
          transition: familyBarCollapsed
            ? "height 200ms ease-out, visibility 0s linear 200ms"
            : "height 200ms ease-out, visibility 0s linear 0s",
        }}
        data-testid="paper-family-bar-slot"
        data-collapsed={String(familyBarCollapsed)}
      >
        <TreePageBar
          t={t}
          rootLabel={rootLabel}
          rootVersion={Number(rootVersionIndex || 1)}
          hasRoot={hasRoot}
          peopleCount={progress?.created || 0}
          generationCount={progress?.depth || 0}
          loading={loading}
          unlockedCount={unlockedCount}
          onOpenUnlock={() => setMetadataUnlockOpen(true)}
          onRefresh={refresh}
          onClearCaches={clearAllCaches}
          configOpen={familySettingsOpen}
          onToggleConfig={() => setFamilySettingsOpen((value) => !value)}
        />
      </div>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <FamilySettingsDrawer
          t={t}
          open={familySettingsOpen}
          onClose={() => setFamilySettingsOpen(false)}
        />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <PaperBookBar
            t={t}
            style={style}
            styleLabels={styleLabels}
            onStyleChange={setStyle}
            settingsOpen={paperSettingsOpen}
            onToggleSettings={() => setPaperSettingsOpen((value) => !value)}
            onExportPdf={() =>
              exportPdf(exportRef.current, style, paperVars, appearance.exportMarginPx)
            }
            exportDisabled={!hasRoot || loading || exporting}
            exporting={exporting}
          />

          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {/* The desk the book sits on. The reading bar floats over it rather than taking a row,
            so the sheet keeps the full height of the stage. */}
            <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
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
                  fontScale={readingView.sheetScale}
                  exportMarginPx={appearance.exportMarginPx}
                  coverEnabled={appearance.coverEnabled}
                  coverInscription={appearance.coverInscription ?? undefined}
                  coverStyleId={appearance.coverStyleId}
                  backCoverMode={appearance.backCoverMode}
                  showCoverSpine={appearance.showCoverSpine}
                />
              </div>
              {hasRoot && readingView.leaf.count > 0 ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex justify-center px-4">
                  <PaperReadingBar t={t} view={readingView} />
                </div>
              ) : null}
            </div>

            <PaperSettingsDrawer
              t={t}
              open={paperSettingsOpen}
              onClose={() => setPaperSettingsOpen(false)}
              appearance={appearance}
              updateAppearance={updateAppearance}
              spineTitleValue={spineTitleInputValue}
              spineTitlePlaceholder={autoSpineTitle}
              onSpineTitleChange={setSpineTitle}
              spineTitleDisabled={!hasRoot}
              hallNameValue={hallNameInputValue}
              hallNamePlaceholder={defaultHallName}
              canReset={hasCustomDisplaySettings}
              onReset={resetDisplaySettings}
              colorThemeLabels={colorThemeLabels}
              fontPresetLabels={fontPresetLabels}
              textureLabels={textureLabels}
              borderStyleLabels={borderStyleLabels}
              coverStyleLabels={coverStyleLabels}
              backCoverModeLabels={backCoverModeLabels}
            />
          </div>
        </div>
      </div>
      <MetadataUnlockControl
        open={metadataUnlockOpen}
        onOpenChange={setMetadataUnlockOpen}
        showTrigger={false}
      />
    </div>
  );
}

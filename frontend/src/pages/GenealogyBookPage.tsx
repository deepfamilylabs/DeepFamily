import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, GitMerge, RefreshCw, ScrollText, Users } from "lucide-react";
import {
  isPaperGenealogyStyle,
  PAPER_GENEALOGY_STYLE,
  PAPER_GENEALOGY_STYLES,
  PaperGenealogyView,
  type PaperGenealogyStyle,
  useFamilyTreeProjection,
  useTreeNodeAccess,
  useTreeGraphData,
  useTreeStatus,
} from "../domains/tree";

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

export default function GenealogyBookPage() {
  const { t } = useTranslation();
  const { style, setStyle } = usePersistedPaperStyle();
  const projection = useFamilyTreeProjection();
  const { getStoryData } = useTreeNodeAccess();
  const { rootExists } = useTreeGraphData();
  const { loading, progress, contractMessage, refresh } = useTreeStatus();

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

  const hasRoot = Boolean(projection.rootId && rootExists);

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

      <div className="min-h-0 flex-1">
        <PaperGenealogyView
          style={style}
          graph={projection.graph}
          rootId={projection.rootId}
          nodesData={projection.nodesData}
          spouseLinks={projection.spouseLinks}
          hasRoot={hasRoot}
          loading={loading}
          contractMessage={contractMessage}
        />
      </div>
    </div>
  );
}

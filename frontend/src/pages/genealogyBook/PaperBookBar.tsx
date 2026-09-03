import { FileDown, Loader2, SlidersHorizontal } from "lucide-react";
import type { TFunction } from "i18next";
import { PAPER_GENEALOGY_STYLES, type PaperGenealogyStyle } from "../../domains/tree";

export interface PaperBookBarProps {
  t: TFunction;
  style: PaperGenealogyStyle;
  styleLabels: Record<PaperGenealogyStyle, string>;
  onStyleChange: (style: PaperGenealogyStyle) => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  onExportPdf: () => void;
  exportDisabled: boolean;
  exporting: boolean;
}

/**
 * The /genealogyBook volume's own bar.
 *
 * The family bar above it (TreePageBar) is shared with /familyTree and /people, so nothing that
 * belongs to this volume alone may live there. This row is what the page owns, and it replaces the
 * old 62px section header whose title block ("族谱纸本视图 / 以传统族谱风格实时预览") only repeated
 * the 族谱 tab directly above it. Dropping the title leaves the row to carry the one document-level
 * switch — 谱式 — plus the two document actions; how the book is *viewed* (zoom, leaf) lives on the
 * floating reading bar over the sheet instead.
 */
export function PaperBookBar({
  t,
  style,
  styleLabels,
  onStyleChange,
  settingsOpen,
  onToggleSettings,
  onExportPdf,
  exportDisabled,
  exporting,
}: PaperBookBarProps) {
  return (
    <div
      className="flex h-[46px] shrink-0 items-center justify-between gap-4 border-b border-hairline bg-surface px-3 md:px-6"
      data-testid="paper-book-toolbar"
    >
      <div className="flex min-w-0 items-center gap-2.5" data-testid="paper-style-switcher">
        <span className="hidden shrink-0 text-xs font-medium text-ink-subtle sm:inline">
          {t("genealogyBook.styleLabel", "Style")}
        </span>
        <div className="min-w-0 overflow-x-auto">
          <div
            className="inline-flex items-center gap-0.5 rounded-lg border border-hairline bg-surface-muted p-[3px]"
            role="group"
            aria-label={t("genealogyBook.styleSwitchLabel", "Genealogy book style")}
          >
            {PAPER_GENEALOGY_STYLES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onStyleChange(item)}
                className={`h-[26px] shrink-0 rounded-md px-2.5 text-[13px] transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  style === item
                    ? "bg-surface font-semibold text-orange-700 shadow-xs dark:text-orange-200"
                    : "font-medium text-ink-muted hover:text-ink"
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

      <div className="flex shrink-0 items-center gap-2" data-testid="paper-toolbar-actions">
        <button
          type="button"
          onClick={onToggleSettings}
          aria-expanded={settingsOpen}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 ${
            settingsOpen
              ? "border-hairline-strong bg-surface-muted text-ink"
              : "border-hairline bg-surface text-ink-muted hover:border-hairline-strong hover:text-ink"
          }`}
          data-testid="paper-settings-toggle"
        >
          <SlidersHorizontal className="h-[15px] w-[15px]" />
          <span className="hidden md:inline">
            {t("genealogyBook.settings.title", "Paper book settings")}
          </span>
        </button>

        <button
          type="button"
          onClick={onExportPdf}
          disabled={exportDisabled}
          title={t("genealogyBook.exportPdf", "Export PDF")}
          aria-label={t("genealogyBook.exportPdf", "Export PDF")}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-semibold text-white transition-colors hover:bg-primary-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="paper-export-button"
        >
          {exporting ? (
            <Loader2 className="h-[15px] w-[15px] animate-spin" />
          ) : (
            <FileDown className="h-[15px] w-[15px]" />
          )}
          <span className="hidden sm:inline">{t("genealogyBook.exportPdf", "Export PDF")}</span>
        </button>
      </div>
    </div>
  );
}

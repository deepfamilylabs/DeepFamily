import { useTranslation } from "react-i18next";

export interface ConfigFormActionsProps {
  hasDiff: boolean;
  onReset: () => void;
  onSave: () => void;
}

/**
 * The drawer's standing footer.
 *
 * Connection settings — network, reader, root, version — only take effect on
 * save, so the bar states whether anything is pending rather than leaving the
 * user to infer it from a disabled button. It stays docked at the bottom: the
 * form scrolls past two screens, and the actions must not scroll away with it.
 */
export default function ConfigFormActions({ hasDiff, onReset, onSave }: ConfigFormActionsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-hairline bg-surface px-3 py-2.5">
      <span
        className={`inline-flex min-w-0 items-center gap-1.5 text-[11px] ${
          hasDiff ? "text-warning" : "text-ink-subtle"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${hasDiff ? "bg-warning" : "bg-hairline-strong"}`}
          aria-hidden
        />
        <span className="truncate">
          {hasDiff
            ? t("familyTree.config.unsavedChanges", "Unsaved changes")
            : t("familyTree.config.savedMatches", "Matches saved settings")}
        </span>
      </span>

      <span className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={onReset}
          title={t("familyTree.config.resetToDefaults")}
          className="h-8 rounded-lg border border-hairline bg-surface px-3 text-xs text-ink-muted transition-colors hover:border-hairline-strong hover:text-ink"
        >
          {t("familyTree.config.reset")}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!hasDiff}
          className="h-8 rounded-lg bg-primary px-3.5 text-xs font-semibold text-white transition-colors hover:bg-primary-hover disabled:bg-surface-muted disabled:text-ink-subtle"
        >
          {t("familyTree.ui.save")}
        </button>
      </span>
    </div>
  );
}

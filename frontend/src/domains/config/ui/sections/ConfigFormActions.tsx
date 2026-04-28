import { useTranslation } from "react-i18next";

export interface ConfigFormActionsProps {
  hasDiff: boolean;
  onReset: () => void;
  onSave: () => void;
}

export default function ConfigFormActions({
  hasDiff,
  onReset,
  onSave,
}: ConfigFormActionsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-2">
      <button
        onClick={onReset}
        className="px-3 py-1.5 text-xs rounded-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-md hover:shadow-lg transition-all duration-200 font-semibold"
        title={t("familyTree.config.resetToDefaults")}
      >
        {t("familyTree.config.reset")}
      </button>
      <button
        onClick={onSave}
        disabled={!hasDiff}
        className={`px-3 py-1.5 text-xs rounded-full transition-all duration-200 font-semibold ${
          hasDiff
            ? "bg-gradient-to-r from-orange-400 to-red-500 hover:from-orange-500 hover:to-red-600 text-white shadow-md hover:shadow-lg"
            : "bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed"
        }`}
      >
        {t("familyTree.ui.save")}
      </button>
    </div>
  );
}

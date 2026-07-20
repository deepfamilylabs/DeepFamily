import { useTranslation } from "react-i18next";

export interface VersionStepperProps {
  value: number;
  onChange: (v: number) => void;
  decrement: () => void;
  increment: () => void;
}

export default function VersionStepper({
  value,
  onChange,
  decrement,
  increment,
}: VersionStepperProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label className="text-slate-700 dark:text-slate-300 font-semibold text-xs">
        {t("familyTree.ui.versionNumber")}:
      </label>
      <div className="inline-flex items-center rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-xs h-8 overflow-hidden">
        <button
          className="w-8 h-full flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-orange-600 hover:bg-slate-50 dark:hover:bg-slate-700 dark:hover:text-orange-400 transition-colors duration-150 text-sm font-medium"
          onClick={decrement}
          aria-label="Decrease version"
        >
          -
        </button>
        <input
          type="number"
          min={1}
          value={value}
          onChange={(e) => onChange(Math.max(1, Number(e.target.value)))}
          className="w-12 h-full text-xs text-center border-0 border-l border-r border-slate-200 dark:border-slate-700 bg-transparent text-slate-700 dark:text-slate-200 focus:outline-hidden focus:ring-0 font-medium p-0"
        />
        <button
          className="w-8 h-full flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-orange-600 hover:bg-slate-50 dark:hover:bg-slate-700 dark:hover:text-orange-400 transition-colors duration-150 text-sm font-medium"
          onClick={increment}
          aria-label="Increase version"
        >
          +
        </button>
      </div>
    </div>
  );
}

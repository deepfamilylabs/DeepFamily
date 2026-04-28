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
    <div>
      <label className="block text-slate-700 dark:text-slate-300 mb-2 font-semibold">
        {t("familyTree.ui.versionNumber")}:
      </label>
      <div className="inline-flex items-center rounded-2xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-sm h-[38px] overflow-hidden">
        <button
          className="w-8 h-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors duration-150 text-sm font-medium"
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
          className="w-24 h-full text-sm text-center border-0 border-l border-r border-slate-300 dark:border-slate-600 bg-transparent text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-0 font-medium"
        />
        <button
          className="w-8 h-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors duration-150 text-sm font-medium"
          onClick={increment}
          aria-label="Increase version"
        >
          +
        </button>
      </div>
    </div>
  );
}

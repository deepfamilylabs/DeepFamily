import { useTranslation } from "react-i18next";

export interface ContractAddressFieldProps {
  value: string;
  onChange: (v: string) => void;
  error?: string;
}

export default function ContractAddressField({
  value,
  onChange,
  error,
}: ContractAddressFieldProps) {
  const { t } = useTranslation();
  return (
    <div className="flex-1">
      <label className="block text-slate-700 dark:text-slate-300 mb-2 font-semibold">
        {t("familyTree.config.contract")}:
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-3 py-2 text-sm font-mono rounded-2xl border bg-white/90 dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all duration-200 backdrop-blur-sm shadow-sm ${
          error
            ? "border-red-400 focus:border-red-500 focus:ring-red-500/60 dark:border-red-500"
            : "border-slate-300 dark:border-slate-600 focus:border-orange-500 focus:ring-orange-500/60 dark:focus:border-orange-400 dark:focus:ring-orange-400/60 hover:border-orange-400 dark:hover:border-orange-500"
        }`}
      />
      {error && (
        <div className="text-red-500 dark:text-red-400 text-xs mt-1.5 font-medium">
          {t(error, "Contract address format error")}
        </div>
      )}
    </div>
  );
}

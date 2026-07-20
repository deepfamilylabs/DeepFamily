import { useTranslation } from "react-i18next";

export interface CustomNetworkFormProps {
  name: string;
  chainId: number | "";
  rpc: string;
  error: string | null;
  showCspHint: boolean;
  setName: (v: string) => void;
  setChainId: (v: number | "") => void;
  setRpc: (v: string) => void;
  submit: () => void;
}

export default function CustomNetworkForm({
  name,
  chainId,
  rpc,
  error,
  showCspHint,
  setName,
  setChainId,
  setRpc,
  submit,
}: CustomNetworkFormProps) {
  const { t } = useTranslation();

  const inputClass =
    "px-3 py-1.5 text-xs rounded-xl border bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all duration-200 border-slate-300 dark:border-slate-600 focus:border-orange-500 focus:ring-orange-500/60 dark:focus:border-orange-400 dark:focus:ring-orange-400/60 shadow-xs";

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/60 p-3 space-y-2.5">
      <div className="flex flex-col gap-2.5">
        <input
          type="text"
          placeholder={t("familyTree.config.customNetworkName", "Network name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`${inputClass} w-full`}
        />
        <input
          type="number"
          placeholder={t("familyTree.config.chainId", "Chain ID")}
          value={chainId}
          onChange={(e) => setChainId(e.target.value === "" ? "" : Number(e.target.value))}
          className={`${inputClass} w-full`}
        />
        <input
          type="text"
          placeholder="https://"
          value={rpc}
          onChange={(e) => setRpc(e.target.value)}
          className={`${inputClass} w-full font-mono`}
        />
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="space-y-1 flex-1">
          <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
            {t("familyTree.config.addCustomNetworkHint", "Fill in and save to reuse later")}
          </div>
          {showCspHint && (
            <div className="text-[10px] text-orange-500/80 dark:text-orange-400/80 leading-tight">
              {t(
                "familyTree.config.customNetworkCspHint",
                "In preview/production, the RPC origin must be allowlisted by CSP (connect-src).",
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={submit}
          className="shrink-0 px-3 py-1.5 text-xs rounded-full bg-linear-to-r from-orange-400 to-red-500 hover:from-orange-500 hover:to-red-600 text-white font-semibold shadow-xs hover:shadow-md transition-all duration-200"
        >
          {t("familyTree.config.addCustomNetwork", "Save custom")}
        </button>
      </div>

      {error && (
        <div className="text-red-500 dark:text-red-400 text-xs font-medium bg-red-50 dark:bg-red-900/20 px-2 py-1.5 rounded-lg border border-red-100 dark:border-red-800/50">
          {error}
        </div>
      )}
    </div>
  );
}

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
    "px-3 py-2 text-sm rounded-xl border bg-white/90 dark:bg-slate-900/70 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all duration-200 border-slate-300 dark:border-slate-600 focus:border-orange-500 focus:ring-orange-500/60 dark:focus:border-orange-400 dark:focus:ring-orange-400/60";

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/50 p-3 space-y-2">
      <div className="grid grid-cols-1 gap-2">
        <input
          type="text"
          placeholder={t("familyTree.config.customNetworkName", "Network name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
        <input
          type="number"
          placeholder={t("familyTree.config.chainId", "Chain ID")}
          value={chainId}
          onChange={(e) => setChainId(e.target.value === "" ? "" : Number(e.target.value))}
          className={inputClass}
        />
        <input
          type="text"
          placeholder="https://"
          value={rpc}
          onChange={(e) => setRpc(e.target.value)}
          className={inputClass}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {t("familyTree.config.addCustomNetworkHint", "Fill in and save to reuse later")}
          </div>
          {showCspHint && (
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t(
                "familyTree.config.customNetworkCspHint",
                "In preview/production, the RPC origin must be allowlisted by CSP (connect-src). If it fails to connect, add the origin via DEEP_CSP_CONNECT_SRC when running preview/build.",
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={submit}
          className="px-3 py-1.5 text-xs rounded-full bg-gradient-to-r from-orange-400 to-red-500 hover:from-orange-500 hover:to-red-600 text-white font-semibold shadow-sm hover:shadow-md transition-all duration-200"
        >
          {t("familyTree.config.addCustomNetwork", "Save custom")}
        </button>
      </div>
      {error && (
        <div className="text-red-500 dark:text-red-400 text-xs font-medium">{error}</div>
      )}
    </div>
  );
}

import { useTranslation } from "react-i18next";
import { MODAL_FIELD_SM } from "../../../../shared/ui";
import { CONFIG_HINT } from "./ConfigControls";

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

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-hairline bg-surface-alt p-3">
      <input
        type="text"
        placeholder={t("familyTree.config.customNetworkName", "Network name")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={MODAL_FIELD_SM}
      />
      <input
        type="number"
        placeholder={t("familyTree.config.chainId", "Chain ID")}
        value={chainId}
        onChange={(e) => setChainId(e.target.value === "" ? "" : Number(e.target.value))}
        className={MODAL_FIELD_SM}
      />
      <input
        type="text"
        placeholder="https://"
        value={rpc}
        onChange={(e) => setRpc(e.target.value)}
        className={`${MODAL_FIELD_SM} font-mono`}
      />

      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={CONFIG_HINT}>
            {t("familyTree.config.addCustomNetworkHint", "Fill in and save to reuse later")}
          </span>
          {showCspHint ? (
            <span className="text-[11px] leading-relaxed text-warning">
              {t(
                "familyTree.config.customNetworkCspHint",
                "In preview/production, the RPC origin must be allowlisted by CSP (connect-src).",
              )}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={submit}
          className="h-8 shrink-0 rounded-lg bg-primary px-3 text-xs font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          {t("familyTree.config.addCustomNetwork", "Save custom")}
        </button>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-[11px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

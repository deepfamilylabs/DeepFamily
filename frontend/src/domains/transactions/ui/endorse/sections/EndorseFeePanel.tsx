import { AlertCircle } from "lucide-react";
import { MODAL_CARD } from "../../../../../shared/ui";
import type { EndorseT } from "../model/endorseTypes";

export interface EndorseFeePanelProps {
  t: EndorseT;
  deepTokenFee: string;
  userDeepBalance: string;
  canAffordEndorsement: boolean;
  hasEndorsed: boolean;
  isNFTMinted: boolean;
  protocolFeeBps: number;
}

/** Group a plain integer string; leaves anything else (already formatted, "—") alone. */
function group(value: string) {
  if (!/^\d+$/.test(value.trim())) return value;
  return Number(value).toLocaleString("en-US");
}

export function EndorseFeePanel({
  t,
  deepTokenFee,
  userDeepBalance,
  canAffordEndorsement,
  hasEndorsed,
  isNFTMinted,
  protocolFeeBps,
}: EndorseFeePanelProps) {
  const recipientPercent = (10000 - protocolFeeBps) / 100;
  const protocolPercent = protocolFeeBps / 100;

  return (
    <div className={`${MODAL_CARD} overflow-hidden`}>
      <div className="flex items-baseline justify-between gap-4 p-4 border-b border-hairline">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink">
            {t("endorse.deepTokenFee", "Endorsement fee")}
          </div>
          <div className="text-xs text-ink-muted">
            {t("endorse.feeEqualsReward", "Equal to the current mining reward")}
          </div>
        </div>
        <div className="flex items-baseline gap-1.5 shrink-0">
          <span className="font-mono text-2xl font-semibold tracking-tight text-ink">
            {group(deepTokenFee)}
          </span>
          <span className="text-xs font-semibold text-ink-muted">DEEP</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-hairline">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-xs text-ink-muted">{t("endorse.yourBalance", "Your balance")}</span>
          <span
            className={`font-mono text-[13px] font-semibold ${
              canAffordEndorsement ? "text-ink" : "text-danger"
            }`}
          >
            {group(userDeepBalance)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-xs text-ink-muted">
            {isNFTMinted
              ? t("endorse.toNftHolder", "To NFT holder")
              : t("endorse.toCreator", "To creator")}
          </span>
          <span className="font-mono text-[13px] font-semibold text-ink">{recipientPercent}%</span>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-xs text-ink-muted">
            {t("endorse.protocolFee", "Protocol fee")}
          </span>
          <span className="font-mono text-[13px] font-semibold text-ink">{protocolPercent}%</span>
        </div>
      </div>

      {!canAffordEndorsement && !hasEndorsed && (
        <div className="flex items-start gap-2 px-4 py-3 border-t border-danger/25 bg-danger/8">
          <AlertCircle className="w-4 h-4 mt-0.5 text-danger shrink-0" aria-hidden />
          <p className="text-xs font-medium text-red-700 dark:text-red-300">
            {t("endorse.needMoreTokens", "You need more DEEP tokens to endorse this version")}
          </p>
        </div>
      )}
    </div>
  );
}

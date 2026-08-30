import { Coins, Image, Search, ShieldCheck } from "lucide-react";
import { MODAL_CARD } from "../../../../../shared/ui";
import type { EndorseT } from "../model/endorseTypes";

export function EndorseBenefitsPanel({ t }: { t: EndorseT }) {
  const benefits = [
    { Icon: ShieldCheck, text: t("endorse.benefitQuality", "Help verify and improve data quality") },
    {
      Icon: Search,
      text: t("endorse.benefitPriority", "Endorsed versions get higher priority in searches"),
    },
    { Icon: Image, text: t("endorse.benefitNFT", "Required step before minting NFTs") },
    { Icon: Coins, text: t("endorse.benefitEconomy", "Support version creators and NFT holders") },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {benefits.map(({ Icon, text }) => (
        <div key={text} className={`${MODAL_CARD} p-3.5 flex flex-col gap-2`}>
          <Icon className="w-[17px] h-[17px] text-emerald-600 dark:text-emerald-400" aria-hidden />
          <span className="text-xs leading-relaxed text-ink-muted">{text}</span>
        </div>
      ))}
    </div>
  );
}

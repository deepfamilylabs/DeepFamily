import { Check, Star } from "lucide-react";
import type { EndorseT } from "../model/endorseTypes";

export function EndorseBenefitsPanel({ t }: { t: EndorseT }) {
  const benefits = [
    t("endorse.benefitQuality", "Help verify and improve data quality"),
    t("endorse.benefitPriority", "Endorsed versions get higher priority in searches"),
    t("endorse.benefitNFT", "Required step before minting NFTs"),
    t("endorse.benefitEconomy", "Support version creators and NFT holders"),
  ];

  return (
    <div className="bg-gradient-to-br from-orange-50/50 to-red-50/50 dark:from-orange-900/5 dark:to-red-900/5 rounded-2xl border border-orange-100/50 dark:border-orange-900/20 p-5 mt-4">
      <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
        <Star className="w-4 h-4 text-orange-500 dark:text-orange-400 fill-orange-500/20" />
        {t("endorse.benefits", "Benefits of Endorsing")}
      </h3>
      <ul className="space-y-2.5">
        {benefits.map((benefit) => (
          <li
            key={benefit}
            className="flex items-start gap-2.5 text-xs font-medium text-gray-600 dark:text-gray-300"
          >
            <div className="w-4 h-4 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0 mt-0.5">
              <Check className="w-2.5 h-2.5 text-orange-600 dark:text-orange-400" />
            </div>
            <span className="leading-relaxed">{benefit}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

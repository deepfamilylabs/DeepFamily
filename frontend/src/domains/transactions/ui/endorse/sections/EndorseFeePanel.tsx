import { AlertCircle, Coins } from "lucide-react";
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
    <div className="bg-gray-50/50 dark:bg-gray-800/50 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
              <Coins className="w-4 h-4 text-orange-600 dark:text-orange-400" />
            </div>
            {t("endorse.deepTokenFee", "Endorsement fee")}
          </span>
          <span className="font-bold font-mono text-xl text-orange-600 dark:text-orange-400">
            {deepTokenFee} <span className="text-sm text-gray-500 dark:text-gray-400 ml-1">DEEP</span>
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-600 dark:text-gray-400 font-medium">
            {t("endorse.yourBalance", "Your balance")}:
          </span>
          <span
            className={`font-mono font-bold ${
              canAffordEndorsement ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
            }`}
          >
            {userDeepBalance} DEEP
          </span>
        </div>

        {!canAffordEndorsement && !hasEndorsed && (
          <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-100 dark:border-red-900/30">
            <AlertCircle className="w-4 h-4 mt-0.5 text-red-600 dark:text-red-400 shrink-0" />
            <p className="text-xs font-bold text-red-700 dark:text-red-300">
              {t("endorse.needMoreTokens", "You need more DEEP tokens to endorse this version")}
            </p>
          </div>
        )}

        <div className="pt-3 mt-1 border-t border-orange-100 dark:border-orange-900/10">
          <div className="flex flex-col gap-1.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                <div className="w-1 h-3 rounded-full bg-gradient-to-b from-orange-400 to-red-600"></div>
                {t("endorse.feeDistribution", "Fee Distribution")}
              </span>
            </div>
            <span className="text-gray-600 dark:text-gray-400 leading-relaxed pl-2.5">
              {isNFTMinted ? (
                <>
                  <strong className="text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-900/30 px-1.5 py-0.5 rounded text-xs uppercase tracking-wider mr-1.5">
                    {t("endorse.nftMinted", "NFT Minted")}
                  </strong>
                  {t(
                    "endorse.feeToNFTHolder",
                    "{{recipientPercent}}% to NFT holder, {{protocolPercent}}% protocol fee",
                    { recipientPercent, protocolPercent },
                  )}
                </>
              ) : (
                <>
                  <strong className="text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs uppercase tracking-wider mr-1.5">
                    {t("endorse.noNFT", "No NFT Yet")}
                  </strong>
                  {t(
                    "endorse.feeToCreator",
                    "{{recipientPercent}}% to version creator, {{protocolPercent}}% protocol fee",
                    { recipientPercent, protocolPercent },
                  )}
                </>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

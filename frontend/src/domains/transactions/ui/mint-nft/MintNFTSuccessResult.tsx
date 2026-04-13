import { Check, ChevronRight } from "lucide-react";
import { ResultDataRow } from "../shared/ResultDataRow";

type MintNFTSuccessResultProps = {
  t: (key: string, fallback: string) => string;
  successResult: {
    personHash: string;
    versionIndex: number;
    tokenId: number;
    tokenURI?: string;
    transactionHash: string;
    blockNumber: number;
    events: { PersonNFTMinted: any };
  };
};

export function MintNFTSuccessResult({ t, successResult }: MintNFTSuccessResultProps) {
  const event = successResult.events.PersonNFTMinted;

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl border border-green-200 dark:border-green-700">
        <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
          <Check className="w-6 h-6 text-white" />
        </div>
        <div>
          <h3 className="text-base font-bold text-green-900 dark:text-green-100">
            {t("mintNFT.successTitle", "NFT Minted Successfully")}
          </h3>
          <p className="text-sm text-green-700 dark:text-green-300">
            {t("mintNFT.successDesc", "Your NFT has been created on the blockchain")}
          </p>
        </div>
      </div>

      {event && (
        <details
          className="group bg-orange-50 dark:bg-orange-900/20 rounded-xl border border-orange-200 dark:border-orange-700 overflow-hidden"
          open
        >
          <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-colors">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-orange-600 rounded-full"></div>
              <span className="text-sm font-bold text-orange-900 dark:text-orange-100">
                {t("mintNFT.nftDetails", "NFT Details")}
              </span>
              <span className="ml-2 text-xs font-bold text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-800 px-2 py-0.5 rounded-full uppercase tracking-wide">
                #{successResult.tokenId}
              </span>
            </div>
            <ChevronRight className="w-4 h-4 text-orange-600 group-open:rotate-90 transition-transform" />
          </summary>
          <div className="px-3 pb-3 space-y-3">
            <div className="space-y-2">
              <ResultDataRow
                label={t("mintNFT.personHash", "Person Hash")}
                value={successResult.personHash}
                colorClass="orange"
              />
              <ResultDataRow
                label={t("mintNFT.tokenId", "Token ID")}
                value={`#${successResult.tokenId}`}
                colorClass="orange"
              />
              <ResultDataRow
                label={t("mintNFT.versionIndex", "Version Index")}
                value={successResult.versionIndex.toString()}
                colorClass="orange"
              />
              {successResult.tokenURI && (
                <ResultDataRow
                  label={t("mintNFT.tokenURI", "Token URI")}
                  value={successResult.tokenURI}
                  colorClass="orange"
                />
              )}
              <ResultDataRow
                label={t("mintNFT.owner", "Owner")}
                value={event.owner}
                colorClass="orange"
              />
            </div>

            <div className="pt-2 border-t border-orange-200/50 dark:border-orange-700/50">
              <p className="text-xs font-bold text-orange-800 dark:text-orange-200 mb-2 uppercase tracking-wide">
                {t("mintNFT.transactionInfo", "Transaction Info")}
              </p>
              <div className="space-y-2">
                <ResultDataRow
                  label={t("mintNFT.transactionHash", "Transaction Hash")}
                  value={successResult.transactionHash}
                  colorClass="orange"
                />
                <ResultDataRow
                  label={t("mintNFT.blockNumber", "Block Number")}
                  value={successResult.blockNumber.toString()}
                  colorClass="orange"
                />
                <ResultDataRow
                  label={t("mintNFT.timestamp", "Timestamp")}
                  value={new Date(Number(event.timestamp) * 1000).toLocaleString()}
                  colorClass="orange"
                  isPlainText
                />
              </div>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

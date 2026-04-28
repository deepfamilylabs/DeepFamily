import { AlertCircle } from "lucide-react";
import { TransactionButton } from "../../shared/TransactionButton";
import type { MintNFTT } from "../model/mintNftTypes";

export interface EndorseRequiredDialogProps {
  t: MintNFTT;
  open: boolean;
  onCancel: () => void;
  onGoEndorse: () => void;
}

export function EndorseRequiredDialog({
  t,
  open,
  onCancel,
  onGoEndorse,
}: EndorseRequiredDialogProps) {
  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="w-full max-w-sm rounded-lg bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-lg p-6"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mint-nft-endorse-required-title"
      >
        <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4">
          <AlertCircle className="w-6 h-6 text-blue-600 dark:text-blue-400" />
        </div>
        <h3
          id="mint-nft-endorse-required-title"
          className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2"
        >
          {t("mintNFT.endorsementRequiredTitle", "Endorsement Required")}
        </h3>
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
          {t(
            "mintNFT.endorsementRequiredDesc",
            "You must endorse this version before minting. Would you like to go endorse now?",
          )}
        </p>
        <div className="flex gap-3">
          <TransactionButton
            onClick={onCancel}
            className="flex-1"
          >
            {t("common.cancel", "Cancel")}
          </TransactionButton>
          <TransactionButton
            variant="info"
            onClick={onGoEndorse}
            className="flex-1"
          >
            {t("mintNFT.goEndorse", "Go Endorse")}
          </TransactionButton>
        </div>
      </div>
    </div>
  );
}

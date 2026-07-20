import { Check, Image, Star } from "lucide-react";
import { TransactionButton } from "../../shared/TransactionButton";
import type { EndorseSuccessResultView, EndorseT } from "../model/endorseTypes";

export interface EndorseFooterProps {
  t: EndorseT;
  successResult: EndorseSuccessResultView | null;
  isSubmitting: boolean;
  isApproving: boolean;
  canAffordEndorsement: boolean;
  hasEndorsed: boolean;
  hasValidTarget: boolean;
  isTargetValidOnChain: boolean;
  isPersonHashFormatValid: boolean;
  onClose: () => void;
  onContinueEndorsing: () => void;
  onEndorse: () => void;
  onMintNFT?: (personHash: string, versionIndex: number) => void;
}

export function EndorseFooter({
  t,
  successResult,
  isSubmitting,
  isApproving,
  canAffordEndorsement,
  hasEndorsed,
  hasValidTarget,
  isTargetValidOnChain,
  isPersonHashFormatValid,
  onClose,
  onContinueEndorsing,
  onEndorse,
  onMintNFT,
}: EndorseFooterProps) {
  return (
    <div className="flex gap-4 p-6 bg-white dark:bg-gray-950 border-t border-gray-100 dark:border-gray-800 pb-[calc(2rem+env(safe-area-inset-bottom))]">
      {successResult ? (
        <div className="flex flex-col sm:flex-row gap-3 w-full">
          <TransactionButton
            onClick={onClose}
            className="flex-1"
          >
            {t("common.close", "Close")}
          </TransactionButton>
          <TransactionButton
            variant="subtle"
            onClick={onContinueEndorsing}
            className="flex-1"
          >
            <Star className="w-4 h-4 fill-current/20" />
            {t("endorse.continueEndorsing", "Continue Endorsing")}
          </TransactionButton>
          <TransactionButton
            variant="primary"
            onClick={() => {
              if (onMintNFT && successResult.personHash && successResult.versionIndex) {
                onMintNFT(successResult.personHash, successResult.versionIndex);
              }
            }}
            className="flex-1"
          >
            <Image className="w-4 h-4 fill-current/20" />
            {t("endorse.goToMintNFT", "Go to Mint NFT")}
          </TransactionButton>
        </div>
      ) : (
        <div className="flex gap-3 w-full">
          <TransactionButton
            onClick={onClose}
            className="flex-1"
          >
            {t("common.cancel", "Cancel")}
          </TransactionButton>
          <TransactionButton
            variant="primary"
            onClick={onEndorse}
            disabled={
              isSubmitting ||
              isApproving ||
              !canAffordEndorsement ||
              hasEndorsed ||
              !hasValidTarget ||
              !isTargetValidOnChain ||
              !isPersonHashFormatValid
            }
            className="flex-2"
          >
            {isApproving ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {t("endorse.approving", "Approving...")}
              </div>
            ) : isSubmitting ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {t("endorse.endorsing", "Endorsing...")}
              </div>
            ) : hasEndorsed ? (
              <div className="flex items-center justify-center gap-2">
                <Check className="w-4 h-4" />
                {t("endorse.endorsed", "Endorsed!")}
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <Star className="w-4 h-4 fill-current/20" />
                {t("endorse.endorse", "Endorse")}
              </div>
            )}
          </TransactionButton>
        </div>
      )}
    </div>
  );
}

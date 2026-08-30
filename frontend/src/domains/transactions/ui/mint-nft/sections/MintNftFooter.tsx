import { ChevronRight } from "lucide-react";
import { TransactionButton } from "../../shared/TransactionButton";
import type { MintNFTSuccessResultView, MintNFTT } from "../model/mintNftTypes";

export interface MintNftFooterProps {
  t: MintNFTT;
  successResult: MintNFTSuccessResultView | null;
  isSubmitting: boolean;
  isCheckingStatus: boolean;
  isEndorsed: boolean;
  isAlreadyMinted: boolean;
  allConsentsChecked: boolean;
  hasPersonInfo: boolean;
  hasTargetInputs: boolean;
  hasValidTarget: boolean;
  hasVerifiedTargetEnvelope: boolean;
  onClose: () => void;
  onContinueMinting: () => void;
  onShowEndorseConfirm: () => void;
}

export function MintNftFooter({
  t,
  successResult,
  isSubmitting,
  isCheckingStatus,
  isEndorsed,
  isAlreadyMinted,
  allConsentsChecked,
  hasPersonInfo,
  hasTargetInputs,
  hasValidTarget,
  hasVerifiedTargetEnvelope,
  onClose,
  onContinueMinting,
  onShowEndorseConfirm,
}: MintNftFooterProps) {
  return (
    <div className="flex flex-col-reverse sm:flex-row gap-2.5 px-5 py-3.5 bg-surface border-t border-hairline pb-[calc(0.875rem+env(safe-area-inset-bottom))]">
      {successResult ? (
        <>
          <TransactionButton onClick={onClose} className="flex-1">
            {t("common.close", "Close")}
          </TransactionButton>
          <TransactionButton variant="primary" onClick={onContinueMinting} className="flex-1">
            {t("mintNFT.continueMinting", "Continue Minting")}
          </TransactionButton>
        </>
      ) : (
        <>
          <TransactionButton onClick={onClose} className="flex-1">
            {t("common.cancel", "Cancel")}
          </TransactionButton>

          {!isAlreadyMinted && (
            <>
              {hasValidTarget && !isEndorsed ? (
                <TransactionButton
                  variant="info"
                  onClick={onShowEndorseConfirm}
                  disabled={isCheckingStatus}
                  className="flex-[1.5]"
                >
                  {t("mintNFT.goEndorse", "Go Endorse")}
                </TransactionButton>
              ) : (
                <TransactionButton
                  type="submit"
                  variant="primary"
                  disabled={
                    isSubmitting ||
                    isCheckingStatus ||
                    !allConsentsChecked ||
                    !hasPersonInfo ||
                    !hasTargetInputs ||
                    !hasVerifiedTargetEnvelope
                  }
                  className="flex-[1.5]"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>{t("mintNFT.minting", "Minting...")}</span>
                    </>
                  ) : (
                    <>
                      <span>{t("mintNFT.mint", "Mint NFT")}</span>
                      <ChevronRight className="w-4 h-4 opacity-80" />
                    </>
                  )}
                </TransactionButton>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

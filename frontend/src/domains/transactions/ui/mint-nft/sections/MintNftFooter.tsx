import { ChevronRight } from "lucide-react";
import { TransactionButton } from "../../shared/TransactionButton";
import { TransactionFooterBar } from "../../shared/TransactionFooterBar";
import type { TransactionPhase } from "../../shared/transactionPhase";
import type { ArchiveTransactionPreview } from "../../../services/archiveTransaction";
import type { MintNFTSuccessResultView, MintNFTT } from "../model/mintNftTypes";

export interface MintNftFooterProps {
  t: MintNFTT;
  phase: TransactionPhase;
  successResult: MintNFTSuccessResultView | null;
  isSubmitting: boolean;
  isCheckingStatus: boolean;
  isEndorsed: boolean;
  allConsentsChecked: boolean;
  hasPersonInfo: boolean;
  hasTargetInputs: boolean;
  hasValidTarget: boolean;
  hasVerifiedTargetEnvelope: boolean;
  transactionPreview: ArchiveTransactionPreview | null;
  onTransactionPreviewDecision: (approved: boolean) => void;
  onRunInBackground?: () => void;
  onClose: () => void;
  onContinueMinting: () => void;
  onShowEndorseConfirm: () => void;
}

export function MintNftFooter({
  t,
  phase,
  successResult,
  isSubmitting,
  isCheckingStatus,
  isEndorsed,
  allConsentsChecked,
  hasPersonInfo,
  hasTargetInputs,
  hasValidTarget,
  hasVerifiedTargetEnvelope,
  transactionPreview,
  onTransactionPreviewDecision,
  onRunInBackground,
  onClose,
  onContinueMinting,
  onShowEndorseConfirm,
}: MintNftFooterProps) {
  return (
    <TransactionFooterBar
      phase={phase}
      slots={{
        onRunInBackground,
        done: successResult ? (
          <>
          <TransactionButton onClick={onClose} className="flex-1">
            {t("common.close", "Close")}
          </TransactionButton>
            <TransactionButton variant="primary" onClick={onContinueMinting} className="flex-1">
              {t("mintNFT.continueMinting", "Continue Minting")}
            </TransactionButton>
          </>
        ) : null,
        review: (
          <>
          <TransactionButton
            onClick={() => onTransactionPreviewDecision(false)}
            className="flex-1"
          >
            {t("mintNFT.cancelSubmission", "Cancel Submission")}
          </TransactionButton>
          <TransactionButton
            variant="primary"
            onClick={() => onTransactionPreviewDecision(true)}
            className="flex-[1.5]"
          >
            <span>{t("mintNFT.continueToWallet", "Continue to Wallet")}</span>
              <ChevronRight className="w-4 h-4 opacity-80" />
            </TransactionButton>
          </>
        ),
        // Nothing left to mint on this target; only the picker above is useful.
        blocked: (
          <TransactionButton onClick={onClose} className="flex-1">
            {t("common.cancel", "Cancel")}
          </TransactionButton>
        ),
        active: (
          <>
            <TransactionButton onClick={onClose} className="flex-1">
              {t("common.cancel", "Cancel")}
            </TransactionButton>
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
          </>
        ),
      }}
    />
  );
}

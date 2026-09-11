import { ChevronRight, Star, UserPlus } from "lucide-react";
import { safeCanonicalizeFullName } from "../../../../../shared/identity/fullName";
import { TransactionButton } from "../../shared/TransactionButton";
import { TransactionFooterBar } from "../../shared/TransactionFooterBar";
import type { TransactionPhase } from "../../shared/transactionPhase";
import type {
  AddVersionSuccessResultView,
  AddVersionT,
  AddVersionTransactionPreview,
  PersonInfoPublic,
} from "../model/addVersionTypes";

interface AddVersionFooterProps {
  t: AddVersionT;
  phase: TransactionPhase;
  successResult: AddVersionSuccessResultView | null;
  isSubmitting: boolean;
  personInfo: PersonInfoPublic | null;
  allConsentsChecked: boolean;
  isParentVersionLookupPending: boolean;
  transactionPreview: AddVersionTransactionPreview | null;
  onTransactionPreviewDecision: (approved: boolean) => void;
  onRunInBackground?: () => void;
  onClose: () => void;
  onContinueAdding: () => void;
  onEndorse?: (personHash: string, versionIndex: number) => void;
}

export function AddVersionFooter({
  t,
  phase,
  successResult,
  isSubmitting,
  personInfo,
  allConsentsChecked,
  isParentVersionLookupPending,
  transactionPreview,
  onTransactionPreviewDecision,
  onRunInBackground,
  onClose,
  onContinueAdding,
  onEndorse,
}: AddVersionFooterProps) {
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
          <TransactionButton variant="subtle" onClick={onContinueAdding} className="flex-1">
            <UserPlus className="w-4 h-4 text-primary opacity-60" />
            {t("addVersion.continueAdding", "Continue Adding")}
          </TransactionButton>
          <TransactionButton
            variant="primary"
            onClick={() => {
              const endorsedHash =
                successResult.events.PersonVersionAdded?.personHash || successResult.hash;
              const endorsedIndex =
                successResult.events.PersonVersionAdded?.versionIndex ?? successResult.index;
              const hasTarget =
                !!endorsedHash &&
                Number.isFinite(Number(endorsedIndex)) &&
                Number(endorsedIndex) > 0;
              if (onEndorse && hasTarget) {
                onEndorse(String(endorsedHash), Number(endorsedIndex));
              }
            }}
            className="flex-1"
          >
            <Star className="w-4 h-4 fill-white/20" />
            {t("addVersion.goToEndorse", "Endorse Now")}
          </TransactionButton>
        </>
        ) : null,
        review: (
        <>
          <TransactionButton onClick={() => onTransactionPreviewDecision(false)} className="flex-1">
            {t("addVersion.cancelSubmission", "Cancel Submission")}
          </TransactionButton>
          <TransactionButton
            variant="primary"
            onClick={() => onTransactionPreviewDecision(true)}
            className="flex-[1.5]"
          >
            <span>{t("addVersion.continueToWallet", "Continue to Wallet")}</span>
            <ChevronRight className="w-4 h-4 opacity-80" />
          </TransactionButton>
        </>
        ),
        // Adding a version is never blocked on its target, so no blocked slot.
        active: (
        <>
          <TransactionButton onClick={onClose} className="flex-1">
            {t("common.cancel", "Cancel")}
          </TransactionButton>
          <TransactionButton
            type="submit"
            variant="primary"
            disabled={
              isSubmitting ||
              !safeCanonicalizeFullName(personInfo?.fullName || "").length ||
              !allConsentsChecked ||
              isParentVersionLookupPending
            }
            className="flex-[1.5]"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>{t("addVersion.processing", "Processing...")}</span>
              </>
            ) : (
              <>
                <span>{t("addVersion.submit", "Add Version")}</span>
                <ChevronRight className="w-4 h-4 opacity-80" />
              </>
            )}
          </TransactionButton>
        </>
        ),
      }}
    />
  );
}

import { ChevronRight, Star, UserPlus } from "lucide-react";
import { safeCanonicalizeFullName } from "../../../../../shared/crypto/identityCommitment";
import { TransactionButton } from "../../shared/TransactionButton";
import type {
  AddVersionSuccessResultView,
  AddVersionT,
  PersonInfoPublic,
} from "../model/addVersionTypes";

interface AddVersionFooterProps {
  t: AddVersionT;
  successResult: AddVersionSuccessResultView | null;
  isSubmitting: boolean;
  personInfo: PersonInfoPublic | null;
  allConsentsChecked: boolean;
  onClose: () => void;
  onContinueAdding: () => void;
  onEndorse?: (personHash: string, versionIndex: number) => void;
}

export function AddVersionFooter({
  t,
  successResult,
  isSubmitting,
  personInfo,
  allConsentsChecked,
  onClose,
  onContinueAdding,
  onEndorse,
}: AddVersionFooterProps) {
  return (
    <div className="flex flex-col-reverse sm:flex-row gap-4 p-6 bg-white dark:bg-gray-950 border-t border-gray-100 dark:border-gray-800 pb-[calc(2rem+env(safe-area-inset-bottom))]">
      {successResult ? (
        <>
          <TransactionButton
            onClick={onClose}
            className="flex-1"
          >
            {t("common.close", "Close")}
          </TransactionButton>
          <TransactionButton
            variant="subtle"
            onClick={onContinueAdding}
            className="flex-1"
          >
            <UserPlus className="w-4 h-4 text-orange-600 dark:text-orange-400 opacity-60" />
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
      ) : (
        <>
          <TransactionButton
            onClick={onClose}
            className="flex-1"
          >
            {t("common.cancel", "Cancel")}
          </TransactionButton>
          <TransactionButton
            type="submit"
            variant="primary"
            disabled={
              isSubmitting ||
              !safeCanonicalizeFullName(personInfo?.fullName || "").length ||
              !allConsentsChecked
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
      )}
    </div>
  );
}

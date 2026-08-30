import { useId } from "react";
import { AlertCircle } from "lucide-react";
import {
  MODAL_ACCENT_TILE,
  MODAL_PANEL,
  MODAL_TILE_BASE,
  ModalShell,
} from "../../../../../shared/ui";
import { OVERLAY_Z_INDEX } from "../../../../../shared/ui/overlayLayers";
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
  const titleId = useId();
  const descriptionId = useId();

  return (
    <ModalShell
      isOpen={open}
      onClose={onCancel}
      bare
      zIndex={OVERLAY_Z_INDEX.blockingDialog}
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
    >
      <div className="h-full flex items-center justify-center p-4">
        <div
          className={`w-[420px] max-w-[95vw] overflow-hidden ${MODAL_PANEL}`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex gap-3.5 p-5">
            <div className={`${MODAL_TILE_BASE} ${MODAL_ACCENT_TILE.emerald}`}>
              <AlertCircle className="w-[19px] h-[19px]" aria-hidden />
            </div>
            <div className="flex-1 min-w-0 space-y-1.5">
              <h3 id={titleId} className="modal-heading font-body text-base font-semibold text-ink">
                {t("mintNFT.endorsementRequiredTitle", "Endorsement Required")}
              </h3>
              <p id={descriptionId} className="text-sm text-ink-muted leading-relaxed">
                {t(
                  "mintNFT.endorsementRequiredDesc",
                  "You must endorse this version before minting. Would you like to go endorse now?",
                )}
              </p>
            </div>
          </div>
          <div className="flex gap-2.5 px-5 py-3.5 border-t border-hairline bg-surface-body">
            <TransactionButton onClick={onCancel} className="flex-1 h-10">
              {t("common.cancel", "Cancel")}
            </TransactionButton>
            <TransactionButton variant="primary" onClick={onGoEndorse} className="flex-1 h-10">
              {t("mintNFT.goEndorse", "Go Endorse")}
            </TransactionButton>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

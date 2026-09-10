import { useTranslation } from "react-i18next";
import { ModalShell, MODAL_PANEL, OVERLAY_Z_INDEX } from "../../../../../shared/ui";
import { ArchiveTransactionDetails } from "../../ArchiveTransactionDetails";
import type { ArchiveTransactionPreview } from "../../../services/archiveTransaction";

export function MintBiographyPreviewDialog({
  preview,
  resolve,
}: {
  preview: ArchiveTransactionPreview | null;
  resolve: (approved: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <ModalShell
      isOpen={Boolean(preview)}
      onClose={() => resolve(false)}
      bare
      ariaLabel={t("archive.reviewMint", "Review mint and biography")}
      zIndex={OVERLAY_Z_INDEX.confirmDialog}
    >
      <div className="h-full flex items-center justify-center p-4">
        <div
          className={`w-full max-w-xl max-h-[85vh] overflow-auto p-5 space-y-4 ${MODAL_PANEL}`}
          onClick={(event) => event.stopPropagation()}
        >
          <h2 className="text-lg font-semibold">
            {t("archive.reviewMint", "Review mint and biography")}
          </h2>
          {preview && <ArchiveTransactionDetails preview={preview} />}
          <div className="flex gap-3">
            <button
              type="button"
              className="flex-1 rounded-lg border border-hairline-strong p-2 focus:outline-hidden focus:ring-2 focus:ring-primary"
              onClick={() => resolve(false)}
            >
              {t("common.cancel", "Cancel")}
            </button>
            <button
              type="button"
              className="flex-1 rounded-lg bg-primary p-2 text-white focus:outline-hidden focus:ring-2 focus:ring-primary"
              onClick={() => resolve(true)}
            >
              {t("archive.confirm", "Continue to wallet")}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

import { DFM1_MAX_ENVELOPE_BYTES } from "@deepfamily/protocol-core";
import type { AddVersionT, AddVersionTransactionPreview } from "../model/addVersionTypes";

interface AddVersionTransactionPreviewPanelProps {
  t: AddVersionT;
  preview: AddVersionTransactionPreview;
}

export function AddVersionTransactionPreviewPanel({
  t,
  preview,
}: AddVersionTransactionPreviewPanelProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="p-4 space-y-3 bg-info/8 border border-info/20 rounded-xl"
    >
      <div>
        <p className="text-[13px] font-semibold text-ink">
          {t("addVersion.transactionPreviewTitle", "Review before opening your wallet")}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          {t(
            "addVersion.transactionPreviewDescription",
            "The proof and encrypted envelope are frozen. Confirm these exact transaction details before continuing.",
          )}
        </p>
      </div>

      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-xs">
        <dt className="text-ink-muted">
          {t("addVersion.envelopeBytes", "Envelope bytes")}
        </dt>
        <dd className="font-mono font-semibold text-ink">
          {preview.envelopeBytes.toLocaleString()} / {DFM1_MAX_ENVELOPE_BYTES.toLocaleString()}
        </dd>
        {preview.estimated ? (
          <>
            <dt className="text-ink-muted">
              {t("addVersion.estimatedGas", "RPC estimated gas")}
            </dt>
            <dd className="font-mono font-semibold text-ink">
              {preview.estimatedGas.toLocaleString()}
            </dd>
            <dt className="text-ink-muted">
              {t("addVersion.bufferedGasLimit", "Buffered gas limit")}
            </dt>
            <dd className="font-mono font-semibold text-ink">
              {preview.gasLimit.toLocaleString()}
            </dd>
          </>
        ) : (
          <>
            <dt className="text-ink-muted">
              {t("addVersion.gasEstimate", "Gas estimate")}
            </dt>
            <dd className="font-semibold text-amber-700 dark:text-amber-300">
              {t("addVersion.gasEstimateUnavailable", "Unavailable from RPC")}
            </dd>
            <dt className="text-ink-muted">
              {t("addVersion.fallbackGasLimit", "Fallback gas limit")}
            </dt>
            <dd className="font-mono font-semibold text-ink">
              {preview.gasLimit.toLocaleString()}
            </dd>
          </>
        )}
      </dl>

      <p className="text-xs text-blue-700 dark:text-blue-300">
        {t(
          "addVersion.walletFeeNotice",
          "Your wallet will show the current network fee before you sign; the final fee can change with network conditions.",
        )}
      </p>
    </div>
  );
}

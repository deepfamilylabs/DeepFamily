import { ethers } from "ethers";
import { useTranslation } from "react-i18next";
import type { ArchiveTransactionPreview } from "../services/archiveTransaction";

export function ArchiveTransactionDetails({ preview }: { preview: ArchiveTransactionPreview }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-2 gap-2">
        {preview.payloadBytes > 0 && (
          <>
            <dt>{t("archive.payloadBytes", "Canonical payload bytes")}</dt>
            <dd>{preview.payloadBytes.toLocaleString()}</dd>
            <dt>{t("archive.segments", "Storage segments")}</dt>
            <dd>{preview.segmentCount}</dd>
          </>
        )}
        <dt>{t("archive.estimatedGas", "RPC estimated gas")}</dt>
        <dd>{preview.estimatedGas.toLocaleString()}</dd>
        <dt>{t("archive.gasLimit", "Gas limit (+20%)")}</dt>
        <dd>{preview.gasLimit.toLocaleString()}</dd>
        <dt>{t("archive.estimatedFee", "Estimated fee")}</dt>
        <dd>
          {ethers.formatEther(preview.estimatedFee)} {preview.nativeSymbol}
        </dd>
        <dt>{t("archive.maximumFee", "Buffered fee estimate")}</dt>
        <dd>
          {ethers.formatEther(preview.maximumFee)} {preview.nativeSymbol}
        </dd>
      </dl>
      {preview.segmentCount > 1 && (
        <p className="text-amber-700">
          {t(
            "archive.segmentCost",
            "This record creates multiple storage segments. Each new segment increases transaction cost.",
          )}
        </p>
      )}
      <p className="text-xs text-ink-muted">
        {t(
          "archive.feeChanges",
          "Network fees can change before your wallet submits the transaction.",
        )}
      </p>
      {preview.payloadBytes > 0 && (
        <details>
          <summary>{t("archive.exactBytes", "View exact payload bytes and hash")}</summary>
          <p className="break-all font-mono text-xs">{preview.payloadHash}</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
            {preview.canonicalPayload}
          </pre>
        </details>
      )}
    </div>
  );
}

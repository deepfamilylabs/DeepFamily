import { AlertCircle } from "lucide-react";
import { TransactionStatusView } from "../../shared/TransactionStatusView";
import type { TransactionPhase } from "../../shared/transactionPhase";
import type { TimelineStep } from "../../shared/TransactionTimeline";
import { MintNFTSuccessResult } from "../MintNFTSuccessResult";
import type { ArchiveTransactionPreview } from "../../../services/archiveTransaction";
import type {
  MintNFTErrorResultView,
  MintNFTSuccessResultView,
  MintNFTT,
} from "../model/mintNftTypes";

export interface MintNftStatusPanelProps {
  t: MintNFTT;
  phase: TransactionPhase;
  timeline: TimelineStep[];
  transactionPreview: ArchiveTransactionPreview | null;
  successResult: MintNFTSuccessResultView | null;
  errorResult: MintNFTErrorResultView | null;
}

export function MintNftStatusPanel({
  t,
  phase,
  timeline,
  transactionPreview,
  successResult,
  errorResult,
}: MintNftStatusPanelProps) {
  return (
    <TransactionStatusView
      t={t}
      phase={phase}
      slots={{
        review: {
          preview: transactionPreview,
          description: t(
            "mintNFT.transactionPreviewDescription",
            "The proof, core info and biography are frozen. The NFT and its biography are minted in this one transaction; confirm these exact details before continuing.",
          ),
        },
        timeline,
        done: successResult ? <MintNFTSuccessResult t={t} successResult={successResult} /> : null,
        failed: { title: t("mintNFT.mintFailed", "NFT Minting Failed"), error: errorResult },
        blocked: (
          <div className="p-8 rounded-xl bg-surface border border-hairline text-center flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-xl bg-danger/12 flex items-center justify-center mb-4 shadow-xs">
              <AlertCircle className="w-8 h-8 text-danger" />
            </div>
            <h3 className="text-xl font-bold text-ink mb-2">
              {t("mintNFT.nftAlreadyMinted", "NFT Already Minted")}
            </h3>
            <p className="text-ink-muted max-w-sm">
              {t(
                "mintNFT.nftAlreadyMintedDesc",
                "This version has already been minted as an NFT. Each version can only be minted once.",
              )}
            </p>
          </div>
        ),
      }}
    />
  );
}

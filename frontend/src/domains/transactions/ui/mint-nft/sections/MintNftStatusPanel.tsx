import { AlertCircle } from "lucide-react";
import { TransactionErrorResult } from "../../shared/TransactionErrorResult";
import { TransactionProgress } from "../../shared/TransactionProgress";
import { MintNFTSuccessResult } from "../MintNFTSuccessResult";
import type {
  MintNFTErrorResultView,
  MintNFTSuccessResultView,
  MintNFTT,
} from "../model/mintNftTypes";

export interface MintNftStatusPanelProps {
  t: MintNFTT;
  isSubmitting: boolean;
  proofGenerationStep: string;
  successResult: MintNFTSuccessResultView | null;
  errorResult: MintNFTErrorResultView | null;
  isAlreadyMinted: boolean;
}

export function MintNftStatusPanel({
  t,
  isSubmitting,
  proofGenerationStep,
  successResult,
  errorResult,
  isAlreadyMinted,
}: MintNftStatusPanelProps) {
  return (
    <>
      {isAlreadyMinted && !successResult && (
        <div className="p-8 rounded-3xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800 text-center flex flex-col items-center justify-center">
          <div className="w-16 h-16 rounded-2xl bg-linear-to-br from-red-100 to-red-50 dark:from-red-900/40 dark:to-red-900/20 flex items-center justify-center mb-4 shadow-xs">
            <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {t("mintNFT.nftAlreadyMinted", "NFT Already Minted")}
          </h3>
          <p className="text-gray-500 dark:text-gray-400 max-w-sm">
            {t(
              "mintNFT.nftAlreadyMintedDesc",
              "This version has already been minted as an NFT. Each version can only be minted once.",
            )}
          </p>
        </div>
      )}

      {isSubmitting && !successResult && !errorResult && (
        <TransactionProgress
          title={
            proofGenerationStep
              ? t("mintNFT.processing", "Processing...")
              : t("mintNFT.minting", "Minting NFT...")
          }
          message={
            proofGenerationStep ||
            t("mintNFT.mintingDesc", "Creating your unique NFT on the blockchain...")
          }
          note={
            proofGenerationStep?.includes("30-60 seconds")
              ? t(
                  "mintNFT.proofGenerationNote",
                  "ZK proof generation requires heavy cryptography. Please keep this tab active until completion.",
                )
              : undefined
          }
        />
      )}

      {successResult && <MintNFTSuccessResult t={t} successResult={successResult} />}

      {errorResult && (
        <TransactionErrorResult
          title={t("mintNFT.mintFailed", "NFT Minting Failed")}
          error={errorResult}
          typeLabel={t("mintNFT.errorType", "Error Type")}
          messageLabel={t("mintNFT.errorMessage", "Message")}
          detailsLabel={t("mintNFT.errorDetails", "Details")}
        />
      )}
    </>
  );
}

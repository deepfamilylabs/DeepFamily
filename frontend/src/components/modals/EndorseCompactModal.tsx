import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Check, Loader2, AlertCircle, Star, X, ShieldCheck, Coins } from "lucide-react";
import { ethers } from "ethers";
import { useContract } from "../../hooks/useContract";
import { useWallet } from "../../context/WalletContext";
import { getFriendlyError } from "../../lib/errors";
import { useTreeData } from "../../context/TreeDataContext";

interface EndorseCompactModalProps {
  isOpen: boolean;
  onClose: () => void;
  personHash: string;
  versionIndex: number;
  versionData?: {
    fullName?: string;
    endorsementCount?: number;
  };
  onSuccess?: (result: any) => void;
}

type EndorseState =
  | "idle"
  | "checking"
  | "approving"
  | "working"
  | "success"
  | "already-endorsed"
  | "error";

export default function EndorseCompactModal({
  isOpen,
  onClose,
  personHash,
  versionIndex,
  versionData,
  onSuccess,
}: EndorseCompactModalProps) {
  const { t } = useTranslation();
  const { address, signer } = useWallet();
  const { endorseVersion, getVersionDetails, contract } = useContract();
  const { invalidateByTx } = useTreeData();
  const [state, setState] = useState<EndorseState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(versionData?.fullName || null);
  const [endorsementCount, setEndorsementCount] = useState<number | null>(
    versionData?.endorsementCount ?? null,
  );
  const [hasTriggered, setHasTriggered] = useState(false);
  const [endorsementFee, setEndorsementFee] = useState<string | null>(null);
  const [userBalance, setUserBalance] = useState<string | null>(null);
  const [isInsufficientBalance, setIsInsufficientBalance] = useState(false);

  const hasValidTarget = useMemo(
    () => Boolean(personHash && /^0x[0-9a-fA-F]{64}$/.test(personHash) && Number(versionIndex) > 0),
    [personHash, versionIndex],
  );

  // Reset between openings
  useEffect(() => {
    if (!isOpen) return;
    setState("idle");
    setErrorMessage(null);
    setTxHash(null);
    setHasTriggered(false);
    setEndorsementFee(null);
    setUserBalance(null);
    setIsInsufficientBalance(false);
    if (versionData?.endorsementCount !== undefined) {
      setEndorsementCount(versionData.endorsementCount);
    }
  }, [isOpen, personHash, versionIndex]);

  // Lightweight detail fetch for context
  useEffect(() => {
    if (!isOpen || !getVersionDetails || !hasValidTarget) return;
    let mounted = true;
    (async () => {
      try {
        const details = await getVersionDetails(personHash, versionIndex);
        if (!mounted || !details) return;
        const name = details.version?.coreInfo?.supplementInfo?.fullName;
        setDisplayName(name || versionData?.fullName || null);
        const nextCount = Number(details.endorsementCount ?? versionData?.endorsementCount ?? 0);
        setEndorsementCount((prev) => {
          if (prev === null) return nextCount;
          return Math.max(prev, nextCount);
        });
      } catch {}
    })();
    return () => {
      mounted = false;
    };
  }, [
    isOpen,
    getVersionDetails,
    personHash,
    versionIndex,
    hasValidTarget,
    versionData?.fullName,
    versionData?.endorsementCount,
  ]);

  /**
   * Check token allowance and approve if needed, then endorse
   * This logic is adapted from EndorseModal.tsx to ensure proper ERC20 approval
   */
  const triggerEndorse = async () => {
    if (!address) {
      setErrorMessage(t("wallet.notConnected", "Please connect your wallet"));
      setState("error");
      return;
    }

    if (!hasValidTarget) {
      setErrorMessage(t("endorse.errors.invalidTarget", "Invalid person hash or version index"));
      setState("error");
      return;
    }

    if (!contract || !signer) {
      setErrorMessage(t("wallet.notConnected", "Please connect your wallet"));
      setState("error");
      return;
    }

    try {
      // Check existing endorsement before any approval/tx work
      try {
        const endorsedIdx = await contract.endorsedVersionIndex(personHash, address);
        if (Number(endorsedIdx) === Number(versionIndex)) {
          setState("already-endorsed");
          return;
        }
      } catch (checkError) {
        console.warn("Failed to check existing endorsement status:", checkError);
      }

      setState("checking");
      setErrorMessage(null);
      setIsInsufficientBalance(false);

      // Step 1: Get token contract address from DeepFamily contract
      const deepTokenAddress = await contract.DEEP_FAMILY_TOKEN_CONTRACT();

      // Step 2: Create token contract instance with necessary functions
      const tokenContract = new ethers.Contract(
        deepTokenAddress,
        [
          "function allowance(address,address) view returns (uint256)",
          "function approve(address,uint256) returns (bool)",
          "function recentReward() view returns (uint256)",
          "function increaseAllowance(address,uint256) returns (bool)",
          "function balanceOf(address) view returns (uint256)",
          "function decimals() view returns (uint8)",
        ],
        signer,
      );

      // Step 3: Get the endorsement fee (recentReward)
      const fee: bigint = await tokenContract.recentReward();
      let decimals = 18;
      try {
        decimals = Number(await tokenContract.decimals());
      } catch {}
      const feeFormatted = ethers.formatUnits(fee, decimals);
      setEndorsementFee(feeFormatted);

      // Step 4: Check user balance first
      const balance: bigint = await tokenContract.balanceOf(address);
      const balanceFormatted = ethers.formatUnits(balance, decimals);
      setUserBalance(balanceFormatted);

      // Check if balance is sufficient
      if (balance < fee) {
        console.error("❌ Insufficient balance:", {
          balance: balanceFormatted,
          required: feeFormatted,
        });
        setIsInsufficientBalance(true);
        setErrorMessage(
          t("endorse.insufficientBalance", "Insufficient DEEP balance") +
            `: ${balanceFormatted} < ${feeFormatted}`,
        );
        setState("error");
        return;
      }

      // If fee is 0, no approval needed - proceed directly to endorse
      if (fee === 0n) {
        setState("working");
        const result = await endorseVersion(personHash, versionIndex, undefined, {
          suppressToasts: true,
        });
        setTxHash(result?.hash || result?.transactionHash || null);
        setEndorsementCount((prev) => (prev === null ? 1 : prev + 1));
        setState("success");
        invalidateByTx({ receipt: result, hints: { personHash, versionIndex } });
        onSuccess?.(result);
        return;
      }

      // Step 5: Get spender address (DeepFamily contract)
      const spender = await contract.getAddress();

      // Step 6: Check current allowance
      const currentAllowance: bigint = await tokenContract.allowance(address, spender);

      // Step 7: If allowance is insufficient, request approval
      if (currentAllowance < fee) {
        setState("approving");

        // Use direct approve for exact amount (safer than unlimited approval)
        let tx;
        try {
          tx = await tokenContract.approve(spender, fee);
        } catch (approveError: any) {
          console.error("❌ Direct approve failed:", approveError);
          // Fallback: try increaseAllowance if approve fails
          const delta = fee - currentAllowance;
          if (delta > 0n) {
            tx = await tokenContract.increaseAllowance(spender, delta);
          } else {
            throw approveError;
          }
        }

        // Wait for approval confirmation
        const receipt = await tx.wait();

        // Wait for blockchain state to be updated after approval transaction
        let postAllowance: bigint = currentAllowance;
        let retryCount = 0;
        const maxRetries = 32;

        while (retryCount < maxRetries && postAllowance < fee) {
          const waitTime = Math.min(500 + retryCount * 300, 2000);

          try {
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            postAllowance = await tokenContract.allowance(address, spender);

            if (postAllowance >= fee) {
              break;
            }
          } catch (error) {
            console.warn(
              `❌ Post-approval allowance check failed on attempt ${retryCount + 1}:`,
              error,
            );
          }

          retryCount++;
        }
      } else {
      }

      // Step 8: Final allowance check before endorseVersion call
      const finalAllowance: bigint = await tokenContract.allowance(address, spender);
      const finalRequired: bigint = await tokenContract.recentReward();

      if (finalAllowance < finalRequired) {
        const errorMsg = t(
          "endorse.errors.needApprove",
          "Allowance insufficient. Please re-approve the token allowance.",
        );
        console.error("❌ Final allowance insufficient");
        throw new Error(errorMsg);
      }

      // Step 9: Now proceed with endorsement
      setState("working");
      const result = await endorseVersion(personHash, versionIndex, undefined, {
        suppressToasts: true,
      });
      setTxHash(result?.hash || result?.transactionHash || null);
      setEndorsementCount((prev) => (prev === null ? 1 : prev + 1));
      setState("success");
      invalidateByTx({ receipt: result, hints: { personHash, versionIndex } });
      onSuccess?.(result);
    } catch (err: any) {
      console.error("❌ Endorse flow failed:", err);
      setState("error");

      // Check for specific error types
      const errMsg = err?.message || "";
      if (errMsg.includes("Insufficient DEEP token balance") || errMsg.includes("insufficient")) {
        setIsInsufficientBalance(true);
        setErrorMessage(t("endorse.insufficientBalance", "Insufficient DEEP balance"));
      } else if (
        err?.code === "ACTION_REJECTED" ||
        err?.code === 4001 ||
        errMsg.includes("user rejected") ||
        errMsg.includes("User denied")
      ) {
        setErrorMessage(t("endorse.errors.userRejected", "Transaction was rejected by user"));
      } else {
        const friendly = getFriendlyError(err, t);
        setErrorMessage(friendly.message);
      }
    }
  };

  // Auto-endorse as soon as the modal opens with a valid target
  useEffect(() => {
    if (!isOpen || hasTriggered) return;
    if (hasValidTarget && address) {
      setHasTriggered(true);
      triggerEndorse();
    } else if (!address) {
      setState("error");
      setErrorMessage(t("wallet.notConnected", "Please connect your wallet"));
    }
  }, [isOpen, hasTriggered, hasValidTarget, address]);

  if (!isOpen) return null;

  const isProcessing = state === "checking" || state === "approving" || state === "working";

  // Get status message based on current state
  const getStatusMessage = () => {
    switch (state) {
      case "checking":
        return t("endorse.checkingAllowance", "Checking token allowance...");
      case "approving":
        return t("endorse.approving", "Approving DEEP tokens...");
      case "working":
        return t("endorse.processing", "Submitting endorsement...");
      default:
        return t("endorse.quickWaiting", "Preparing endorsement...");
    }
  };

  // Check if user can afford endorsement
  const canAfford =
    userBalance && endorsementFee ? parseFloat(userBalance) >= parseFloat(endorsementFee) : true;

  return createPortal(
    <div
      className="fixed inset-0 z-[1300] bg-black/60 backdrop-blur-md flex items-center justify-center p-4 transition-all duration-300"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white/95 dark:bg-black/90 backdrop-blur-xl rounded-3xl border border-white/20 dark:border-white/10 shadow-[0_0_50px_-12px_rgba(0,0,0,0.3)] p-8 space-y-8 relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-6 right-6 p-2 text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-white/10"
          aria-label={t("common.close", "Close")}
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Section */}
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-orange-400 to-red-500 text-white flex items-center justify-center shadow-lg shadow-orange-500/30 transform transition-transform hover:scale-105 duration-300">
            <Star className="w-8 h-8 fill-current" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
              {t("endorse.quickTitle", "Endorse Version")}
            </h2>
          </div>
        </div>

        {/* Content Section */}
        <div className="space-y-4">
          {/* Target Info */}
          <div className="bg-gray-50 dark:bg-white/5 rounded-2xl p-5 border border-gray-100 dark:border-white/5 transition-colors hover:border-gray-200 dark:hover:border-white/10 space-y-4">
            <div>
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
                {t("endorse.personHash", "Person Hash")}
              </div>
              <code className="block font-mono text-xs text-gray-600 dark:text-gray-300 break-all bg-white dark:bg-black/20 p-3 rounded-xl border border-gray-100 dark:border-white/5">
                {personHash}
              </code>
            </div>

            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
                  {t("addVersion.versionIndex", "Version Index")}
                </div>
                <div className="font-mono text-lg font-semibold text-gray-900 dark:text-white">
                  {versionIndex}
                </div>
              </div>
              {endorsementCount !== null && (
                <div className="text-right">
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
                    {t("search.endorsementQuery.endorsementCount", "Endorsements")}
                  </div>
                  <div className="font-mono text-lg font-semibold text-gray-900 dark:text-white">
                    {endorsementCount}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Token Info */}
          {(endorsementFee || userBalance) && (
            <div className="bg-gray-50 dark:bg-white/5 rounded-2xl p-5 border border-gray-100 dark:border-white/5">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white mb-3">
                <Coins className="w-4 h-4 text-orange-500" />
                <span>DEEP {t("endorse.tokenInfo", "Token Info")}</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {endorsementFee && (
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      {t("endorse.fee", "Fee")}
                    </div>
                    <div className="font-mono font-medium text-gray-900 dark:text-white">
                      {endorsementFee} DEEP
                    </div>
                  </div>
                )}
                {userBalance && (
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      {t("endorse.yourBalance", "Your Balance")}
                    </div>
                    <div
                      className={`font-mono font-medium ${
                        canAfford ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {userBalance} DEEP
                    </div>
                  </div>
                )}
              </div>
              {!canAfford && (
                <div className="mt-3 flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded-lg">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {t("endorse.needMoreTokens", "You need more DEEP tokens to endorse this version")}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Status & Actions */}
        <div className="pt-2">
          {!(state === "error" && isInsufficientBalance) && (
            <div className="text-center">
              {(state === "checking" || state === "approving" || state === "working") && (
                <div className="flex flex-col items-center gap-3 animate-pulse">
                  <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
                  <div className="space-y-1">
                    <div className="font-medium text-gray-900 dark:text-white">
                      {getStatusMessage()}
                    </div>
                    {state === "approving" && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>{t("endorse.confirmInWallet", "Please confirm in your wallet")}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {(state === "success" || state === "already-endorsed") && (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                    <Check className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white text-lg">
                      {state === "already-endorsed"
                        ? t("endorse.alreadyEndorsed", "You already endorsed this version")
                        : t("endorse.success", "Endorsed successfully")}
                    </div>
                    {state === "success" && txHash && (
                      <code className="block mt-2 text-xs font-mono text-gray-500 break-all">
                        {txHash}
                      </code>
                    )}
                  </div>
                </div>
              )}

              {state === "error" && !isInsufficientBalance && (
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-2 text-red-600 dark:text-red-400">
                    <AlertCircle className="w-8 h-8" />
                    <div className="text-sm text-center max-w-[280px] mx-auto">
                      {errorMessage ||
                        t("endorse.transactionFailed", "Transaction failed. Please try again.")}
                    </div>
                  </div>
                  {hasValidTarget && (
                    <button
                      onClick={() => {
                        setHasTriggered(false);
                        setState("idle");
                        setErrorMessage(null);
                        setIsInsufficientBalance(false);
                        setTimeout(() => setHasTriggered(false), 0);
                      }}
                      disabled={isProcessing}
                      className="w-full py-3 rounded-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-medium shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isProcessing && <Loader2 className="w-4 h-4 animate-spin" />}
                      {t("common.retry", "Retry")}
                    </button>
                  )}
                </div>
              )}

              {state === "idle" && (
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {t("endorse.quickWaiting", "Preparing endorsement...")}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

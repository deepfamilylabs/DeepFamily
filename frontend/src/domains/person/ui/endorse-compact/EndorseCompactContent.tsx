import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, AlertCircle, Star, ShieldCheck, Coins } from "lucide-react";
import {
  useContractClient,
  useEndorseFlow,
  type ExecuteEndorseFlowResult,
} from "../../../transactions";
import { useWallet } from "../../../wallet";
import { ModalShell } from "../../../../shared/ui/ModalShell";
import { OVERLAY_Z_INDEX } from "../../../../shared/ui/overlayLayers";

type EndorseReceiptLike = { logs?: any[] } | null;

export interface EndorseCompactModalProps {
  isOpen: boolean;
  onClose: () => void;
  personHash: string;
  versionIndex: number;
  versionData?: {
    fullName?: string;
    endorsementCount?: number;
  };
  onSuccess?: (receipt?: EndorseReceiptLike) => void;
}

function getTargetKey(personHash: string, versionIndex: number) {
  return `${personHash.trim().toLowerCase()}:${Number(versionIndex) || 0}`;
}

export default function EndorseCompactModal({
  isOpen,
  onClose,
  personHash,
  versionIndex,
  versionData,
  onSuccess,
}: EndorseCompactModalProps) {
  const { t } = useTranslation();
  const { address } = useWallet();
  const { getVersionDetails } = useContractClient();
  const endorseFlow = useEndorseFlow();
  const resetEndorseFlow = endorseFlow.reset;
  const runEndorseFlow = endorseFlow.run;

  const [displayName, setDisplayName] = useState<string | null>(versionData?.fullName || null);
  const [endorsementCount, setEndorsementCount] = useState<number | null>(
    versionData?.endorsementCount ?? null,
  );
  const [hasTriggered, setHasTriggered] = useState(false);
  const activeRunTargetRef = useRef<string | null>(null);
  const handledResultRef = useRef<ExecuteEndorseFlowResult | null>(null);
  const currentTargetKey = getTargetKey(personHash, versionIndex);

  const hasValidTarget = useMemo(
    () => Boolean(personHash && /^0x[0-9a-fA-F]{64}$/.test(personHash) && Number(versionIndex) > 0),
    [personHash, versionIndex],
  );

  // Derive display values from flow result
  const flowBelongsToCurrentTarget = activeRunTargetRef.current === currentTargetKey;
  const flowStatus = flowBelongsToCurrentTarget ? endorseFlow.status : "idle";
  const flowResult = (
    flowBelongsToCurrentTarget ? endorseFlow.result : null
  ) as ExecuteEndorseFlowResult | null;
  const flowError = flowBelongsToCurrentTarget ? endorseFlow.error : null;
  const isAlreadyEndorsed = flowResult?.alreadyEndorsed === true;
  const successResult = flowResult && !flowResult.alreadyEndorsed ? flowResult : null;
  const endorsementFee = successResult?.feeFormatted ?? null;
  const endorsementFeeRaw = successResult?.fee ?? 0n;
  const userBalance = successResult?.balanceFormatted ?? null;
  const userBalanceRaw = successResult?.balanceBefore ?? 0n;
  const txHash = successResult?.transactionHash ?? null;

  const isInsufficientBalance =
    flowStatus === "error" &&
    (() => {
      const err = flowError as any;
      const reason = err?.reason || err?.type;
      return reason === "INSUFFICIENT_DEEP_BALANCE";
    })();

  const errorMessage = useMemo(() => {
    if (flowStatus !== "error" || !flowError) return null;
    const err = flowError as any;
    const reason = err?.reason || err?.type;
    if (reason === "INSUFFICIENT_DEEP_BALANCE") {
      return err.message || t("endorse.insufficientBalance", "Insufficient DEEP balance");
    }
    return err.message || t("endorse.transactionFailed", "Transaction failed. Please try again.");
  }, [flowError, flowStatus, t]);

  // Map flow status to local display state
  const state = useMemo(() => {
    if (isAlreadyEndorsed) return "already-endorsed" as const;
    const s = flowStatus;
    if (s === "idle") return "idle" as const;
    if (s === "validating") return "checking" as const;
    if (s === "approving") return "approving" as const;
    if (s === "submitting") return "working" as const;
    if (s === "success") return "success" as const;
    if (s === "error") return "error" as const;
    return "idle" as const;
  }, [flowStatus, isAlreadyEndorsed]);

  // Reset between openings
  useEffect(() => {
    activeRunTargetRef.current = null;
    handledResultRef.current = null;
    resetEndorseFlow();
    setHasTriggered(false);
    setDisplayName(versionData?.fullName || null);
    setEndorsementCount(versionData?.endorsementCount ?? null);
  }, [
    isOpen,
    personHash,
    resetEndorseFlow,
    versionData?.endorsementCount,
    versionData?.fullName,
    versionIndex,
  ]);

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

  // Handle success side-effects
  useEffect(() => {
    if (!isOpen || activeRunTargetRef.current !== currentTargetKey) return;
    if (state === "success" && successResult) {
      if (handledResultRef.current === successResult) return;
      handledResultRef.current = successResult;
      setEndorsementCount((prev) => (prev === null ? 1 : prev + 1));
      onSuccess?.(successResult.receipt);
    }
  }, [currentTargetKey, isOpen, onSuccess, state, successResult]);

  // Auto-endorse as soon as the modal opens with a valid target
  useEffect(() => {
    if (!isOpen || hasTriggered) return;
    if (hasValidTarget && address) {
      setHasTriggered(true);
      activeRunTargetRef.current = currentTargetKey;
      runEndorseFlow({ personHash, versionIndex, suppressToasts: true });
    }
  }, [
    address,
    currentTargetKey,
    hasTriggered,
    hasValidTarget,
    isOpen,
    personHash,
    runEndorseFlow,
    versionIndex,
  ]);

  const isProcessing = state === "checking" || state === "approving" || state === "working";

  const getStatusMessage = () => {
    if (endorseFlow.stepMessage) return endorseFlow.stepMessage;
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

  const canAfford = userBalance && endorsementFee ? userBalanceRaw >= endorsementFeeRaw : true;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      zIndex={OVERLAY_Z_INDEX.nestedModal}
      ariaLabel={t("endorse.quickTitle", "Endorse Version")}
      closeLabel={t("common.close", "Close")}
    >
      <div className="space-y-8">
        {/* Header Section */}
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="h-16 w-16 rounded-2xl bg-linear-to-br from-orange-400 to-red-500 text-white flex items-center justify-center shadow-lg shadow-orange-500/30 transform transition-transform hover:scale-105 duration-300">
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
                        canAfford
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
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
                    {t(
                      "endorse.needMoreTokens",
                      "You need more DEEP tokens to endorse this version",
                    )}
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
                        endorseFlow.reset();
                        setHasTriggered(false);
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
    </ModalShell>
  );
}

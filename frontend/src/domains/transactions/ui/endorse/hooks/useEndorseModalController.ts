import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWallet } from "../../../../wallet";
import { useContractClient } from "../../../hooks/useContractClient";
import { usePersonVersionOptions } from "../../../hooks/usePersonVersionOptions";
import { useTreeMutations, useTreeNodeAccess } from "../../../../tree";
import { useResponsiveModalMode } from "../../../../../shared/ui";
import { useTransactionModalFrameState } from "../../shared/useTransactionModalFrameState";
import { resolveTransactionPhase } from "../../shared/transactionPhase";
import { buildTimeline, useTimelineProgress } from "../../shared/TransactionTimeline";
import { ENDORSE_TIMELINE_STEPS, endorseTimelineStep } from "../../shared/timelineSteps";
import { useTransactionCenterEntry } from "../../shared/useTransactionCenterEntry";
import { useTransactionTargetSelection } from "../../shared/useTransactionTargetSelection";
import { getFriendlyError } from "../../../../../shared/lib/errors";
import { useEndorseFlow, type ExecuteEndorseFlowResult } from "./useEndorseFlow";
import { useEndorseFeeQuote } from "./useEndorseFeeQuote";
import { useEndorseTargetStatus } from "./useEndorseTargetStatus";
import { buildEndorseSuccessResultView, toEndorseErrorResult } from "../model/endorseResultView";
import { reconcileEndorseVersionSelection } from "../model/endorseVersionSelection";
import type { EndorseErrorResultView, EndorseSuccessResultView } from "../model/endorseTypes";

interface UseEndorseModalControllerArgs {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (result: any) => void;
  onMintNFT?: (personHash: string, versionIndex: number) => void;
  initialPersonHash?: string;
  initialVersionIndex?: number;
}

function isBytes32(value: string | undefined | null) {
  return Boolean(value && /^0x[0-9a-fA-F]{64}$/.test(value.trim()));
}

function getTargetKey(personHash: string, versionIndex: number) {
  return `${personHash.trim().toLowerCase()}:${Number(versionIndex) || 0}`;
}

export function useEndorseModalController({
  isOpen,
  onClose,
  onSuccess,
  onMintNFT,
  initialPersonHash,
  initialVersionIndex,
}: UseEndorseModalControllerArgs) {
  const { t } = useTranslation();
  const { address } = useWallet();
  const { getVersionDetails, contract } = useContractClient();
  const { bumpEndorsementCount, invalidateByTx } = useTreeMutations();
  const { getOwnerOf } = useTreeNodeAccess();
  const endorseFlow = useEndorseFlow();
  const resetEndorseFlow = endorseFlow.reset;
  const runEndorseFlowOrThrow = endorseFlow.runOrThrow;

  const {
    personHash,
    setPersonHash,
    versionIndex,
    targetPersonHash,
    isPersonHashFormatValid,
    hasValidTarget,
    hashInputInvalid,
    versionLookup,
    seedTarget,
    handleVersionIndexChange,
    getDecidedVersionHash,
    applyVersionDecision,
  } = useTransactionTargetSelection({ isOpen });
  const targetVersionIndex = versionIndex;
  const currentTargetKey = getTargetKey(targetPersonHash, targetVersionIndex);
  const [successResult, setSuccessResult] = useState<EndorseSuccessResultView | null>(null);
  const [errorResult, setErrorResult] = useState<EndorseErrorResultView | null>(null);
  const previousTargetRef = useRef({ hash: "", index: 0 });
  const didPatchCacheRef = useRef(false);
  const handledResultRef = useRef<ExecuteEndorseFlowResult | null>(null);
  const activeRunTargetRef = useRef<string | null>(null);

  const isDesktop = useResponsiveModalMode();
  const { entered, requestClose: handleClose } = useTransactionModalFrameState({
    isOpen,
    isDesktop,
    modalId: "EndorseModal",
    onClose,
  });

  const feeQuote = useEndorseFeeQuote({ isOpen, address, contract });
  const targetStatus = useEndorseTargetStatus({
    isOpen,
    address,
    contract,
    getVersionDetails: getVersionDetails ?? undefined,
    getOwnerOf,
    targetPersonHash,
    targetVersionIndex,
    hasValidTarget,
  });

  const isSubmitting =
    endorseFlow.status === "validating" ||
    endorseFlow.status === "approving" ||
    endorseFlow.status === "submitting" ||
    endorseFlow.status === "confirming";
  const isApproving = endorseFlow.status === "approving";
  const timelineStep = useTimelineProgress(
    ENDORSE_TIMELINE_STEPS,
    endorseTimelineStep(endorseFlow.status),
  );
  const phase = resolveTransactionPhase({
    successResult,
    errorResult,
    isBusy: isSubmitting || isApproving,
  });

  const { settle: settleTransaction } = useTransactionCenterEntry({
    kind: "endorse",
    label: t("endorse.title", "Endorse Version"),
    phase,
    transactionHash: successResult?.transactionHash,
    error: errorResult,
  });

  useEffect(() => {
    const nextHash = isOpen ? initialPersonHash || "" : "";
    const nextIndex = isOpen ? initialVersionIndex || 0 : 0;
    seedTarget(nextHash, nextIndex);
    setSuccessResult(null);
    setErrorResult(null);
    previousTargetRef.current = { hash: nextHash, index: nextIndex };
    didPatchCacheRef.current = false;
    handledResultRef.current = null;
    activeRunTargetRef.current = null;
    resetEndorseFlow();
  }, [initialPersonHash, initialVersionIndex, isOpen, resetEndorseFlow, seedTarget]);

  useEffect(() => {
    if (!isOpen) return;
    const changed =
      previousTargetRef.current.hash !== targetPersonHash ||
      previousTargetRef.current.index !== targetVersionIndex;
    if (!changed) return;

    previousTargetRef.current = { hash: targetPersonHash, index: targetVersionIndex };
    setSuccessResult(null);
    setErrorResult(null);
    didPatchCacheRef.current = false;
    handledResultRef.current = null;
    activeRunTargetRef.current = null;
    resetEndorseFlow();
  }, [isOpen, resetEndorseFlow, targetPersonHash, targetVersionIndex]);

  useEffect(() => {
    if (!isOpen || activeRunTargetRef.current !== currentTargetKey) return;
    if (endorseFlow.status !== "success" || !endorseFlow.result) return;
    const result = endorseFlow.result as ExecuteEndorseFlowResult;
    if (handledResultRef.current === result) return;
    handledResultRef.current = result;

    if (result.alreadyEndorsed) {
      targetStatus.markEndorsed();
      onSuccess?.({ alreadyEndorsed: true });
      return;
    }

    setErrorResult(null);
    feeQuote.applySuccessResult(result);
    const nextEndorsementCount = targetStatus.currentEndorsementCount + 1;
    targetStatus.markEndorsed({ increment: true });

    if (!didPatchCacheRef.current && targetPersonHash && targetVersionIndex) {
      didPatchCacheRef.current = true;
      bumpEndorsementCount(targetPersonHash, Number(targetVersionIndex), 1);
    }

    setSuccessResult(
      buildEndorseSuccessResultView({
        result,
        personHash: targetPersonHash,
        versionIndex: Number(targetVersionIndex),
        feeRecipient: targetStatus.feeRecipient,
        endorser: address ?? undefined,
      }),
    );

    invalidateByTx({
      receipt: result.receipt,
      hints: { personHash: targetPersonHash, versionIndex: Number(targetVersionIndex) },
    });

    onSuccess?.({ ...result.receipt, endorsementCount: nextEndorsementCount });
  }, [
    address,
    bumpEndorsementCount,
    endorseFlow.result,
    endorseFlow.status,
    feeQuote,
    invalidateByTx,
    isOpen,
    onSuccess,
    currentTargetKey,
    targetPersonHash,
    targetStatus,
    targetVersionIndex,
    settleTransaction,
  ]);

  useEffect(() => {
    if (!isOpen || activeRunTargetRef.current !== currentTargetKey) return;
    if (endorseFlow.status !== "error" || !endorseFlow.error) return;
    const friendly = endorseFlow.error;
    console.error("Endorse failed:", friendly);
    setErrorResult({
      type: friendly.reason || friendly.type || "UNKNOWN_ERROR",
      message: friendly.message,
      details: friendly.details,
      retryable: friendly.retryable,
    });
  }, [currentTargetKey, endorseFlow.error, endorseFlow.status, isOpen]);

  useEffect(() => {
    applyVersionDecision(reconcileEndorseVersionSelection(versionLookup, getDecidedVersionHash()));
  }, [applyVersionDecision, getDecidedVersionHash, versionLookup]);

  const handleContinueEndorsing = useCallback(() => {
    seedTarget("", 0);
    setSuccessResult(null);
    setErrorResult(null);
    targetStatus.reset();
    resetEndorseFlow();
    previousTargetRef.current = { hash: "", index: 0 };
    didPatchCacheRef.current = false;
    handledResultRef.current = null;
    activeRunTargetRef.current = null;
  }, [resetEndorseFlow, targetStatus]);

  const handleEndorse = useCallback(() => {
    if (!address) {
      activeRunTargetRef.current = null;
      setErrorResult(
        toEndorseErrorResult("WALLET_NOT_CONNECTED", t("wallet.notConnected", "Please connect your wallet")),
      );
      return;
    }

    if (!hasValidTarget) {
      activeRunTargetRef.current = null;
      setErrorResult(
        toEndorseErrorResult(
          "INVALID_TARGET",
          t("endorse.personHashRequired", "Please provide valid person hash and version index"),
        ),
      );
      return;
    }

    if (feeQuote.userDeepBalanceRaw < feeQuote.deepTokenFeeRaw) {
      activeRunTargetRef.current = null;
      setErrorResult(
        toEndorseErrorResult(
          "INSUFFICIENT_DEEP_BALANCE",
          t("endorse.insufficientDeepTokens", "Insufficient DEEP tokens for endorsement"),
        ),
      );
      return;
    }

    setSuccessResult(null);
    setErrorResult(null);
    handledResultRef.current = null;
    activeRunTargetRef.current = currentTargetKey;
    // The outcome is reported through settle rather than the status effects
    // below, so an endorsement outlives the modal that started it.
    runEndorseFlowOrThrow({
      personHash: targetPersonHash,
      versionIndex: Number(targetVersionIndex),
      deepTokenAddress: feeQuote.deepTokenAddress || undefined,
      // Hold the submission to the fee actually on screen. A quote that never
      // loaded is not a promise to the user, so it constrains nothing.
      quotedFee: feeQuote.loaded ? feeQuote.deepTokenFeeRaw : undefined,
      onFeeQuoteChange: feeQuote.applyFeeQuote,
    }).then(
      (result) => {
        if (!result.alreadyEndorsed) {
          settleTransaction({ phase: "done", transactionHash: result.transactionHash });
        }
      },
      (error) => {
        settleTransaction({ phase: "failed", error: getFriendlyError(error, t) });
      },
    );
  }, [
    address,
    feeQuote,
    hasValidTarget,
    currentTargetKey,
    runEndorseFlowOrThrow,
    t,
    targetPersonHash,
    targetVersionIndex,
    settleTransaction,
  ]);

  return {
    t,
    frame: {
      isOpen,
      onClose: handleClose,
      isDesktop,
      entered,
    },
    targetForm: {
      personHash,
      versionIndex,
      hashInputInvalid,
      hasValidTarget,
      isTargetValidOnChain: targetStatus.isTargetValidOnChain,
      versionLookup,
      onPersonHashChange: setPersonHash,
      onVersionIndexChange: handleVersionIndexChange,
    },
    feePanel: {
      deepTokenFee: feeQuote.deepTokenFee,
      userDeepBalance: feeQuote.userDeepBalance,
      canAffordEndorsement: feeQuote.canAffordEndorsement,
      hasEndorsed: targetStatus.hasEndorsed,
      isNFTMinted: targetStatus.isNFTMinted,
      protocolFeeBps: feeQuote.protocolFeeBps,
    },
    statusPanel: {
      phase,
      timeline: buildTimeline({
        steps: [
          { id: "allowance", label: t("endorse.stepAllowance", "Check token allowance") },
          {
            id: "approve",
            label: t("endorse.stepApprove", "Approve DEEP tokens"),
            detail: t(
              "endorse.approvingDesc",
              "Please confirm the token approval in your wallet",
            ),
          },
          { id: "submit", label: t("endorse.stepSubmit", "Submit the endorsement") },
          {
            id: "confirm",
            label: t("transaction.stepConfirm", "Waiting for on-chain confirmation"),
          },
        ],
        currentId: timelineStep,
        failed: phase === "failed",
        complete: phase === "done",
      }),
      isApproving,
      successResult,
      errorResult,
      hasEndorsed: targetStatus.hasEndorsed,
      deepTokenDecimals: feeQuote.deepTokenDecimals,
      deepTokenSymbol: feeQuote.deepTokenSymbol,
      onClearError: () => setErrorResult(null),
      onRetry: handleEndorse,
    },
    footer: {
      phase,
      successResult,
      isSubmitting,
      isApproving,
      canAffordEndorsement: feeQuote.canAffordEndorsement,
      hasEndorsed: targetStatus.hasEndorsed,
      hasValidTarget,
      isTargetValidOnChain: targetStatus.isTargetValidOnChain,
      // Only once the transaction is away. Before that, closing cancels, so
      // offering to "continue in background" would be a lie.
      onRunInBackground: endorseFlow.status === "confirming" ? handleClose : undefined,
      isPersonHashFormatValid,
      onClose: handleClose,
      onContinueEndorsing: handleContinueEndorsing,
      onEndorse: handleEndorse,
      onMintNFT,
    },
  };
}

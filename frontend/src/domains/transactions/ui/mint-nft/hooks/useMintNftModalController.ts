import { trackedTransactionHash } from "../../../model/txStatus";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { isMetadataUnlockUsable, makeNodeId } from "../../../../../shared/model";
import type { ProtocolPassphraseRisk } from "../../../../../shared/crypto/passphraseStrength";
import { safeCanonicalizeFullName } from "../../../../../shared/identity/fullName";
import { useResponsiveModalMode } from "../../../../../shared/ui";
import { useWallet } from "../../../../wallet";
import { useContractClient } from "../../../hooks/useContractClient";
import { useEndorsedVersionLookup } from "../../../hooks/useEndorsedVersionIndex";
import { usePersonVersionOptions } from "../../../hooks/usePersonVersionOptions";
import { reconcileMintVersionSelection } from "../model/mintVersionSelection";
import { useTreeGraphData, useTreeMutations } from "../../../../tree";
import type { PersonHashCalculatorHandle } from "../../../../person";
import { useTransactionModalFrameState } from "../../shared/useTransactionModalFrameState";
import { createMintNFTSchema } from "../model/mintNftSchema";
import type {
  MintConsents,
  MintNFTErrorResultView,
  MintNFTFormValues,
  MintNFTSuccessResultView,
  MintPersonInfo,
} from "../model/mintNftTypes";
import { useDisclosureProof } from "./useDisclosureProof";
import { useMintNftFlow } from "./useMintNftFlow";
import { useTransactionPreviewDecision } from "../../shared/useTransactionPreviewDecision";
import { resolveTransactionPhase } from "../../shared/transactionPhase";
import { buildTimeline, useTimelineProgress } from "../../shared/TransactionTimeline";
import { MINT_TIMELINE_STEPS, mintTimelineStep } from "../../shared/timelineSteps";
import { useTransactionCenterEntry } from "../../shared/useTransactionCenterEntry";
import { useTransactionTargetSelection } from "../../shared/useTransactionTargetSelection";
import type { ArchiveTransactionPreview } from "../../../services/archiveTransaction";
import { useMintNftSubmit } from "./useMintNftSubmit";
import { useMintTargetStatus } from "./useMintTargetStatus";

interface UseMintNftModalControllerArgs {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (tokenId: number) => void;
  onGoEndorse?: (personHash: string, versionIndex: number) => void;
  initialPersonHash?: string;
  initialVersionIndex?: number;
}

function isBytes32(value: string | undefined | null) {
  return Boolean(value && /^0x[0-9a-fA-F]{64}$/.test(value.trim()));
}

function defaultConsents(): MintConsents {
  return { public: false, age: false, legal: false };
}

export function useMintNftModalController({
  isOpen,
  onClose,
  onSuccess,
  onGoEndorse,
  initialPersonHash,
  initialVersionIndex,
}: UseMintNftModalControllerArgs) {
  const { t } = useTranslation();
  const { address } = useWallet();
  const { getVersionDetails, getMetadataCode, contract, readDeepFamilyContract } =
    useContractClient();
  // Endorsement is read from the app's RPC. Right after endorsing, the wallet
  // provider can still answer from the block before it, and this modal reads
  // the target's status once — so a stale "not endorsed" would never go away.
  const endorsementReader = readDeepFamilyContract ?? contract;
  const { markVersionMinted } = useTreeMutations();
  const { nodesData } = useTreeGraphData();
  const mintNFTSchema = useMemo(() => createMintNFTSchema(t), [t]);
  const modalOpenRef = useRef(isOpen);
  modalOpenRef.current = isOpen;
  const submissionAttemptRef = useRef(0);
  const { transactionPreview, confirmTransactionPreview: requestTransactionPreview, decideTransactionPreview } =
    useTransactionPreviewDecision<ArchiveTransactionPreview>();
  const confirmTransactionPreview = useCallback(
    (preview: ArchiveTransactionPreview) =>
      modalOpenRef.current ? requestTransactionPreview(preview) : Promise.resolve(false),
    [requestTransactionPreview],
  );
  useEffect(() => () => {
    submissionAttemptRef.current += 1;
  }, []);
  const {
    status: mintNftStatus,
    tracking: mintNftTracking,
    reset: resetMintNftFlow,
    runOrThrow: runMintNftOrThrow,
  } = useMintNftFlow({ confirmTransactionPreview });
  const { proofStep, generateDisclosureProof, reset: resetDisclosureProof } = useDisclosureProof();

  const [consents, setConsents] = useState(defaultConsents);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [personInfo, setPersonInfo] = useState<MintPersonInfo | null>(null);
  const [showEndorseConfirm, setShowEndorseConfirm] = useState(false);
  const [successResult, setSuccessResult] = useState<MintNFTSuccessResultView | null>(null);
  const [errorResult, setErrorResult] = useState<MintNFTErrorResultView | null>(null);
  const previousTargetRef = useRef({ hash: "", index: 0 });
  const didPatchCacheRef = useRef(false);
  const personCalcRef = useRef<PersonHashCalculatorHandle | null>(null);

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
  const hasTargetInputs = hasValidTarget;
  const endorsedVersionLookup = useEndorsedVersionLookup(
    isOpen && isPersonHashFormatValid ? targetPersonHash : null,
    address,
    endorsementReader,
  );
  const allConsentsChecked = consents.public && consents.age && consents.legal;
  const hasPersonInfo = Boolean(safeCanonicalizeFullName(personInfo?.fullName || ""));
  const validatedTargetBiography = useMemo(() => {
    if (!hasValidTarget) return undefined;
    const exact = nodesData[makeNodeId(targetPersonHash, targetVersionIndex)];
    const node =
      exact ??
      Object.values(nodesData).find(
        (candidate) =>
          candidate.personHash.toLowerCase() === targetPersonHash.toLowerCase() &&
          Number(candidate.versionIndex) === targetVersionIndex,
      );
    if (!isMetadataUnlockUsable(node)) {
      return undefined;
    }
    return node.biography;
  }, [hasValidTarget, nodesData, targetPersonHash, targetVersionIndex]);

  const isDesktop = useResponsiveModalMode();
  const requestCancellation = useCallback(() => {
    modalOpenRef.current = false;
    submissionAttemptRef.current += 1;
    decideTransactionPreview(false);
    resetDisclosureProof();
    resetMintNftFlow();
    onClose();
  }, [decideTransactionPreview, onClose, resetDisclosureProof, resetMintNftFlow]);
  const { entered, requestClose: requestFrameClose } = useTransactionModalFrameState({
    isOpen,
    isDesktop,
    modalId: "MintNFTModal",
    onClose: requestCancellation,
  });

  const targetStatus = useMintTargetStatus({
    isOpen,
    address,
    contract: endorsementReader,
    getVersionDetails: getVersionDetails ?? undefined,
    getMetadataCode: getMetadataCode ?? undefined,
    targetPersonHash,
    targetVersionIndex,
    hasValidTarget,
  });
  const {
    isEndorsed,
    isAlreadyMinted,
    isCheckingStatus,
    selfSuiteId: targetSelfSuiteId,
    envelopeHeaderError,
    reset: resetTargetStatus,
  } = targetStatus;

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    watch,
  } = useForm<MintNFTFormValues>({
    resolver: zodResolver(mintNFTSchema),
    defaultValues: {
      birthPlace: "",
      isDeathBC: false,
      deathYear: "",
      deathMonth: "",
      deathDay: "",
      deathPlace: "",
      storyTitle: "",
      story: "",
      tokenURI: "",
    },
  });

  const isTransactionSubmitting =
    mintNftStatus === "validating" ||
    mintNftStatus === "submitting" ||
    mintNftStatus === "confirming";
  const isSubmitting = Boolean(proofStep) || isTransactionSubmitting;
  const timelineStep = useTimelineProgress(
    MINT_TIMELINE_STEPS,
    mintTimelineStep({
      proofStep,
      isBusy: isSubmitting,
      hasPreview: Boolean(transactionPreview),
      status: mintNftStatus,
    }),
    // A failure keeps the step it stopped on, for the timeline above the error.
    { holdLastStep: Boolean(errorResult) },
  );
  const phase = resolveTransactionPhase({
    successResult,
    errorResult,
    transactionPreview,
    isBusy: isSubmitting,
    isBlocked: isAlreadyMinted,
  });

  const { settle: settleTransaction, captureSettlement } = useTransactionCenterEntry({
    kind: "mint",
    label: t("mintNFT.title", "Mint NFT"),
    phase,
    transactionHash: trackedTransactionHash(mintNftTracking) ?? successResult?.transactionHash ?? errorResult?.transactionHash,
    error: errorResult,
  });

  const resetBusinessState = useCallback(() => {
    submissionAttemptRef.current += 1;
    reset();
    seedTarget("", 1);
    setPersonInfo(null);
    setSuccessResult(null);
    setErrorResult(null);
    setConsents(defaultConsents());
    setConsentError(null);
    setShowEndorseConfirm(false);
    decideTransactionPreview(false);
    resetDisclosureProof();
    resetMintNftFlow();
    resetTargetStatus();
    previousTargetRef.current = { hash: "", index: 0 };
    didPatchCacheRef.current = false;
  }, [
    reset,
    resetDisclosureProof,
    resetMintNftFlow,
    resetTargetStatus,
    seedTarget,
    decideTransactionPreview,
  ]);

  const handleClose = useCallback(() => {
    modalOpenRef.current = false;
    resetBusinessState();
    requestFrameClose();
  }, [requestFrameClose, resetBusinessState]);

  useEffect(() => {
    if (isOpen) {
      submissionAttemptRef.current += 1;
      const nextHash = initialPersonHash || "";
      const nextIndex = initialVersionIndex || 0;
      seedTarget(nextHash, nextIndex);
      setSuccessResult(null);
      setErrorResult(null);
      setConsentError(null);
      setShowEndorseConfirm(false);
      resetDisclosureProof();
      resetMintNftFlow();
      previousTargetRef.current = { hash: nextHash, index: nextIndex };
      didPatchCacheRef.current = false;
      return;
    }

    resetBusinessState();
  }, [
    initialPersonHash,
    initialVersionIndex,
    isOpen,
    resetDisclosureProof,
    resetMintNftFlow,
    resetBusinessState,
  ]);

  // Minting can only target a version the wallet already endorsed, so which
  // version a lookup preselects is a minting rule, not a shared one.
  useEffect(() => {
    applyVersionDecision(
      reconcileMintVersionSelection(
        versionLookup,
        getDecidedVersionHash(),
        endorsedVersionLookup.versionIndex,
        endorsedVersionLookup.status === "ready",
      ),
    );
  }, [applyVersionDecision, endorsedVersionLookup, getDecidedVersionHash, versionLookup]);

  useEffect(() => {
    if (!isOpen) return;
    const changed =
      previousTargetRef.current.hash !== targetPersonHash ||
      previousTargetRef.current.index !== targetVersionIndex;
    if (!changed) return;

    previousTargetRef.current = { hash: targetPersonHash, index: targetVersionIndex };
    submissionAttemptRef.current += 1;
    decideTransactionPreview(false);
    resetDisclosureProof();
    setSuccessResult(null);
    setErrorResult(null);
    setConsentError(null);
    didPatchCacheRef.current = false;
    resetMintNftFlow();
  }, [decideTransactionPreview, isOpen, resetDisclosureProof, resetMintNftFlow, targetPersonHash, targetVersionIndex]);

  const toggleConsent = useCallback(
    (key: keyof MintConsents) => {
      setConsents((current) => {
        const next = { ...current, [key]: !current[key] };
        if (consentError && next.public && next.age && next.legal) {
          setConsentError(null);
        }
        return next;
      });
    },
    [consentError],
  );

  const handlePassphraseChange = useCallback(() => {
    setConsentError(null);
  }, []);

  const handleGoEndorse = useCallback(() => {
    if (!targetPersonHash || !isPersonHashFormatValid || !targetVersionIndex) {
      setShowEndorseConfirm(false);
      return;
    }
    onGoEndorse?.(targetPersonHash, targetVersionIndex);
  }, [isPersonHashFormatValid, onGoEndorse, targetPersonHash, targetVersionIndex]);

  const handleContinueMinting = useCallback(() => {
    resetBusinessState();
  }, [resetBusinessState]);

  const onSubmit = useMintNftSubmit({
    t,
    address,
    contract,
    allConsentsChecked,
    hasTargetInputs,
    hasValidTarget,
    isEndorsed,
    isAlreadyMinted,
    personInfo,
    personCalcRef,
    targetPersonHash,
    targetVersionIndex,
    targetSelfSuiteId,
    didPatchCacheRef,
    generateDisclosureProof,
    resetDisclosureProof,
    runMintNftOrThrow,
    markVersionMinted,
    onSuccess,
    setConsentError,
    setErrorResult,
    setSuccessResult,
    setShowEndorseConfirm,
    settleTransaction,
    captureSettlement,
    modalOpenRef,
    submissionAttemptRef,
  });

  return {
    t,
    frame: {
      isOpen,
      onClose: handleClose,
      isDesktop,
      entered,
    },
    form: {
      handleSubmit,
      onSubmit,
    },
    targetSection: {
      personHash,
      versionIndex,
      hashInputInvalid,
      hasValidTarget,
      isCheckingStatus,
      envelopeHeaderError,
      versionLookup,
      onPersonHashChange: setPersonHash,
      onVersionIndexChange: handleVersionIndexChange,
    },
    personProofSection: {
      personCalcRef,
      personInfo,
      targetSelfSuiteId,
      onPersonInfoChange: setPersonInfo,
      onPassphraseChange: handlePassphraseChange,
    },
    supplementForm: {
      register,
      errors,
      setValue,
      watch,
      validatedBiography: validatedTargetBiography,
    },
    consentSection: {
      consents,
      consentError,
      onToggleConsent: toggleConsent,
    },
    statusPanel: {
      phase,
      timeline: buildTimeline({
        steps: [
          {
            id: "identity",
            label: t("transaction.stepIdentity", "Derive identity material"),
          },
          {
            id: "proof",
            label: t("transaction.stepProof", "Generate zero-knowledge proof"),
            detail:
              proofStep === "verifying"
                ? t("mintNFT.verifyingProof", "Verifying zero-knowledge proof...")
                : t(
                    "transaction.proofGenerationHint",
                    "Keep this page open while the proof is generated.",
                  ),
          },
          {
            id: "review",
            label: t("transaction.stepReview", "Confirm the transaction"),
            // Before it is your turn, this row is the flow assembling what you
            // will be asked to confirm.
            detail:
              phase === "review"
                ? t(
                    "transaction.stepReviewDetail",
                    "Waiting for you to confirm and open your wallet",
                  )
                : t("transaction.stepEstimating", "Estimating the transaction fee…"),
          },
          {
            id: "confirm",
            label: t("transaction.stepConfirm", "Waiting for on-chain confirmation"),
          },
        ],
        currentId: timelineStep,
        failed: phase === "failed" && !errorResult?.transactionConfirmed,
        complete: phase === "done" || errorResult?.transactionConfirmed === true,
        // This step stops for the user; it must not look like work in progress.
        awaiting: phase === "review",
      }),
      transactionPreview,
      successResult,
      errorResult,
    },
    footer: {
      phase,
      successResult,
      isSubmitting,
      isCheckingStatus,
      isEndorsed,
      isAlreadyMinted,
      allConsentsChecked,
      hasPersonInfo,
      hasTargetInputs,
      hasValidTarget,
      hasVerifiedTargetEnvelope: targetSelfSuiteId !== null,
      transactionPreview,
      onTransactionPreviewDecision: decideTransactionPreview,
      onClose: handleClose,
      onBackToEdit: () => setErrorResult(null),
      onContinueMinting: handleContinueMinting,
      onShowEndorseConfirm: () => setShowEndorseConfirm(true),
    },
    endorseDialog: {
      open: showEndorseConfirm,
      onCancel: () => setShowEndorseConfirm(false),
      onGoEndorse: handleGoEndorse,
    },
  };
}

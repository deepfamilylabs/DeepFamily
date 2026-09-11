import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { isMetadataUnlockUsable, makeNodeId } from "../../../../../shared/model";
import type { ProtocolPassphraseRisk } from "../../../../../shared/crypto/passphraseStrength";
import { useResponsiveModalMode } from "../../../../../shared/ui";
import { useWallet } from "../../../../wallet";
import { useContractClient } from "../../../hooks/useContractClient";
import { useEndorsedVersionIndex } from "../../../hooks/useEndorsedVersionIndex";
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
  const { getVersionDetails, getMetadataCode, contract } = useContractClient();
  const { markVersionMinted } = useTreeMutations();
  const { nodesData } = useTreeGraphData();
  const mintNFTSchema = useMemo(() => createMintNFTSchema(t), [t]);
  const { transactionPreview, confirmTransactionPreview, decideTransactionPreview } =
    useTransactionPreviewDecision<ArchiveTransactionPreview>();
  const {
    status: mintNftStatus,
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
  const endorsedVersionIndex = useEndorsedVersionIndex(
    isOpen && isPersonHashFormatValid ? targetPersonHash : null,
    address,
    contract,
  );
  const allConsentsChecked = consents.public && consents.age && consents.legal;
  const hasPersonInfo = Boolean(personInfo?.fullName?.trim());
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
  const { entered, requestClose: handleClose } = useTransactionModalFrameState({
    isOpen,
    isDesktop,
    modalId: "MintNFTModal",
    onClose,
  });

  const targetStatus = useMintTargetStatus({
    isOpen,
    address,
    contract,
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
  );
  const phase = resolveTransactionPhase({
    successResult,
    errorResult,
    transactionPreview,
    isBusy: isSubmitting,
    isBlocked: isAlreadyMinted,
  });

  const { settle: settleTransaction } = useTransactionCenterEntry({
    kind: "mint",
    label: t("mintNFT.title", "Mint NFT"),
    phase,
    transactionHash: successResult?.transactionHash,
    error: errorResult,
  });

  const resetBusinessState = useCallback(() => {
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
  }, [reset, resetDisclosureProof, resetMintNftFlow, resetTargetStatus, seedTarget, decideTransactionPreview]);

  useEffect(() => {
    if (isOpen) {
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
      reconcileMintVersionSelection(versionLookup, getDecidedVersionHash(), endorsedVersionIndex),
    );
  }, [applyVersionDecision, endorsedVersionIndex, getDecidedVersionHash, versionLookup]);

  useEffect(() => {
    if (!isOpen) return;
    const changed =
      previousTargetRef.current.hash !== targetPersonHash ||
      previousTargetRef.current.index !== targetVersionIndex;
    if (!changed) return;

    previousTargetRef.current = { hash: targetPersonHash, index: targetVersionIndex };
    setSuccessResult(null);
    setErrorResult(null);
    setConsentError(null);
    didPatchCacheRef.current = false;
    resetMintNftFlow();
  }, [isOpen, resetMintNftFlow, targetPersonHash, targetVersionIndex]);

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
            // Says what the label cannot: how long, and what it needs from you.
            detail: proofStep === "verifying"
                ? t("mintNFT.verifyingProof", "Verifying zero-knowledge proof...")
                : t(
                    "transaction.proofDuration",
                    "This can take 30–60 seconds; keep this tab active.",
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
        failed: phase === "failed",
        complete: phase === "done",
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
      // Only once the transaction is away. Before that, closing cancels, so
      // offering to "continue in background" would be a lie.
      onRunInBackground: mintNftStatus === "confirming" ? handleClose : undefined,
      transactionPreview,
      onTransactionPreviewDecision: decideTransactionPreview,
      onClose: handleClose,
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

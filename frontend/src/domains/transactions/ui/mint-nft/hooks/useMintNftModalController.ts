import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { makeNodeId } from "../../../../../shared/model";
import { useResponsiveModalMode } from "../../../../../shared/ui";
import { useWallet } from "../../../../wallet";
import { useContractClient } from "../../../hooks/useContractClient";
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
  const {
    status: mintNftStatus,
    reset: resetMintNftFlow,
    runOrThrow: runMintNftOrThrow,
  } = useMintNftFlow();
  const {
    proofGenerationStep,
    generateDisclosureProof,
    reset: resetDisclosureProof,
  } = useDisclosureProof();

  const [personHash, setPersonHash] = useState("");
  const [versionIndex, setVersionIndex] = useState(1);
  const [consents, setConsents] = useState(defaultConsents);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [personInfo, setPersonInfo] = useState<MintPersonInfo | null>(null);
  const [showEndorseConfirm, setShowEndorseConfirm] = useState(false);
  const [successResult, setSuccessResult] = useState<MintNFTSuccessResultView | null>(null);
  const [errorResult, setErrorResult] = useState<MintNFTErrorResultView | null>(null);
  const previousTargetRef = useRef({ hash: "", index: 0 });
  const didPatchCacheRef = useRef(false);
  const personCalcRef = useRef<PersonHashCalculatorHandle | null>(null);

  const targetPersonHash = personHash.trim();
  const targetVersionIndex = versionIndex;
  const isPersonHashFormatValid = isBytes32(targetPersonHash);
  const hasValidTarget = Boolean(
    targetPersonHash && isPersonHashFormatValid && targetVersionIndex > 0,
  );
  const hasTargetInputs = hasValidTarget;
  const hashInputInvalid = Boolean(targetPersonHash && !isPersonHashFormatValid);
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
    if (node?.metadataUnlockValidated !== true || typeof node.biography !== "string") {
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
    hasMissingParents,
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
  const isSubmitting = Boolean(proofGenerationStep) || isTransactionSubmitting;

  const resetBusinessState = useCallback(() => {
    reset();
    setPersonHash("");
    setVersionIndex(1);
    setPersonInfo(null);
    setSuccessResult(null);
    setErrorResult(null);
    setConsents(defaultConsents());
    setConsentError(null);
    setShowEndorseConfirm(false);
    resetDisclosureProof();
    resetMintNftFlow();
    resetTargetStatus();
    previousTargetRef.current = { hash: "", index: 0 };
    didPatchCacheRef.current = false;
  }, [reset, resetDisclosureProof, resetMintNftFlow, resetTargetStatus]);

  useEffect(() => {
    if (isOpen) {
      const nextHash = initialPersonHash || "";
      const nextIndex = initialVersionIndex || 1;
      setPersonHash(nextHash);
      setVersionIndex(nextIndex);
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
      isEndorsed,
      isAlreadyMinted,
      hasMissingParents,
      targetSelfSuiteId,
      envelopeHeaderError,
      onPersonHashChange: setPersonHash,
      onVersionIndexChange: setVersionIndex,
    },
    personProofSection: {
      personCalcRef,
      personInfo,
      targetSelfSuiteId,
      onPersonInfoChange: setPersonInfo,
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
      isSubmitting,
      proofGenerationStep,
      successResult,
      errorResult,
      isAlreadyMinted,
    },
    footer: {
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { safeCanonicalizeFullName } from "../../../../../shared/crypto/identityCommitment";
import { useResponsiveModalMode, useToast } from "../../../../../shared/ui";
import { useWallet } from "../../../../wallet";
import { useConfig } from "../../../../config";
import { useContractClient } from "../../../hooks/useContractClient";
import { useTreeMutations } from "../../../../tree";
import type { PersonHashCalculatorHandle } from "../../../../person";
import { useTransactionModalFrameState } from "../../shared/useTransactionModalFrameState";
import { addVersionSchema } from "../model/addVersionSchema";
import type {
  AddVersionConsents,
  AddVersionErrorResultView,
  AddVersionFormInput,
  AddVersionSuccessResultView,
  ParentKind,
  ParentStatus,
  PersonInfoPublic,
} from "../model/addVersionTypes";
import { useAddVersionFlow } from "./useAddVersionFlow";
import { useAddVersionIdentityMaterials } from "./useAddVersionIdentityMaterials";
import {
  useAddVersionSubmit,
  type RetryableAddVersionSubmission,
} from "./useAddVersionSubmit";
import { usePersonCommitmentProof } from "./usePersonCommitmentProof";

interface UseAddVersionModalControllerArgs {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (result: any) => void;
  onEndorse?: (personHash: string, versionIndex: number) => void;
  initialPersonData?: Partial<PersonInfoPublic>;
}

function defaultConsents(): AddVersionConsents {
  return { hash: false, age: false, legal: false, passphrase: false };
}

function getParentInfoStatus(
  info: PersonInfoPublic | null,
  versionIndex: number | "",
): ParentStatus {
  const canonicalFullName = safeCanonicalizeFullName(info?.fullName || "");
  if (!info || !canonicalFullName) return "empty";
  if (typeof versionIndex === "number" && versionIndex > 0) return "complete";
  return "partial";
}

export function useAddVersionModalController({
  isOpen,
  onClose,
  onSuccess,
  onEndorse,
  initialPersonData,
}: UseAddVersionModalControllerArgs) {
  const { t } = useTranslation();
  const { signer } = useWallet();
  const { chainId, contractAddress, readerAddress } = useConfig();
  const { isContractReady } = useContractClient();
  const toast = useToast();
  const { invalidateByTx, cacheValidatedPersonVersion } = useTreeMutations();
  const {
    status: addVersionStatus,
    reset: resetAddVersionFlow,
    runOrThrow: runAddVersionOrThrow,
  } = useAddVersionFlow();
  const identityMaterials = useAddVersionIdentityMaterials();
  const commitmentProof = usePersonCommitmentProof(t);

  const [isSubmittingState, setIsSubmitting] = useState(false);
  const [consents, setConsents] = useState(defaultConsents);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<AddVersionSuccessResultView | null>(null);
  const [errorResult, setErrorResult] = useState<AddVersionErrorResultView | null>(null);

  const [personInfo, setPersonInfo] = useState<PersonInfoPublic | null>(null);
  const personCalcRef = useRef<PersonHashCalculatorHandle | null>(null);

  const [fatherInfo, setFatherInfo] = useState<PersonInfoPublic | null>(null);
  const fatherCalcRef = useRef<PersonHashCalculatorHandle | null>(null);

  const [motherInfo, setMotherInfo] = useState<PersonInfoPublic | null>(null);
  const motherCalcRef = useRef<PersonHashCalculatorHandle | null>(null);
  const submissionPackageRef = useRef<RetryableAddVersionSubmission | null>(null);

  const [fatherExpanded, setFatherExpanded] = useState(false);
  const [motherExpanded, setMotherExpanded] = useState(false);
  const [formResetKey, setFormResetKey] = useState(0);

  const isDesktop = useResponsiveModalMode();
  const { entered, requestClose: requestFrameClose } = useTransactionModalFrameState({
    isOpen,
    isDesktop,
    modalId: "AddVersionModal",
    onClose,
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    reset,
  } = useForm<AddVersionFormInput>({
    resolver: zodResolver(addVersionSchema),
    defaultValues: {
      fatherVersionIndex: "",
      motherVersionIndex: "",
      tag: "",
      biography: "",
    },
  });

  const watchedValues = watch();
  const fatherStatus = getParentInfoStatus(fatherInfo, watchedValues.fatherVersionIndex);
  const motherStatus = getParentInfoStatus(motherInfo, watchedValues.motherVersionIndex);
  const allConsentsChecked =
    consents.hash && consents.age && consents.legal && consents.passphrase;
  const isTransactionSubmitting =
    addVersionStatus === "validating" || addVersionStatus === "confirming";
  const isSubmitting = isSubmittingState || isTransactionSubmitting;

  const resetCommitmentProof = commitmentProof.reset;

  const resetBusinessState = useCallback(
    (options?: { remountCalculators?: boolean }) => {
      reset();
      setPersonInfo(null);
      setFatherInfo(null);
      setMotherInfo(null);
      submissionPackageRef.current = null;
      setIsSubmitting(false);
      resetCommitmentProof();
      resetAddVersionFlow();
      setSuccessResult(null);
      setErrorResult(null);
      setFatherExpanded(false);
      setMotherExpanded(false);
      setConsents(defaultConsents());
      setConsentError(null);
      if (options?.remountCalculators) {
        setFormResetKey((current) => current + 1);
      }
    },
    [resetCommitmentProof, reset, resetAddVersionFlow],
  );

  useEffect(() => {
    if (initialPersonData) {
      setPersonInfo({
        fullName: initialPersonData.fullName || "",
        gender: initialPersonData.gender || 0,
        birthYear: initialPersonData.birthYear || 0,
        birthMonth: initialPersonData.birthMonth || 0,
        birthDay: initialPersonData.birthDay || 0,
        isBirthBC: initialPersonData.isBirthBC || false,
      });
    }
  }, [initialPersonData]);

  useEffect(() => {
    if (isOpen) return;
    resetBusinessState();
  }, [isOpen, resetBusinessState]);

  const handleClose = useCallback(() => {
    resetBusinessState();
    requestFrameClose();
  }, [requestFrameClose, resetBusinessState]);

  const handleContinueAdding = useCallback(() => {
    resetBusinessState({ remountCalculators: true });
  }, [resetBusinessState]);

  const toggleConsent = useCallback(
    (key: keyof AddVersionConsents) => {
      setConsents((current) => {
        const next = { ...current, [key]: !current[key] };
        if (consentError && next.hash && next.age && next.legal) setConsentError(null);
        return next;
      });
    },
    [consentError],
  );

  const onSubmit = useAddVersionSubmit({
    t,
    signer,
    isContractReady,
    chainId,
    contractAddress,
    readerAddress,
    allConsentsChecked,
    personCalcRef,
    resolveIdentityMaterial: identityMaterials.resolveIdentityMaterial,
    fatherCalcRef,
    motherCalcRef,
    buildMetadataPayload: identityMaterials.buildMetadataPayload,
    generatePersonCommitmentProof: commitmentProof.generatePersonCommitmentProof,
    setProofGenerationStep: commitmentProof.setProofGenerationStep,
    runAddVersionOrThrow,
    cacheValidatedPersonVersion,
    toastSuccess: toast.success,
    toastError: toast.error,
    invalidateByTx,
    onSuccess,
    setConsentError,
    setErrorResult,
    setSuccessResult,
    setIsSubmitting,
    submissionPackageRef,
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
    intro: {},
    personSection: {
      formResetKey,
      personCalcRef,
      initialPersonData,
      onPersonInfoChange: setPersonInfo,
    },
    fatherSection: {
      kind: "father" as ParentKind,
      formResetKey,
      expanded: fatherExpanded,
      status: fatherStatus,
      calcRef: fatherCalcRef,
      register,
      onExpandedChange: setFatherExpanded,
      onInfoChange: setFatherInfo,
    },
    motherSection: {
      kind: "mother" as ParentKind,
      formResetKey,
      expanded: motherExpanded,
      status: motherStatus,
      calcRef: motherCalcRef,
      register,
      onExpandedChange: setMotherExpanded,
      onInfoChange: setMotherInfo,
    },
    metadataSection: {
      register,
      isSubmitting,
    },
    consentSection: {
      consents,
      consentError,
      onToggleConsent: toggleConsent,
    },
    statusPanel: {
      isSubmitting,
      proofGenerationStep: commitmentProof.proofGenerationStep,
      successResult,
      errorResult,
    },
    footer: {
      successResult,
      isSubmitting,
      personInfo,
      allConsentsChecked,
      onClose: handleClose,
      onContinueAdding: handleContinueAdding,
      onEndorse,
    },
  };
}

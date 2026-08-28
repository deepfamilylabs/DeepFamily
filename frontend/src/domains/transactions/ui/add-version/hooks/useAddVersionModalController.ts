import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { isDevMode } from "../../../../../shared/config/env";
import { safeCanonicalizeFullName } from "../../../../../shared/identity/fullName";
import { useResponsiveModalMode, useToast } from "../../../../../shared/ui";
import { useWallet } from "../../../../wallet";
import { useConfig } from "../../../../config";
import { useContractClient } from "../../../hooks/useContractClient";
import { useTreeMutations } from "../../../../tree";
import type { PersonHashCalculatorHandle } from "../../../../person";
import { useTransactionModalFrameState } from "../../shared/useTransactionModalFrameState";
import { addVersionSchema } from "../model/addVersionSchema";
import {
  areAddVersionConsentsSatisfied,
  invalidateAddVersionPassphraseConsents,
} from "../model/addVersionPassphraseConsent";
import type {
  AddVersionConsents,
  AddVersionErrorResultView,
  AddVersionFormInput,
  AddVersionIdentityRole,
  AddVersionSuccessResultView,
  AddVersionTransactionPreview,
  ParentKind,
  ParentStatus,
  PersonInfoPublic,
} from "../model/addVersionTypes";
import { useAddVersionFlow } from "./useAddVersionFlow";
import { useAddVersionIdentityMaterials } from "./useAddVersionIdentityMaterials";
import { useAddVersionSubmit, type RetryableAddVersionSubmission } from "./useAddVersionSubmit";
import { usePersonCommitmentProof } from "./usePersonCommitmentProof";

interface UseAddVersionModalControllerArgs {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (result: any) => void;
  onEndorse?: (personHash: string, versionIndex: number) => void;
  initialPersonData?: Partial<PersonInfoPublic>;
}

function defaultConsents(): AddVersionConsents {
  return {
    hash: false,
    legal: false,
    passphrase: false,
  };
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

function calculatorHasIdentity(calc: PersonHashCalculatorHandle | null): boolean {
  return safeCanonicalizeFullName(calc?.getPublicFormData().fullName || "").length > 0;
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
  const { rpcUrl, chainId, contractAddress, readerAddress } = useConfig();
  const { isContractReady } = useContractClient();
  const toast = useToast();
  const { invalidateByTx, cacheConfirmedPersonVersion, captureMetadataCacheRevision } =
    useTreeMutations();
  const [transactionPreview, setTransactionPreview] = useState<AddVersionTransactionPreview | null>(
    null,
  );
  const transactionPreviewDecisionRef = useRef<((approved: boolean) => void) | null>(null);
  const confirmTransactionPreview = useCallback(
    (preview: AddVersionTransactionPreview) =>
      new Promise<boolean>((resolve) => {
        // There must only be one wallet-bound package awaiting a decision.
        transactionPreviewDecisionRef.current?.(false);
        transactionPreviewDecisionRef.current = resolve;
        setTransactionPreview(preview);
      }),
    [],
  );
  const decideTransactionPreview = useCallback((approved: boolean) => {
    const resolve = transactionPreviewDecisionRef.current;
    transactionPreviewDecisionRef.current = null;
    setTransactionPreview(null);
    resolve?.(approved);
  }, []);
  const {
    status: addVersionStatus,
    reset: resetAddVersionFlow,
    runOrThrow: runAddVersionOrThrow,
  } = useAddVersionFlow({ confirmTransactionPreview });
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
  const confirmedCacheRevisionRef = useRef<number | null>(null);

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
  const fatherPresent = fatherStatus !== "empty";
  const motherPresent = motherStatus !== "empty";
  const allConsentsChecked = areAddVersionConsentsSatisfied(consents);
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
      decideTransactionPreview(false);
      submissionPackageRef.current = null;
      confirmedCacheRevisionRef.current = null;
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
    [decideTransactionPreview, resetCommitmentProof, reset, resetAddVersionFlow],
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

  const updatePassphraseRisk = useCallback(
    (role: AddVersionIdentityRole, calc: PersonHashCalculatorHandle | null) => {
      // Do not even read a null parent's secret input. If the parent later
      // becomes non-null, onParentInfoChange takes the first risk snapshot.
      if (role !== "person" && !calculatorHasIdentity(calc)) return;
      // A wallet/RPC retry may reuse only the exact passphrase-derived package
      // the user already reviewed. Any later secret edit starts a new attempt;
      // otherwise draftKey (deliberately free of secrets) would silently reuse
      // an envelope encrypted under the previous passphrase.
      submissionPackageRef.current = null;
      setConsents(invalidateAddVersionPassphraseConsents);
    },
    [],
  );

  const updateParentInfo = useCallback(
    (role: ParentKind, value: PersonInfoPublic, calc: PersonHashCalculatorHandle | null) => {
      if (role === "father") setFatherInfo(value);
      else setMotherInfo(value);
    },
    [],
  );

  const handlePersonPassphraseChange = useCallback(() => {
    updatePassphraseRisk("person", personCalcRef.current);
  }, [updatePassphraseRisk]);
  const handleFatherPassphraseChange = useCallback(() => {
    updatePassphraseRisk("father", fatherCalcRef.current);
  }, [updatePassphraseRisk]);
  const handleMotherPassphraseChange = useCallback(() => {
    updatePassphraseRisk("mother", motherCalcRef.current);
  }, [updatePassphraseRisk]);

  const previousParentPresenceRef = useRef({ father: false, mother: false });
  useEffect(() => {
    const previous = previousParentPresenceRef.current;
    if (previous.father !== fatherPresent || previous.mother !== motherPresent) {
      setConsents((current) => {
        let next = current;
        for (const [role, present] of [
          ["father", fatherPresent],
          ["mother", motherPresent],
        ] as const) {
          // A newly added parent contributes a passphrase the user has not
          // reviewed yet, so the universal confirmation must be redone. Removing
          // a parent clears nothing: parents carry no consent of their own.
          if (previous[role] !== present && present) {
            next = invalidateAddVersionPassphraseConsents(next);
          }
        }
        return next;
      });
      previousParentPresenceRef.current = {
        father: fatherPresent,
        mother: motherPresent,
      };
    }
  }, [fatherPresent, motherPresent]);

  const toggleConsent = useCallback(
    (key: keyof AddVersionConsents) => {
      setConsents((current) => {
        const next = { ...current, [key]: !current[key] };
        if (consentError && areAddVersionConsentsSatisfied(next)) {
          setConsentError(null);
        }
        return next;
      });
    },
    [consentError],
  );

  const cacheConfirmedAfterTransaction = useCallback(
    (node: Parameters<typeof cacheConfirmedPersonVersion>[0]) => {
      // Public anchors were verified immediately before this callback. The
      // synchronous projection/upsert may still throw, but a local durability
      // failure must not turn a confirmed chain transaction into a failed flow.
      const persistence = cacheConfirmedPersonVersion(
        node,
        confirmedCacheRevisionRef.current ?? -1,
      );
      void persistence.catch((error: unknown) => {
        if (isDevMode()) {
          console.warn("Confirmed person-version cache persistence failed", {
            errorType: error instanceof Error ? error.name : typeof error,
          });
        }
      });
    },
    [cacheConfirmedPersonVersion],
  );

  const submitAddVersion = useAddVersionSubmit({
    t,
    signer,
    isContractReady,
    rpcUrl,
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
    cacheValidatedPersonVersion: cacheConfirmedAfterTransaction,
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

  const onSubmit = useCallback(
    async (data: AddVersionFormInput) => {
      // A retryable package has already passed this exact consent snapshot and
      // its secret inputs were deliberately erased before the wallet/RPC wait.
      // Retry validation belongs to the frozen package path in useAddVersionSubmit.
      if (submissionPackageRef.current) {
        await submitAddVersion(data);
        return;
      }
      // The submission may spend minutes in KDF/proving/wallet/RPC work. A
      // later local-cache clear must fence its eventual plaintext completion.
      confirmedCacheRevisionRef.current = captureMetadataCacheRevision();
      if (!areAddVersionConsentsSatisfied(consents)) {
        setConsentError(
          t(
            "addVersion.consentMissing",
            "Please confirm all required checkboxes for the current identity passphrases before submitting",
          ),
        );
        return;
      }
      await submitAddVersion(data);
    },
    [captureMetadataCacheRevision, consents, submitAddVersion, t],
  );

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
      onPassphraseChange: handlePersonPassphraseChange,
    },
    fatherSection: {
      kind: "father" as ParentKind,
      formResetKey,
      expanded: fatherExpanded,
      status: fatherStatus,
      calcRef: fatherCalcRef,
      register,
      onExpandedChange: setFatherExpanded,
      onInfoChange: (value: PersonInfoPublic) =>
        updateParentInfo("father", value, fatherCalcRef.current),
      onPassphraseChange: handleFatherPassphraseChange,
    },
    motherSection: {
      kind: "mother" as ParentKind,
      formResetKey,
      expanded: motherExpanded,
      status: motherStatus,
      calcRef: motherCalcRef,
      register,
      onExpandedChange: setMotherExpanded,
      onInfoChange: (value: PersonInfoPublic) =>
        updateParentInfo("mother", value, motherCalcRef.current),
      onPassphraseChange: handleMotherPassphraseChange,
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
      transactionPreview,
      successResult,
      errorResult,
    },
    footer: {
      successResult,
      isSubmitting,
      personInfo,
      allConsentsChecked,
      transactionPreview,
      onTransactionPreviewDecision: decideTransactionPreview,
      onClose: handleClose,
      onContinueAdding: handleContinueAdding,
      onEndorse,
    },
  };
}

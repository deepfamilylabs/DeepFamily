import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import type { IdentitySaltMode } from "../../../../../shared/crypto/identityHash";
import { safeCanonicalizeFullName } from "../../../../../shared/crypto/identityCommitment";
import { useToast } from "../../../../../shared/ui";
import { useWallet } from "../../../../wallet";
import { useContractClient } from "../../../hooks/useContractClient";
import { useTreeMutations } from "../../../../tree";
import type { PersonHashCalculatorHandle } from "../../../../person";
import { useResponsiveModalMode } from "../../shared/useResponsiveModalMode";
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
import { useAddVersionSubmit } from "./useAddVersionSubmit";
import { useEncryptedMetadataBundle } from "./useEncryptedMetadataBundle";
import { usePersonCommitmentProof } from "./usePersonCommitmentProof";

interface UseAddVersionModalControllerArgs {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (result: any) => void;
  onEndorse?: (personHash: string, versionIndex: number) => void;
  initialPersonData?: Partial<PersonInfoPublic>;
}

function defaultConsents(): AddVersionConsents {
  return { hash: false, age: false, legal: false };
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
  const { isContractReady } = useContractClient();
  const toast = useToast();
  const { invalidateByTx } = useTreeMutations();
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
  const [personHasPassphrase, setPersonHasPassphrase] = useState(false);
  const [personIdentityMode, setPersonIdentityMode] = useState<IdentitySaltMode>("deterministic");
  const [personRecoverySaltHex, setPersonRecoverySaltHex] = useState("");
  const personCalcRef = useRef<PersonHashCalculatorHandle | null>(null);

  const [fatherInfo, setFatherInfo] = useState<PersonInfoPublic | null>(null);
  const [fatherHasPassphrase, setFatherHasPassphrase] = useState(false);
  const [fatherIdentityMode, setFatherIdentityMode] = useState<IdentitySaltMode>("deterministic");
  const [fatherRecoverySaltHex, setFatherRecoverySaltHex] = useState("");
  const fatherCalcRef = useRef<PersonHashCalculatorHandle | null>(null);

  const [motherInfo, setMotherInfo] = useState<PersonInfoPublic | null>(null);
  const [motherHasPassphrase, setMotherHasPassphrase] = useState(false);
  const [motherIdentityMode, setMotherIdentityMode] = useState<IdentitySaltMode>("deterministic");
  const [motherRecoverySaltHex, setMotherRecoverySaltHex] = useState("");
  const motherCalcRef = useRef<PersonHashCalculatorHandle | null>(null);

  const encryptionPasswordRef = useRef<HTMLInputElement | null>(null);
  const confirmEncryptionPasswordRef = useRef<HTMLInputElement | null>(null);

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
    setValue,
    watch,
    reset,
  } = useForm<AddVersionFormInput>({
    resolver: zodResolver(addVersionSchema),
    defaultValues: {
      fatherVersionIndex: "",
      motherVersionIndex: "",
      tag: "",
      metadataCID: "",
    },
  });

  const watchedValues = watch();
  const fatherStatus = getParentInfoStatus(fatherInfo, watchedValues.fatherVersionIndex);
  const motherStatus = getParentInfoStatus(motherInfo, watchedValues.motherVersionIndex);
  const allConsentsChecked = consents.hash && consents.age && consents.legal;
  const isTransactionSubmitting =
    addVersionStatus === "validating" || addVersionStatus === "confirming";
  const isSubmitting = isSubmittingState || isTransactionSubmitting;

  const resolveIdentitySaltSelections = useCallback(
    () =>
      identityMaterials.resolveIdentitySaltSelections({
        personMode: personIdentityMode,
        personCalc: personCalcRef.current,
        personRecoverySaltHex,
        setPersonRecoverySaltHex,
        personErrorMessage: t(
          "addVersion.randomModePassphraseRequired",
          "Enhanced identity mode requires a non-empty identity passphrase",
        ),
        fatherMode: fatherIdentityMode,
        fatherCalc: fatherCalcRef.current,
        fatherRecoverySaltHex,
        setFatherRecoverySaltHex,
        fatherErrorMessage: t(
          "addVersion.fatherRandomModePassphraseRequired",
          "Father enhanced mode requires a non-empty identity passphrase",
        ),
        motherMode: motherIdentityMode,
        motherCalc: motherCalcRef.current,
        motherRecoverySaltHex,
        setMotherRecoverySaltHex,
        motherErrorMessage: t(
          "addVersion.motherRandomModePassphraseRequired",
          "Mother enhanced mode requires a non-empty identity passphrase",
        ),
      }),
    [
      fatherIdentityMode,
      fatherRecoverySaltHex,
      identityMaterials,
      motherIdentityMode,
      motherRecoverySaltHex,
      personIdentityMode,
      personRecoverySaltHex,
      t,
    ],
  );

  const buildMetadataPayload = useCallback(
    (tagValue: string, processedData: any, identitySaltSelections: any) =>
      identityMaterials.buildMetadataPayload({
        tagValue,
        processedData,
        identitySaltSelections,
        personCalc: personCalcRef.current,
        fatherCalc: fatherCalcRef.current,
        motherCalc: motherCalcRef.current,
        personInfo,
        fatherInfo,
        motherInfo,
        personIdentityMode,
        fatherIdentityMode,
        motherIdentityMode,
      }),
    [
      fatherIdentityMode,
      fatherInfo,
      identityMaterials,
      motherIdentityMode,
      motherInfo,
      personIdentityMode,
      personInfo,
    ],
  );

  const setMetadataCid = useCallback(
    (cid: string) => setValue("metadataCID", cid, { shouldDirty: true, shouldValidate: true }),
    [setValue],
  );

  const encryptedMetadata = useEncryptedMetadataBundle({
    t,
    personHasPassphrase,
    personHasPassphraseRef: () => personCalcRef.current?.hasPassphrase() ?? false,
    getPersonPassphrase: () => personCalcRef.current?.getSecretInputs().passphrase || "",
    encryptionPasswordRef,
    confirmEncryptionPasswordRef,
    buildMetadataPayload,
    resolveIdentitySaltSelections,
    setMetadataCid,
  });

  const resetBusinessState = useCallback(
    (options?: { remountCalculators?: boolean }) => {
      reset();
      setPersonInfo(null);
      setPersonHasPassphrase(false);
      setPersonIdentityMode("deterministic");
      setPersonRecoverySaltHex("");
      setFatherInfo(null);
      setFatherHasPassphrase(false);
      setFatherIdentityMode("deterministic");
      setFatherRecoverySaltHex("");
      setMotherInfo(null);
      setMotherHasPassphrase(false);
      setMotherIdentityMode("deterministic");
      setMotherRecoverySaltHex("");
      setIsSubmitting(false);
      commitmentProof.reset();
      encryptedMetadata.reset();
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
    [commitmentProof, encryptedMetadata, reset, resetAddVersionFlow],
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
    allConsentsChecked,
    personCalcRef,
    resolveIdentitySaltSelections,
    resolveIdentityMaterial: identityMaterials.resolveIdentityMaterial,
    personIdentityMode,
    fatherCalcRef,
    fatherIdentityMode,
    motherCalcRef,
    motherIdentityMode,
    validateEncryptionPassword: encryptedMetadata.validateEncryptionPassword,
    resolveEncryptionPassword: encryptedMetadata.resolveEncryptionPassword,
    prepareEncryptedMetadata: encryptedMetadata.prepareEncryptedMetadata,
    generatePersonCommitmentProof: commitmentProof.generatePersonCommitmentProof,
    setProofGenerationStep: commitmentProof.setProofGenerationStep,
    runAddVersionOrThrow,
    setMetadataCid,
    toastShow: toast.show,
    invalidateByTx,
    onSuccess,
    setConsentError,
    setErrorResult,
    setSuccessResult,
    setIsSubmitting,
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
      personHasPassphrase,
      personIdentityMode,
      personRecoverySaltHex,
      initialPersonData,
      onPersonInfoChange: setPersonInfo,
      onPersonHasPassphraseChange: setPersonHasPassphrase,
      onPersonIdentityModeChange: setPersonIdentityMode,
      onPersonRecoverySaltHexChange: setPersonRecoverySaltHex,
    },
    fatherSection: {
      kind: "father" as ParentKind,
      formResetKey,
      expanded: fatherExpanded,
      status: fatherStatus,
      calcRef: fatherCalcRef,
      hasPassphrase: fatherHasPassphrase,
      identityMode: fatherIdentityMode,
      recoverySaltHex: fatherRecoverySaltHex,
      register,
      onExpandedChange: setFatherExpanded,
      onInfoChange: setFatherInfo,
      onHasPassphraseChange: setFatherHasPassphrase,
      onIdentityModeChange: setFatherIdentityMode,
      onRecoverySaltHexChange: setFatherRecoverySaltHex,
    },
    motherSection: {
      kind: "mother" as ParentKind,
      formResetKey,
      expanded: motherExpanded,
      status: motherStatus,
      calcRef: motherCalcRef,
      hasPassphrase: motherHasPassphrase,
      identityMode: motherIdentityMode,
      recoverySaltHex: motherRecoverySaltHex,
      register,
      onExpandedChange: setMotherExpanded,
      onInfoChange: setMotherInfo,
      onHasPassphraseChange: setMotherHasPassphrase,
      onIdentityModeChange: setMotherIdentityMode,
      onRecoverySaltHexChange: setMotherRecoverySaltHex,
    },
    metadataSection: {
      register,
      isSubmitting,
      personHasPassphrase,
      encryptionPasswordRef,
      confirmEncryptionPasswordRef,
      encryptionError: encryptedMetadata.encryptionError,
      usePersonPassphraseForEncryption: encryptedMetadata.usePersonPassphraseForEncryption,
      showEncryptionPassword: encryptedMetadata.showEncryptionPassword,
      showConfirmEncryptionPassword: encryptedMetadata.showConfirmEncryptionPassword,
      showManualEncryptionInputs: encryptedMetadata.showManualEncryptionInputs,
      onUsePersonPassphraseForEncryptionChange:
        encryptedMetadata.onUsePersonPassphraseForEncryptionChange,
      onEncryptionErrorClear: encryptedMetadata.onEncryptionErrorClear,
      onToggleEncryptionPassword: encryptedMetadata.onToggleEncryptionPassword,
      onToggleConfirmEncryptionPassword: encryptedMetadata.onToggleConfirmEncryptionPassword,
      onDownloadMetadata: () => encryptedMetadata.handleDownloadMetadata(watchedValues),
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

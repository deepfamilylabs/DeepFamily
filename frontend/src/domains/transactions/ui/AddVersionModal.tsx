import React, { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import {
  X,
  Users,
  ChevronDown,
  ChevronRight,
  UserPlus,
  Check,
  AlertTriangle,
  Shield,
  Download,
  Star,
  Eye,
  EyeOff,
  Lock,
} from "lucide-react";
import { ethers } from "ethers";
import { useWallet } from "../../wallet/context";
import { useToast } from "../../../shared/ui";
import { useContractClient } from "../hooks/useContractClient";
import { useAddVersionFlow } from "../flows";
import { useTreeMutations } from "../../tree/context";
import { sha256Hex, type MetadataRecoveryV2 } from "../../../lib/metadataCrypto";
import {
  PersonHashCalculator,
  type PersonHashCalculatorHandle,
} from "../../person/ui";
import { getFriendlyError, sanitizeErrorForLogging } from "../../../shared/lib/errors";
import { cryptoWorkerCall } from "../../../lib/cryptoWorkerClient";
import { zkWorkerCall } from "../../../lib/zkWorkerClient";
import { safeCanonicalizeFullName } from "../../../lib/identityCommitment";
import { formatGroth16ProofForContract } from "../../../lib/zk";
import type { PersonData } from "../../../lib/zk";
import {
  computeIdentityHashMaterial,
  generateRandomIdentitySaltHex,
  normalizeIdentitySaltHex,
  type IdentitySaltMode,
} from "../../../lib/identityHash";
import { normalizePassphraseForHash } from "../../../lib/passphraseStrength";

const addVersionSchema = z.object({
  // Parent version indexes: allow empty string input, transform to 0 for processing
  fatherVersionIndex: z
    .union([z.number().int().min(0), z.literal("")])
    .transform((val) => (val === "" ? 0 : val)),
  motherVersionIndex: z
    .union([z.number().int().min(0), z.literal("")])
    .transform((val) => (val === "" ? 0 : val)),
  tag: z.string().max(50, "Tag too long"),
  metadataCID: z.string().optional(),
});

// Input type (before transformation)
type AddVersionFormInput = {
  fatherVersionIndex: number | "";
  motherVersionIndex: number | "";
  tag: string;
  metadataCID?: string;
};

type AddVersionFormData = z.infer<typeof addVersionSchema>;

type EncryptedMetadataBundle = {
  json: string;
  cid: string;
  plainHash: string;
  passwordFingerprint: string;
};

type PersonInfoPublic = {
  fullName: string;
  gender: number;
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  isBirthBC: boolean;
};

type IdentityMaterial = {
  personData: PersonData;
  personHash: string;
  identityMode: IdentitySaltMode;
  identitySaltHex: string | null;
  recovery: MetadataRecoveryV2["identityKdf"] | null;
};

type IdentityResolutionOptions = {
  identityMode?: IdentitySaltMode;
  identitySaltHex?: string | null;
};

type IdentitySaltSelections = {
  personIdentitySaltHex: string | null;
  fatherIdentitySaltHex: string | null;
  motherIdentitySaltHex: string | null;
};

interface AddVersionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (result: any) => void;
  onEndorse?: (personHash: string, versionIndex: number) => void;
  // Optional: Pre-populated person data (for passing known data when navigating from other pages)
  initialPersonData?: {
    fullName?: string;
    gender?: number;
    birthYear?: number;
    birthMonth?: number;
    birthDay?: number;
    isBirthBC?: boolean;
  };
}

export default function AddVersionModal({
  isOpen,
  onClose,
  onSuccess,
  onEndorse,
  initialPersonData,
}: AddVersionModalProps) {
  const { t } = useTranslation();
  const { signer } = useWallet();
  const { isContractReady } = useContractClient();
  const toast = useToast();
  const { invalidateByTx } = useTreeMutations();
  const addVersionFlow = useAddVersionFlow();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [consents, setConsents] = useState({ hash: false, age: false, legal: false });
  const [consentError, setConsentError] = useState<string | null>(null);
  const [proofGenerationStep, setProofGenerationStep] = useState<string>("");
  const [encryptionError, setEncryptionError] = useState<string | null>(null);
  const [usePersonPassphraseForEncryption, setUsePersonPassphraseForEncryption] = useState(true);
  const [encryptedMetadata, setEncryptedMetadata] = useState<EncryptedMetadataBundle | null>(null);
  const [showEncryptionPassword, setShowEncryptionPassword] = useState(false);
  const [showConfirmEncryptionPassword, setShowConfirmEncryptionPassword] = useState(false);
  const [successResult, setSuccessResult] = useState<{
    hash: string;
    index: number;
    rewardAmount: number;
    transactionHash: string;
    blockNumber: number;
    events: {
      PersonHashZKVerified: any;
      PersonVersionAdded: any;
      TokenRewardDistributed: any;
    };
  } | null>(null);
  const [errorResult, setErrorResult] = useState<{
    type: string;
    message: string;
    details: string;
  } | null>(null);

  // Person hash and info from PersonHashCalculator
  const [personInfo, setPersonInfo] = useState<PersonInfoPublic | null>(null);
  const [personHasPassphrase, setPersonHasPassphrase] = useState(false);
  const [personIdentityMode, setPersonIdentityMode] = useState<IdentitySaltMode>("deterministic");
  const [personRecoverySaltHex, setPersonRecoverySaltHex] = useState("");
  const personCalcRef = useRef<PersonHashCalculatorHandle | null>(null);

  // Father and mother info from PersonHashCalculator components
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

  const [entered, setEntered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const startYRef = useRef<number | null>(null);

  // Parent info collapse states
  const [fatherExpanded, setFatherExpanded] = useState(false);
  const [motherExpanded, setMotherExpanded] = useState(false);

  // Key for forcing PersonHashCalculator remount on reset
  const [formResetKey, setFormResetKey] = useState(0);
  // Track history push/pop to close on mobile back like NodeDetailModal
  const pushedRef = useRef(false);
  const closedBySelfRef = useRef(false);
  const closedByPopRef = useRef(false);
  const historyMarkerRef = useRef<{ __dfModal: string; id: string } | null>(null);

  // Desktop/mobile detection
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(min-width: 640px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(min-width: 640px)");
    const onChange = (e: MediaQueryListEvent | MediaQueryList) =>
      setIsDesktop((e as MediaQueryListEvent).matches ?? (e as MediaQueryList).matches);
    try {
      mql.addEventListener("change", onChange as any);
    } catch {
      (mql as any).addListener(onChange);
    }
    onChange(mql as any);
    return () => {
      try {
        mql.removeEventListener("change", onChange as any);
      } catch {
        (mql as any).removeListener(onChange);
      }
    };
  }, []);

  // Enter animation for mobile bottom sheet
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setEntered(true));
    } else {
      setEntered(false);
    }
  }, [isOpen]);

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
      // Parent version indexes (empty string to show placeholder, will be converted to 0 if empty)
      fatherVersionIndex: "",
      motherVersionIndex: "",

      tag: "",
      metadataCID: "",
    },
  });

  // Watch form values for version indexes
  const watchedValues = watch();

  // Helper function to check if parent info has content
  const getParentInfoStatus = (parentType: "father" | "mother") => {
    const info = parentType === "father" ? fatherInfo : motherInfo;
    const versionIndex =
      parentType === "father" ? watchedValues.fatherVersionIndex : watchedValues.motherVersionIndex;

    const canonicalFullName = safeCanonicalizeFullName(info?.fullName || "");
    if (!info || !canonicalFullName) return "empty";
    if (typeof versionIndex === "number" && versionIndex > 0) return "complete";
    return "partial";
  };

  const fatherStatus = getParentInfoStatus("father");
  const motherStatus = getParentInfoStatus("mother");
  const allConsentsChecked = consents.hash && consents.age && consents.legal;
  const showManualEncryptionInputs = !usePersonPassphraseForEncryption || !personHasPassphrase;

  // Initialize states if existing data is provided (e.g., from another page)
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

  const resolveIdentityMaterial = async (
    calc: PersonHashCalculatorHandle | null,
    options?: IdentityResolutionOptions,
  ): Promise<IdentityMaterial | null> => {
    if (!calc) return null;
    const publicData = calc.getPublicFormData();
    const secretInputs = calc.getSecretInputs();
    const canonicalFullName = safeCanonicalizeFullName(publicData?.fullName || "");
    if (!publicData || !canonicalFullName) return null;

    const computed = await computeIdentityHashMaterial({
      fullName: canonicalFullName,
      passphrase: secretInputs?.passphrase || "",
      isBirthBC: publicData.isBirthBC,
      birthYear: publicData.birthYear,
      birthMonth: publicData.birthMonth,
      birthDay: publicData.birthDay,
      gender: publicData.gender,
      identityMode: options?.identityMode,
      identitySaltHex: options?.identitySaltHex,
    });

    return {
      personData: {
        fullName: computed.canonicalFullName,
        derivedSecretField: computed.derivedSecretField,
        birthYear: publicData.birthYear,
        birthMonth: publicData.birthMonth,
        birthDay: publicData.birthDay,
        isBirthBC: publicData.isBirthBC,
        gender: publicData.gender,
      },
      personHash: computed.personHash,
      identityMode: computed.identityMode,
      identitySaltHex: computed.identitySaltHex,
      recovery: computed.derivedSecretBundle
        ? {
            algorithm: computed.derivedSecretBundle.algorithm,
            kdfVersion: computed.derivedSecretBundle.kdfVersion,
            params: computed.derivedSecretBundle.params,
            saltHex: computed.derivedSecretBundle.saltHex,
          }
        : null,
    };
  };

  const resolveSelectedPersonIdentitySaltHex = (): string | null => {
    return resolveSelectedIdentitySaltHex({
      mode: personIdentityMode,
      calc: personCalcRef.current,
      recoverySaltHex: personRecoverySaltHex,
      setRecoverySaltHex: setPersonRecoverySaltHex,
      errorMessage: t(
        "addVersion.randomModePassphraseRequired",
        "Enhanced identity mode requires a non-empty identity passphrase",
      ),
    });
  };

  const resolveSelectedIdentitySaltHex = (input: {
    mode: IdentitySaltMode;
    calc: PersonHashCalculatorHandle | null;
    recoverySaltHex: string;
    setRecoverySaltHex: (value: string) => void;
    errorMessage: string;
  }): string | null => {
    if (input.mode !== "random") return null;
    const normalizedPassphrase = normalizePassphraseForHash(
      input.calc?.getSecretInputs().passphrase || "",
    );
    if (!normalizedPassphrase.length) {
      throw new Error(input.errorMessage);
    }
    if (input.recoverySaltHex.trim()) {
      return normalizeIdentitySaltHex(input.recoverySaltHex);
    }
    const generated = generateRandomIdentitySaltHex();
    input.setRecoverySaltHex(generated);
    return generated;
  };

  const hasNamedIdentityInput = (calc: PersonHashCalculatorHandle | null): boolean => {
    const canonicalFullName = safeCanonicalizeFullName(calc?.getPublicFormData()?.fullName || "");
    return Boolean(canonicalFullName);
  };

  const resolveIdentitySaltSelections = (): IdentitySaltSelections => ({
    personIdentitySaltHex: resolveSelectedPersonIdentitySaltHex(),
    fatherIdentitySaltHex: hasNamedIdentityInput(fatherCalcRef.current)
      ? resolveSelectedIdentitySaltHex({
          mode: fatherIdentityMode,
          calc: fatherCalcRef.current,
          recoverySaltHex: fatherRecoverySaltHex,
          setRecoverySaltHex: setFatherRecoverySaltHex,
          errorMessage: t(
            "addVersion.fatherRandomModePassphraseRequired",
            "Father enhanced mode requires a non-empty identity passphrase",
          ),
        })
      : null,
    motherIdentitySaltHex: hasNamedIdentityInput(motherCalcRef.current)
      ? resolveSelectedIdentitySaltHex({
          mode: motherIdentityMode,
          calc: motherCalcRef.current,
          recoverySaltHex: motherRecoverySaltHex,
          setRecoverySaltHex: setMotherRecoverySaltHex,
          errorMessage: t(
            "addVersion.motherRandomModePassphraseRequired",
            "Mother enhanced mode requires a non-empty identity passphrase",
          ),
        })
      : null,
  });


  /**
   * Extract and normalize person info, ensuring deterministic field order
   * Note: Passphrase is removed to avoid leaking sensitive data to metadata
   */
  const sanitizeInfo = (info: PersonInfoPublic | null) => {
    if (!info) return null;
    // Explicitly specify field order to ensure CID determinism
    return {
      fullName: info.fullName,
      gender: info.gender,
      birthYear: info.birthYear,
      birthMonth: info.birthMonth,
      birthDay: info.birthDay,
      isBirthBC: info.isBirthBC,
    };
  };

  /**
   * Build metadata payload, strictly following schema-defined field order
   * Field order must be consistent to ensure same data generates same CID
   */
  const buildMetadataPayload = async (
    tagValue: string,
    processedData: AddVersionFormData,
    options: IdentitySaltSelections,
  ) => {
    const baseEmpty = {
      fullName: "",
      gender: 0,
      birthYear: 0,
      birthMonth: 0,
      birthDay: 0,
      isBirthBC: false,
    };

    const personIdentity = await resolveIdentityMaterial(personCalcRef.current, {
      identityMode: personIdentityMode,
      identitySaltHex: options.personIdentitySaltHex,
    });
    const fatherIdentity = await resolveIdentityMaterial(fatherCalcRef.current, {
      identityMode: fatherIdentityMode,
      identitySaltHex: options.fatherIdentitySaltHex,
    });
    const motherIdentity = await resolveIdentityMaterial(motherCalcRef.current, {
      identityMode: motherIdentityMode,
      identitySaltHex: options.motherIdentitySaltHex,
    });

    const personData = sanitizeInfo(personInfo) ?? baseEmpty;
    const fatherData = sanitizeInfo(fatherInfo) ?? baseEmpty;
    const motherData = sanitizeInfo(motherInfo) ?? baseEmpty;

    // Strictly build according to deepfamily/person-version@2.0 schema field order
    return {
      schema: "deepfamily/person-version@2.0",
      identity: {
        mode: personIdentity?.identityMode || personIdentityMode,
      },
      tag: tagValue || "",
      person: {
        fullName: personData.fullName,
        gender: personData.gender,
        birthYear: personData.birthYear,
        birthMonth: personData.birthMonth,
        birthDay: personData.birthDay,
        isBirthBC: personData.isBirthBC,
        personHash: personIdentity?.personHash || ethers.ZeroHash,
      },
      parents: {
        father: {
          fullName: fatherData.fullName,
          gender: fatherData.gender,
          birthYear: fatherData.birthYear,
          birthMonth: fatherData.birthMonth,
          birthDay: fatherData.birthDay,
          isBirthBC: fatherData.isBirthBC,
          personHash: fatherIdentity?.personHash || ethers.ZeroHash,
          identityMode: fatherIdentity?.identityMode || fatherIdentityMode,
          versionIndex: processedData.fatherVersionIndex ?? 0,
        },
        mother: {
          fullName: motherData.fullName,
          gender: motherData.gender,
          birthYear: motherData.birthYear,
          birthMonth: motherData.birthMonth,
          birthDay: motherData.birthDay,
          isBirthBC: motherData.isBirthBC,
          personHash: motherIdentity?.personHash || ethers.ZeroHash,
          identityMode: motherIdentity?.identityMode || motherIdentityMode,
          versionIndex: processedData.motherVersionIndex ?? 0,
        },
      },
      recovery: personIdentity?.recovery
        ? {
            identityMode: personIdentity.identityMode,
            identityKdf: {
              algorithm: personIdentity.recovery.algorithm,
              kdfVersion: personIdentity.recovery.kdfVersion,
              params: personIdentity.recovery.params,
              saltHex: personIdentity.recovery.saltHex,
            },
          }
        : null,
    };
  };

  const handleClose = () => {
    closedBySelfRef.current = true;
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
    setProofGenerationStep("");
    if (encryptionPasswordRef.current) encryptionPasswordRef.current.value = "";
    if (confirmEncryptionPasswordRef.current) confirmEncryptionPasswordRef.current.value = "";
    setEncryptionError(null);
    setEncryptedMetadata(null);
    setSuccessResult(null);
    setErrorResult(null);
    setFatherExpanded(false);
    setMotherExpanded(false);
    setConsents({ hash: false, age: false, legal: false });
    setConsentError(null);
    setDragging(false);
    setDragOffset(0);
    onClose();
  };

  // Ensure state resets when modal is closed externally
  useEffect(() => {
    if (isOpen) return;
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
    setProofGenerationStep("");
    if (encryptionPasswordRef.current) encryptionPasswordRef.current.value = "";
    if (confirmEncryptionPasswordRef.current) confirmEncryptionPasswordRef.current.value = "";
    setEncryptionError(null);
    setEncryptedMetadata(null);
    setSuccessResult(null);
    setErrorResult(null);
    setFatherExpanded(false);
    setMotherExpanded(false);
    setConsents({ hash: false, age: false, legal: false });
    setConsentError(null);
    setDragging(false);
    setDragOffset(0);
  }, [isOpen, reset]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // Push history state on open so mobile back closes the modal first
  useEffect(() => {
    if (!isOpen) return;
    const marker = { __dfModal: "AddVersionModal", id: Math.random().toString(36).slice(2) };
    historyMarkerRef.current = marker;
    try {
      window.history.pushState(marker, "");
      pushedRef.current = true;
    } catch {}
    const onPop = () => {
      const st: any = window.history.state;
      if (!st || st.id !== historyMarkerRef.current?.id) {
        closedByPopRef.current = true;
        onClose();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (pushedRef.current && closedBySelfRef.current && !closedByPopRef.current) {
        try {
          window.history.back();
        } catch {}
      }
      pushedRef.current = false;
      closedBySelfRef.current = false;
      closedByPopRef.current = false;
      historyMarkerRef.current = null;
    };
  }, [isOpen, onClose]);

  const handleContinueAdding = () => {
    // Reset form and states for new addition
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
    setProofGenerationStep("");
    if (encryptionPasswordRef.current) encryptionPasswordRef.current.value = "";
    if (confirmEncryptionPasswordRef.current) confirmEncryptionPasswordRef.current.value = "";
    setEncryptionError(null);
    setEncryptedMetadata(null);
    setSuccessResult(null);
    setErrorResult(null);
    setFatherExpanded(false);
    setMotherExpanded(false);
    setConsents({ hash: false, age: false, legal: false });
    setConsentError(null);
    // Increment key to force remount of PersonHashCalculator components
    setFormResetKey((prev) => prev + 1);
    // Keep modal open for continued use
  };
  const toggleConsent = (key: keyof typeof consents) => {
    setConsents((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (consentError && next.hash && next.age && next.legal) setConsentError(null);
      return next;
    });
  };

  const validateEncryptionPassword = () => {
    const canUseIdentityPassphrase =
      usePersonPassphraseForEncryption && (personCalcRef.current?.hasPassphrase() ?? false);
    if (canUseIdentityPassphrase) {
      setEncryptionError(null);
      return true;
    }
    const encryptionPassword = (encryptionPasswordRef.current?.value ?? "").trim();
    const confirmEncryptionPassword = confirmEncryptionPasswordRef.current?.value ?? "";
    if (!encryptionPassword) {
      setEncryptionError(
        t("addVersion.encryptionPasswordRequired", "Please enter encryption password"),
      );
      return false;
    }
    if (encryptionPassword.length < 8) {
      setEncryptionError(
        t("addVersion.encryptionPasswordWeak", "Password must be at least 8 characters"),
      );
      return false;
    }
    if (encryptionPassword !== confirmEncryptionPassword) {
      setEncryptionError(t("addVersion.encryptionPasswordMismatch", "Passwords do not match"));
      return false;
    }
    setEncryptionError(null);
    return true;
  };

  const resolveEncryptionPassword = () => {
    const canUseIdentityPassphrase =
      usePersonPassphraseForEncryption && (personCalcRef.current?.hasPassphrase() ?? false);
    if (canUseIdentityPassphrase) {
      return personCalcRef.current?.getSecretInputs().passphrase || "";
    }
    return (encryptionPasswordRef.current?.value ?? "").trim();
  };

  const prepareEncryptedMetadata = async (
    tagValue: string,
    processedData: AddVersionFormData,
    password: string,
    identitySaltSelections: IdentitySaltSelections,
  ) => {
    const metadataPayload = await buildMetadataPayload(tagValue, processedData, identitySaltSelections);
    const metadataJson = JSON.stringify(metadataPayload);
    const bundlePlainHash = sha256Hex(metadataJson);

    const { passwordFingerprint } = await cryptoWorkerCall("passwordFingerprint", { password });
    if (
      encryptedMetadata &&
      encryptedMetadata.plainHash === bundlePlainHash &&
      encryptedMetadata.passwordFingerprint === passwordFingerprint
    ) {
      return encryptedMetadata;
    }

    const bundleResult = await cryptoWorkerCall("encryptMetadataBundleV2", {
      plaintextJson: metadataJson,
      password,
    });
    const bundle = {
      json: bundleResult.encryptedJson,
      cid: bundleResult.cid,
      plainHash: bundleResult.plainHash,
      passwordFingerprint: bundleResult.passwordFingerprint,
    };
    setEncryptedMetadata(bundle);
    return bundle;
  };

  const handleDownloadMetadata = async () => {
    try {
      if (!validateEncryptionPassword()) return;
      const processedData = addVersionSchema.parse(watchedValues);
      const identitySaltSelections = resolveIdentitySaltSelections();
      const { json, cid } = await prepareEncryptedMetadata(
        processedData.tag,
        processedData,
        resolveEncryptionPassword(),
        identitySaltSelections,
      );
      setValue("metadataCID", cid, { shouldDirty: true, shouldValidate: true });

      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `metadata-encrypted-${cid || Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Download metadata failed", sanitizeErrorForLogging(err));
      alert(
        t("addVersion.encryptionFailed", "Failed to encrypt or export metadata, please try again"),
      );
    }
  };

  const onSubmit = async (data: AddVersionFormInput) => {
    if (!allConsentsChecked) {
      setConsentError(
        t("addVersion.consentMissing", "Please confirm all required checkboxes before submitting"),
      );
      return;
    } else {
      setConsentError(null);
    }

    if (!signer || !isContractReady) {
      alert(t("wallet.notConnected", "Please connect your wallet"));
      return;
    }

    // Transform the input data to the final form
    const processedData = addVersionSchema.parse(data);

    const personCalc = personCalcRef.current;
    const personPublic = personCalc?.getPublicFormData();
    const canonicalPersonFullName = safeCanonicalizeFullName(personPublic?.fullName || "");
    if (!personCalc || !personPublic || !canonicalPersonFullName) {
      alert(t("addVersion.personInfoRequired", "Please fill in person information"));
      return;
    }
    if (!validateEncryptionPassword()) {
      return;
    }
    // Clear old prompt information
    setSuccessResult(null);
    setErrorResult(null);

    setIsSubmitting(true);
    setProofGenerationStep(t("addVersion.preparingData", "Preparing data..."));

    try {
      // Get submitter address
      const submitterAddress = await signer.getAddress();

      setProofGenerationStep(
        t(
          "addVersion.generatingProof",
          "Generating zero-knowledge proof... (this may take 30-60 seconds)",
        ),
      );

      const identitySaltSelections = resolveIdentitySaltSelections();
      const personIdentity = await resolveIdentityMaterial(personCalcRef.current, {
        identityMode: personIdentityMode,
        identitySaltHex: identitySaltSelections.personIdentitySaltHex,
      });
      if (!personIdentity) {
        throw new Error(t("addVersion.personInfoRequired", "Please fill in person information"));
      }
      const fatherIdentity = await resolveIdentityMaterial(fatherCalcRef.current, {
        identityMode: fatherIdentityMode,
        identitySaltHex: identitySaltSelections.fatherIdentitySaltHex,
      });
      const motherIdentity = await resolveIdentityMaterial(motherCalcRef.current, {
        identityMode: motherIdentityMode,
        identitySaltHex: identitySaltSelections.motherIdentitySaltHex,
      });
      const fatherData: PersonData | null = fatherIdentity?.personData ?? null;
      const motherData: PersonData | null = motherIdentity?.personData ?? null;

      const { proof, publicSignals } = await zkWorkerCall(
        "generatePersonCommitmentProof",
        {
          person: personIdentity.personData,
          father: fatherData,
          mother: motherData,
          submitterAddress,
        },
        { timeoutMs: 240_000 },
      );

      setProofGenerationStep(t("addVersion.verifyingProof", "Verifying proof..."));

      const { ok: isValid } = await zkWorkerCall(
        "verifyPersonCommitmentProof",
        { proof, publicSignals },
        { timeoutMs: 120_000 },
      );
      if (!isValid) {
        throw new Error(
          t("addVersion.proofVerificationFailed", "Generated proof verification failed"),
        );
      }

      setProofGenerationStep(t("addVersion.generatingMetadataCID", "Generating metadata CID..."));

      const { json: encryptedJson, cid: metadataCID } = await prepareEncryptedMetadata(
        processedData.tag,
        processedData,
        resolveEncryptionPassword(),
        identitySaltSelections,
      );

      processedData.metadataCID = metadataCID;
      setValue("metadataCID", metadataCID, { shouldDirty: true, shouldValidate: true });

      setProofGenerationStep(t("addVersion.submittingToBlockchain", "Submitting to blockchain..."));

      const proofEnvelope = formatGroth16ProofForContract(proof);
      const publicSignalsStruct = {
        identityCommitment: BigInt(publicSignals[0]),
        fatherIdentityCommitment: BigInt(publicSignals[1]),
        motherIdentityCommitment: BigInt(publicSignals[2]),
        submitter: BigInt(publicSignals[3]),
        schemaVersion: Number(publicSignals[4]),
        cryptoSuiteVersion: Number(publicSignals[5]),
        hashAlgoId: Number(publicSignals[6]),
      };

      const result = await addVersionFlow.runOrThrow({
        proof: proofEnvelope,
        publicSignals: publicSignalsStruct,
        fatherVersionIndex: processedData.fatherVersionIndex,
        motherVersionIndex: processedData.motherVersionIndex,
        tag: processedData.tag,
        metadataCID: processedData.metadataCID || "",
      });

      toast.show(t("contract.addVersionSuccess", "Person version added successfully"));
      setSuccessResult({
        hash: result.hash,
        index: result.index,
        rewardAmount: result.rewardAmount,
        transactionHash: result.transactionHash,
        blockNumber: result.blockNumber,
        events: result.events,
      });
      setProofGenerationStep("");
      invalidateByTx({
        events: { PersonVersionAdded: result.events?.PersonVersionAdded || null },
        hints: { personHash: result.hash, versionIndex: result.index },
      });
      onSuccess?.(result);
    } catch (error: any) {
      console.error("Add version failed:", sanitizeErrorForLogging(error));

      // Set error result for display in UI
      const friendly = getFriendlyError(error, t);
      toast.show(
        t("contract.addVersionFailed", "Failed to add person version") + ": " + friendly.message,
      );
      setErrorResult({
        type: friendly.type || "UNKNOWN_ERROR",
        message: friendly.message,
        details: friendly.details,
      });
      setProofGenerationStep("");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper component for status indicator
  const StatusIndicator = ({ status }: { status: "empty" | "partial" | "complete" }) => {
    const config = {
      empty: { icon: UserPlus, color: "text-gray-400", bg: "bg-gray-100 dark:bg-gray-700" },
      partial: {
        icon: AlertTriangle,
        color: "text-amber-500",
        bg: "bg-amber-100 dark:bg-amber-900/30",
      },
      complete: { icon: Check, color: "text-green-500", bg: "bg-green-100 dark:bg-green-900/30" },
    };

    const { icon: Icon, color, bg } = config[status];

    return (
      <div className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${bg}`}>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
    );
  };

  // Helper component for data rows in success result
  const DataRow = ({
    label,
    value,
    colorClass,
    isPlainText = false,
  }: {
    label: string;
    value: string;
    colorClass: "blue" | "green" | "yellow";
    isPlainText?: boolean;
  }) => {
    const colorConfig = {
      blue: {
        labelColor: "text-blue-800 dark:text-blue-200",
        valueBg: "bg-blue-100 dark:bg-blue-800",
        valueColor: "text-blue-900 dark:text-blue-100",
      },
      green: {
        labelColor: "text-green-800 dark:text-green-200",
        valueBg: "bg-green-100 dark:bg-green-800",
        valueColor: "text-green-900 dark:text-green-100",
      },
      yellow: {
        labelColor: "text-yellow-800 dark:text-yellow-200",
        valueBg: "bg-yellow-100 dark:bg-yellow-800",
        valueColor: "text-yellow-900 dark:text-yellow-100",
      },
    };

    const config = colorConfig[colorClass];

    return (
      <div className="flex flex-col gap-1">
        <span className={`text-xs font-medium ${config.labelColor}`}>{label}</span>
        {isPlainText ? (
          <span className={`text-xs ${config.valueColor}`}>{value}</span>
        ) : (
          <code
            className={`${config.valueBg} ${config.valueColor} px-2 py-1 rounded font-mono text-xs break-all`}
          >
            {value}
          </code>
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[1200] overflow-x-hidden touch-pan-y"
      onClick={isDesktop ? undefined : handleClose}
    >
      {/* Modal Container (responsive: bottom sheet on mobile, dialog on desktop) */}
      <div className="flex items-end sm:items-center justify-center h-full w-full p-2 sm:p-4">
        <div
          className={`relative flex flex-col w-full max-w-4xl h-[95vh] sm:h-auto sm:max-h-[95vh] bg-white dark:bg-gray-950 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-800 overflow-hidden transform transition-transform duration-300 ease-out ${entered ? "translate-y-0" : "translate-y-full sm:translate-y-0"} will-change-transform`}
          onClick={(e) => e.stopPropagation()}
          style={{
            transform: dragging ? `translateY(${dragOffset}px)` : undefined,
            transitionDuration: dragging ? "0ms" : undefined,
          }}
        >
          {/* Header */}
          <div
            className="sticky top-0 bg-white/80 dark:bg-gray-950/80 p-6 border-b border-gray-100 dark:border-gray-800 z-20 backdrop-blur-xl supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-gray-950/60 relative touch-none cursor-grab active:cursor-grabbing select-none"
            onPointerDown={(e) => {
              (e.currentTarget as any).setPointerCapture?.(e.pointerId);
              startYRef.current = e.clientY;
              setDragging(true);
            }}
            onPointerMove={(e) => {
              if (!dragging || startYRef.current == null) return;
              const dy = Math.max(0, e.clientY - startYRef.current);
              setDragOffset(dy);
            }}
            onPointerUp={() => {
              if (!dragging) return;
              const shouldClose = dragOffset > 120;
              setDragging(false);
              setDragOffset(0);
              if (shouldClose) handleClose();
            }}
            onPointerCancel={() => {
              setDragging(false);
              setDragOffset(0);
            }}
            onTouchStart={(e) => {
              startYRef.current = e.touches[0].clientY;
              setDragging(true);
            }}
            onTouchMove={(e) => {
              if (!dragging || startYRef.current == null) return;
              const dy = Math.max(0, e.touches[0].clientY - startYRef.current);
              setDragOffset(dy);
            }}
            onTouchEnd={() => {
              if (!dragging) return;
              const shouldClose = dragOffset > 120;
              setDragging(false);
              setDragOffset(0);
              if (shouldClose) handleClose();
            }}
          >
            {/* Drag handle (mobile only) */}
            <div className="sm:hidden absolute top-3 left-1/2 -translate-x-1/2 h-1 w-12 rounded-full bg-gray-200 dark:bg-gray-800" />

            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-400 to-red-600 flex items-center justify-center shadow-lg shadow-orange-500/20 flex-shrink-0">
                  <UserPlus className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50 mb-0.5">
                    {t("addVersion.title", "Add Version")}
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                    {t("addVersion.personInfoHint", "Secure zero-knowledge proof generation")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleClose();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors flex-shrink-0 group"
                aria-label={t("common.close", "Close")}
              >
                <X className="w-5 h-5 text-gray-400 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300 transition-colors" />
              </button>
            </div>
          </div>

          {/* Form Content */}
          <div className="flex-1 overflow-y-auto overscroll-contain overflow-x-hidden min-h-0 touch-pan-y">
            <form
              id="add-version-form"
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void handleSubmit(onSubmit)(event);
              }}
              className="min-h-full flex flex-col"
            >
              <div className="flex-1 p-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex gap-3 rounded-2xl border border-amber-100 bg-amber-50/50 p-4 text-amber-900 dark:border-amber-900/30 dark:bg-amber-900/10 dark:text-amber-100">
                    <AlertTriangle className="w-5 h-5 shrink-0 text-amber-500" />
                    <p className="text-xs font-medium leading-relaxed opacity-90">
                      {t(
                        "mintNFT.legalTruthfulNotice",
                        "Submit only lawful, truthful information you are authorized to disclose publicly; do not include private data outside the intended public scope.",
                      )}
                    </p>
                  </div>
                  <div className="flex gap-3 rounded-2xl border border-red-100 bg-red-50/50 p-4 text-red-900 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-100">
                    <AlertTriangle className="w-5 h-5 shrink-0 text-red-500" />
                    <p className="text-xs font-medium leading-relaxed opacity-90">
                      {t(
                        "addVersion.ageRequirement",
                        "The person being added must be 18 years or older. Do not submit minors' identities.",
                      )}
                    </p>
                  </div>
                </div>

                {/* Person Being Added - Using PersonHashCalculator */}
                <div className="space-y-4">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50">
                    {t("addVersion.personInfo", "Person Information")}
                  </h3>

                  <div className="flex items-start gap-3 p-3 bg-green-50/50 dark:bg-green-900/10 rounded-2xl border border-green-100 dark:border-green-900/30">
                    <Shield className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-green-700 dark:text-green-300 leading-relaxed">
                      {t(
                        "addVersion.personInfoPrivacy",
                        "Person information is only used locally to generate zero-knowledge proofs. Plain text will not be stored on-chain, only the hash value is permanently recorded.",
                      )}
                    </p>
                  </div>

                  <PersonHashCalculator
                    ref={personCalcRef}
                    key={`person-${formResetKey}`}
                    showTitle={false}
                    collapsible={false}
                    identityMode={personIdentityMode}
                    identitySaltHex={personIdentityMode === "random" ? personRecoverySaltHex : undefined}
                    initialValues={initialPersonData}
                    onPublicFormChange={(formData) => {
                      setPersonInfo({
                        fullName: formData.fullName,
                        gender: formData.gender,
                        birthYear: formData.birthYear,
                        birthMonth: formData.birthMonth,
                        birthDay: formData.birthDay,
                        isBirthBC: formData.isBirthBC,
                      });
                      setPersonHasPassphrase(formData.hasPassphrase);
                      if (!formData.hasPassphrase) {
                        setPersonIdentityMode("deterministic");
                      }
                    }}
                  />

                  {personHasPassphrase && (
                    <div className="rounded-2xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/30 dark:bg-blue-900/10 p-4 space-y-4">
                    <div className="space-y-1">
                      <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                        {t("addVersion.identityMode", "Identity Recovery Mode")}
                      </h4>
                      <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                        {t(
                          "addVersion.identityModeHint",
                          "Standard mode recomputes the identity salt from public fields. Enhanced mode uses a recovery salt you must keep to continue this identity on other devices.",
                        )}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setPersonIdentityMode("deterministic")}
                        className={`rounded-xl border px-4 py-3 text-left transition-all ${
                          personIdentityMode === "deterministic"
                            ? "border-blue-500 bg-white dark:bg-gray-800 shadow-sm"
                            : "border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40"
                        }`}
                      >
                        <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                          {t("addVersion.identityModeStandard", "Standard")}
                        </div>
                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                          {t(
                            "addVersion.identityModeStandardHint",
                            "Deterministic identity salt. No recovery salt input required.",
                          )}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPersonIdentityMode("random");
                          setPersonRecoverySaltHex((current) => current || generateRandomIdentitySaltHex());
                        }}
                        className={`rounded-xl border px-4 py-3 text-left transition-all ${
                          personIdentityMode === "random"
                            ? "border-blue-500 bg-white dark:bg-gray-800 shadow-sm"
                            : "border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40"
                        }`}
                      >
                        <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                          {t("addVersion.identityModeEnhanced", "Enhanced")}
                        </div>
                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                          {t(
                            "addVersion.identityModeEnhancedHint",
                            "Random identity salt plus recovery. Reuse the same salt when minting or adding later versions.",
                          )}
                        </div>
                      </button>
                    </div>

                    {personIdentityMode === "random" && (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
                            {t("addVersion.identityRecoverySalt", "Recovery Salt")}
                          </label>
                          <button
                            type="button"
                            onClick={() => setPersonRecoverySaltHex(generateRandomIdentitySaltHex())}
                            className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            {t("addVersion.regenerateRecoverySalt", "Generate New Salt")}
                          </button>
                        </div>
                        <input
                          type="text"
                          value={personRecoverySaltHex}
                          onChange={(e) => setPersonRecoverySaltHex(e.target.value)}
                          className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 text-xs font-mono text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                          placeholder={t(
                            "addVersion.identityRecoverySaltPlaceholder",
                            "Paste saved recovery salt or keep the generated value",
                          )}
                        />
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                          {t(
                            "addVersion.identityRecoverySaltNotice",
                            "If this is a brand-new identity, keep the generated salt. If this identity was created earlier in enhanced mode, replace it with the saved recovery salt before submitting.",
                          )}
                        </p>
                      </div>
                    )}

                    </div>
                  )}
                </div>
                {/* Father Information - Using PersonHashCalculator */}
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setFatherExpanded(!fatherExpanded)}
                    className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all duration-200 group ${
                      fatherExpanded
                        ? "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800"
                        : "bg-white dark:bg-gray-950 border-gray-100 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-sm"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center ${fatherStatus === "complete" ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400" : "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"}`}
                      >
                        <Users className="w-4 h-4" />
                      </div>
                      <div className="flex flex-col items-start gap-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
                            {t("addVersion.fatherInfo", "Father Information")}
                          </h3>
                        </div>
                        {fatherStatus !== "empty" && (
                          <span
                            className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                              fatherStatus === "complete"
                                ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                            }`}
                          >
                            {fatherStatus === "partial"
                              ? t("addVersion.partial", "Partial")
                              : t("addVersion.complete", "Complete")}
                          </span>
                        )}
                      </div>
                    </div>
                    {fatherExpanded ? (
                      <ChevronDown className="w-5 h-5 text-gray-400" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors" />
                    )}
                  </button>

                  <div
                    className={`p-1 space-y-4 transition-all duration-300 ease-in-out ${fatherExpanded ? "opacity-100 max-h-[2000px]" : "opacity-0 max-h-0 overflow-hidden"}`}
                  >
                    <div className="bg-gray-50 dark:bg-gray-900/50 rounded-2xl border border-gray-200 dark:border-gray-800 p-4 space-y-4">
                      {/* Parent Info Notice */}
                      <div className="p-3 bg-blue-50/50 dark:bg-blue-900/10 rounded-xl border border-blue-100/50 dark:border-blue-900/30">
                        <div className="flex items-start gap-2">
                          <Shield className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed opacity-90">
                            {t(
                              "addVersion.parentInfoNotice",
                              "Providing parent info locally generates zero-knowledge proofs for family linking (only hash values go on-chain) and earns DEEP token rewards. Parent info must match their actual versions exactly (incl. passphrase) to establish connection.",
                            )}
                          </p>
                        </div>
                      </div>

                      <PersonHashCalculator
                        ref={fatherCalcRef}
                        key={`father-${formResetKey}`}
                        showTitle={false}
                        collapsible={false}
                        className="border-0 shadow-none bg-transparent"
                        identityMode={fatherIdentityMode}
                        identitySaltHex={
                          fatherIdentityMode === "random" ? fatherRecoverySaltHex : undefined
                        }
                        initialValues={{
                          fullName: "",
                          gender: 1, // Default to male
                          birthYear: 0,
                          birthMonth: 0,
                          birthDay: 0,
                          isBirthBC: false,
                        }}
                        onPublicFormChange={(formData) => {
                          setFatherInfo({
                            fullName: formData.fullName,
                            gender: formData.gender,
                            birthYear: formData.birthYear,
                            birthMonth: formData.birthMonth,
                            birthDay: formData.birthDay,
                            isBirthBC: formData.isBirthBC,
                          });
                          setFatherHasPassphrase(formData.hasPassphrase);
                          if (!formData.hasPassphrase) {
                            setFatherIdentityMode("deterministic");
                          }
                        }}
                      />

                      {fatherHasPassphrase && (
                        <div className="rounded-xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/30 dark:bg-blue-900/10 p-4 space-y-4">
                        <div className="space-y-1">
                          <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                            {t("addVersion.parentIdentityMode", "Parent Identity Recovery Mode")}
                          </h4>
                          <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                            {t(
                              "addVersion.parentIdentityModeHint",
                              "Use enhanced mode only when the parent identity was originally created with a saved recovery salt.",
                            )}
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => setFatherIdentityMode("deterministic")}
                            className={`rounded-xl border px-4 py-3 text-left transition-all ${
                              fatherIdentityMode === "deterministic"
                                ? "border-blue-500 bg-white dark:bg-gray-800 shadow-sm"
                                : "border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40"
                            }`}
                          >
                            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                              {t("addVersion.identityModeStandard", "Standard")}
                            </div>
                            <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                              {t(
                                "addVersion.identityModeStandardHint",
                                "Deterministic identity salt. No recovery salt input required.",
                              )}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setFatherIdentityMode("random");
                              setFatherRecoverySaltHex(
                                (current) => current || generateRandomIdentitySaltHex(),
                              );
                            }}
                            className={`rounded-xl border px-4 py-3 text-left transition-all ${
                              fatherIdentityMode === "random"
                                ? "border-blue-500 bg-white dark:bg-gray-800 shadow-sm"
                                : "border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40"
                            }`}
                          >
                            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                              {t("addVersion.identityModeEnhanced", "Enhanced")}
                            </div>
                            <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                              {t(
                                "addVersion.identityModeEnhancedHint",
                                "Random identity salt plus recovery. Reuse the same salt when minting or adding later versions.",
                              )}
                            </div>
                          </button>
                        </div>
                        {fatherIdentityMode === "random" && (
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <label className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
                                {t("addVersion.parentRecoverySalt", "Parent Recovery Salt")}
                              </label>
                              <button
                                type="button"
                                onClick={() => setFatherRecoverySaltHex(generateRandomIdentitySaltHex())}
                                className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                              >
                                {t("addVersion.regenerateRecoverySalt", "Generate New Salt")}
                              </button>
                            </div>
                            <input
                              type="text"
                              value={fatherRecoverySaltHex}
                              onChange={(e) => setFatherRecoverySaltHex(e.target.value)}
                              className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 text-xs font-mono text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                              placeholder={t(
                                "addVersion.parentRecoverySaltPlaceholder",
                                "Paste the father's saved recovery salt",
                              )}
                            />
                          </div>
                        )}
                        </div>
                      )}

                      <div className="w-full sm:w-auto">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          {t("addVersion.versionIndex", "Version Index")}
                          <span className="ml-2 text-xs text-gray-400 font-normal">
                            ({t("addVersion.versionIndexHint")})
                          </span>
                        </label>
                        <input
                          type="number"
                          min="0"
                          {...register("fatherVersionIndex", {
                            setValueAs: (v) => (v === "" ? "" : parseInt(v, 10)),
                          })}
                          className="w-full sm:w-32 h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-orange-500 dark:focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 outline-none transition-all"
                          placeholder="0"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Mother Information - Using PersonHashCalculator */}
                <div className="space-y-2 !mt-2">
                  <button
                    type="button"
                    onClick={() => setMotherExpanded(!motherExpanded)}
                    className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all duration-200 group ${
                      motherExpanded
                        ? "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800"
                        : "bg-white dark:bg-gray-950 border-gray-100 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-sm"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center ${motherStatus === "complete" ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400" : "bg-pink-50 text-pink-600 dark:bg-pink-900/20 dark:text-pink-400"}`}
                      >
                        <Users className="w-4 h-4" />
                      </div>
                      <div className="flex flex-col items-start gap-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
                            {t("addVersion.motherInfo", "Mother Information")}
                          </h3>
                        </div>
                        {motherStatus !== "empty" && (
                          <span
                            className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                              motherStatus === "complete"
                                ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                            }`}
                          >
                            {motherStatus === "partial"
                              ? t("addVersion.partial", "Partial")
                              : t("addVersion.complete", "Complete")}
                          </span>
                        )}
                      </div>
                    </div>
                    {motherExpanded ? (
                      <ChevronDown className="w-5 h-5 text-gray-400" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors" />
                    )}
                  </button>

                  <div
                    className={`p-1 space-y-4 transition-all duration-300 ease-in-out ${motherExpanded ? "opacity-100 max-h-[2000px]" : "opacity-0 max-h-0 overflow-hidden"}`}
                  >
                    <div className="bg-gray-50 dark:bg-gray-900/50 rounded-2xl border border-gray-200 dark:border-gray-800 p-4 space-y-4">
                      {/* Parent Info Notice */}
                      <div className="p-3 bg-blue-50/50 dark:bg-blue-900/10 rounded-xl border border-blue-100/50 dark:border-blue-900/30">
                        <div className="flex items-start gap-2">
                          <Shield className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed opacity-90">
                            {t(
                              "addVersion.parentInfoNotice",
                              "Providing parent info locally generates zero-knowledge proofs for family linking (only hash values go on-chain) and earns DEEP token rewards. Parent info must match their actual versions exactly (incl. passphrase) to establish connection.",
                            )}
                          </p>
                        </div>
                      </div>

                      <PersonHashCalculator
                        ref={motherCalcRef}
                        key={`mother-${formResetKey}`}
                        showTitle={false}
                        collapsible={false}
                        className="border-0 shadow-none bg-transparent"
                        identityMode={motherIdentityMode}
                        identitySaltHex={
                          motherIdentityMode === "random" ? motherRecoverySaltHex : undefined
                        }
                        initialValues={{
                          fullName: "",
                          gender: 2, // Default to female
                          birthYear: 0,
                          birthMonth: 0,
                          birthDay: 0,
                          isBirthBC: false,
                        }}
                        onPublicFormChange={(formData) => {
                          setMotherInfo({
                            fullName: formData.fullName,
                            gender: formData.gender,
                            birthYear: formData.birthYear,
                            birthMonth: formData.birthMonth,
                            birthDay: formData.birthDay,
                            isBirthBC: formData.isBirthBC,
                          });
                          setMotherHasPassphrase(formData.hasPassphrase);
                          if (!formData.hasPassphrase) {
                            setMotherIdentityMode("deterministic");
                          }
                        }}
                      />

                      {motherHasPassphrase && (
                        <div className="rounded-xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/30 dark:bg-blue-900/10 p-4 space-y-4">
                        <div className="space-y-1">
                          <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                            {t("addVersion.parentIdentityMode", "Parent Identity Recovery Mode")}
                          </h4>
                          <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                            {t(
                              "addVersion.parentIdentityModeHint",
                              "Use enhanced mode only when the parent identity was originally created with a saved recovery salt.",
                            )}
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => setMotherIdentityMode("deterministic")}
                            className={`rounded-xl border px-4 py-3 text-left transition-all ${
                              motherIdentityMode === "deterministic"
                                ? "border-blue-500 bg-white dark:bg-gray-800 shadow-sm"
                                : "border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40"
                            }`}
                          >
                            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                              {t("addVersion.identityModeStandard", "Standard")}
                            </div>
                            <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                              {t(
                                "addVersion.identityModeStandardHint",
                                "Deterministic identity salt. No recovery salt input required.",
                              )}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMotherIdentityMode("random");
                              setMotherRecoverySaltHex(
                                (current) => current || generateRandomIdentitySaltHex(),
                              );
                            }}
                            className={`rounded-xl border px-4 py-3 text-left transition-all ${
                              motherIdentityMode === "random"
                                ? "border-blue-500 bg-white dark:bg-gray-800 shadow-sm"
                                : "border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40"
                            }`}
                          >
                            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                              {t("addVersion.identityModeEnhanced", "Enhanced")}
                            </div>
                            <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                              {t(
                                "addVersion.identityModeEnhancedHint",
                                "Random identity salt plus recovery. Reuse the same salt when minting or adding later versions.",
                              )}
                            </div>
                          </button>
                        </div>
                        {motherIdentityMode === "random" && (
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <label className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
                                {t("addVersion.parentRecoverySalt", "Parent Recovery Salt")}
                              </label>
                              <button
                                type="button"
                                onClick={() => setMotherRecoverySaltHex(generateRandomIdentitySaltHex())}
                                className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                              >
                                {t("addVersion.regenerateRecoverySalt", "Generate New Salt")}
                              </button>
                            </div>
                            <input
                              type="text"
                              value={motherRecoverySaltHex}
                              onChange={(e) => setMotherRecoverySaltHex(e.target.value)}
                              className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 text-xs font-mono text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                              placeholder={t(
                                "addVersion.parentRecoverySaltPlaceholderMother",
                                "Paste the mother's saved recovery salt",
                              )}
                            />
                          </div>
                        )}
                        </div>
                      )}

                      <div className="w-full sm:w-auto">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          {t("addVersion.versionIndex", "Version Index")}
                          <span className="ml-2 text-xs text-gray-400 font-normal">
                            ({t("addVersion.versionIndexHint")})
                          </span>
                        </label>
                        <input
                          type="number"
                          min="0"
                          {...register("motherVersionIndex", {
                            setValueAs: (v) => (v === "" ? "" : parseInt(v, 10)),
                          })}
                          className="w-full sm:w-32 h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-orange-500 dark:focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 outline-none transition-all"
                          placeholder="0"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Metadata */}
                <div className="space-y-4 pt-4 border-t border-gray-100 dark:border-gray-800 !mt-2">
                  <div className="space-y-2">
                    <label className="block text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">
                      {t("addVersion.tag", "Tag")}
                    </label>
                    <input
                      {...register("tag")}
                      className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-orange-500 dark:focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 outline-none transition-all"
                      placeholder={t(
                        "addVersion.tagPlaceholder",
                        "Optional tag (e.g. 'Standard Version')",
                      )}
                    />
                  </div>

                  <div className="rounded-2xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/30 dark:bg-blue-900/10 p-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                          <Lock className="w-4 h-4" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-900 dark:text-gray-100">
                            {t("addVersion.encryptionPassword", "Metadata Encryption")}
                            <span className="text-red-500 ml-1">*</span>
                          </label>
                        </div>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer group">
                        <div className="relative flex items-center">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={usePersonPassphraseForEncryption}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setUsePersonPassphraseForEncryption(checked);
                              if (checked) {
                                if (encryptionPasswordRef.current)
                                  encryptionPasswordRef.current.value = "";
                                if (confirmEncryptionPasswordRef.current)
                                  confirmEncryptionPasswordRef.current.value = "";
                              }
                              if (checked && encryptionError) setEncryptionError(null);
                            }}
                          />
                          <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                        </div>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors">
                          {t("addVersion.usePassphraseForEncryption", "Use identity passphrase")}
                        </span>
                      </label>
                    </div>

                    {showManualEncryptionInputs ? (
                      <div className="space-y-3 pt-2 animate-fadeIn">
                        {usePersonPassphraseForEncryption && !personHasPassphrase && (
                          <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded-lg border border-amber-100 dark:border-amber-900/30">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>
                              {t(
                                "addVersion.passphraseMissingForEncryption",
                                "Identity passphrase is empty. Please enter an encryption password or set a passphrase above.",
                              )}
                            </span>
                          </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="relative group">
                            <input
                              type={showEncryptionPassword ? "text" : "password"}
                              ref={encryptionPasswordRef}
                              onChange={() => {
                                if (encryptionError) setEncryptionError(null);
                              }}
                              className="h-11 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 pr-10 text-sm placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all"
                              placeholder={t(
                                "addVersion.encryptionPasswordPlaceholder",
                                "Password (min 8 chars)",
                              )}
                              inputMode="text"
                              autoCapitalize="none"
                              autoComplete="new-password"
                              autoCorrect="off"
                              spellCheck={false}
                            />
                            <button
                              type="button"
                              onClick={() => setShowEncryptionPassword((v) => !v)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors p-1"
                            >
                              {showEncryptionPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          </div>
                          <div className="relative group">
                            <input
                              type={showConfirmEncryptionPassword ? "text" : "password"}
                              ref={confirmEncryptionPasswordRef}
                              onChange={() => {
                                if (encryptionError) setEncryptionError(null);
                              }}
                              className="h-11 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 pr-10 text-sm placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all"
                              placeholder={t(
                                "addVersion.encryptionPasswordConfirm",
                                "Confirm password",
                              )}
                              inputMode="text"
                              autoCapitalize="none"
                              autoComplete="new-password"
                              autoCorrect="off"
                              spellCheck={false}
                            />
                            <button
                              type="button"
                              onClick={() => setShowConfirmEncryptionPassword((v) => !v)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors p-1"
                            >
                              {showConfirmEncryptionPassword ? (
                                <EyeOff size={16} />
                              ) : (
                                <Eye size={16} />
                              )}
                            </button>
                          </div>
                        </div>
                        {encryptionError && (
                          <p className="text-xs text-red-500 dark:text-red-400 font-medium flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            {encryptionError}
                          </p>
                        )}
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug pl-1">
                          {t(
                            "addVersion.encryptionNotice",
                            "Metadata is encrypted locally before generating CID. Please keep your password safe, as it cannot be recovered if lost.",
                          )}
                        </p>
                      </div>
                    ) : (
                      <div className="pl-1 pt-1">
                        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                          {t(
                            "addVersion.encryptionNotice",
                            "Metadata is encrypted locally before generating CID. Please keep your password safe, as it cannot be recovered if lost.",
                          )}
                        </p>
                        {encryptionError && (
                          <p className="text-xs text-red-500 dark:text-red-400 font-medium mt-1">
                            {encryptionError}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
                      {t("addVersion.metadataCID", "Metadata CID")}
                      <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        {t("addVersion.autoGenerated", "Auto-generated")}
                      </span>
                    </label>
                    <div className="flex gap-2">
                      <input
                        {...register("metadataCID")}
                        readOnly
                        className="flex-1 h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-4 text-sm text-gray-500 dark:text-gray-400 font-mono text-xs placeholder-gray-400 outline-none cursor-not-allowed select-all"
                        placeholder={t(
                          "addVersion.metadataCIDPlaceholder",
                          "Generated from encrypted metadata...",
                        )}
                      />
                      <button
                        type="button"
                        onClick={handleDownloadMetadata}
                        disabled={isSubmitting}
                        className="px-4 h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 shadow-sm"
                        title={t("addVersion.downloadMetadata", "Download metadata JSON")}
                      >
                        <Download className="w-4 h-4" />
                        <span className="hidden sm:inline">
                          {t("addVersion.download", "Download")}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Informed Consent for Add Version */}
                {!successResult && (
                  <div className="p-5 rounded-2xl border border-red-200/50 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/10 backdrop-blur-sm !mt-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                        <Shield className="w-4 h-4 text-red-600 dark:text-red-400" />
                      </div>
                      <div className="space-y-3 w-full pt-1">
                        <div className="flex flex-col gap-0.5">
                          <p className="text-sm font-bold text-gray-900 dark:text-red-100">
                            {t("addVersion.consentTitle", "Informed consent (required)")}
                          </p>
                        </div>

                        <div className="space-y-1.5 pt-1">
                          {(
                            [
                              {
                                key: "hash",
                                label: t(
                                  "addVersion.consentHash",
                                  "I understand the plaintext stays off-chain, but its hash will be permanently public on-chain and cannot be removed.",
                                ),
                              },
                              {
                                key: "age",
                                label: t(
                                  "addVersion.consentAge",
                                  "I confirm the person is 18 years or older.",
                                ),
                              },
                              {
                                key: "legal",
                                label: t(
                                  "addVersion.consentLegal",
                                  "I confirm the data is lawful, truthful, and authorized for disclosure; no extra private content is included.",
                                ),
                              },
                            ] as const
                          ).map((item) => (
                            <label
                              key={item.key}
                              className="flex items-start gap-2.5 cursor-pointer group select-none"
                            >
                              <div className="relative flex items-center justify-center shrink-0 w-4 h-4 mt-[1px]">
                                <input
                                  type="checkbox"
                                  checked={consents[item.key]}
                                  onChange={() => toggleConsent(item.key)}
                                  className="peer h-4 w-4 rounded-[4px] border-[1.5px] border-red-300 dark:border-red-700 bg-white dark:bg-gray-800 text-red-600 focus:ring-0 focus:border-red-500 checked:bg-red-600 checked:border-red-600 transition-all cursor-pointer appearance-none"
                                />
                                <Check className="w-3 h-3 text-white absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transform scale-75 opacity-0 peer-checked:opacity-100 peer-checked:scale-75 transition-all duration-200 pointer-events-none stroke-[4]" />
                              </div>
                              <span className="text-xs text-gray-800 dark:text-red-50 leading-relaxed font-medium group-hover:text-red-700 dark:group-hover:text-white transition-colors">
                                {item.label}
                              </span>
                            </label>
                          ))}
                        </div>
                        {consentError && (
                          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-100 dark:bg-red-900/40 border border-red-200 dark:border-red-800 animate-fadeIn">
                            <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                            <p className="text-xs text-red-700 dark:text-red-300 font-bold">
                              {consentError}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Progress Indicator */}
                {isSubmitting && proofGenerationStep && !successResult && !errorResult && (
                  <div className="p-5 bg-orange-50/50 dark:bg-orange-900/10 rounded-2xl border border-orange-100 dark:border-orange-900/20 animate-fadeIn">
                    <div className="flex items-center gap-4">
                      <div className="relative w-10 h-10 flex-shrink-0">
                        <div className="absolute inset-0 rounded-full border-4 border-orange-200 dark:border-orange-800 opacity-30"></div>
                        <div className="absolute inset-0 rounded-full border-4 border-orange-500 border-t-transparent animate-spin"></div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-gray-900 dark:text-white mb-1">
                          {t("addVersion.processing", "Processing...")}
                        </p>
                        <p className="text-xs font-medium text-orange-700 dark:text-orange-300">
                          {proofGenerationStep}
                        </p>
                      </div>
                    </div>
                    {proofGenerationStep.includes("30-60 seconds") && (
                      <div className="mt-4 pt-4 border-t border-orange-200/50 dark:border-orange-800/50 text-xs font-medium text-orange-600 dark:text-orange-400">
                        {t(
                          "addVersion.proofGenerationNote",
                          "ZK proof generation requires complex cryptographic calculations. Please wait...",
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Success Message */}
                {successResult && (
                  <div className="space-y-4">
                    {/* Success Header */}
                    <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-lg border border-green-200 dark:border-green-700">
                      <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                        <Check className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-green-900 dark:text-green-100">
                          {t("addVersion.successTitle", "Version Added Successfully")}
                        </h3>
                        <p className="text-sm text-green-700 dark:text-green-300">
                          {t(
                            "addVersion.successDesc",
                            "The person version has been added to the blockchain",
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Compact Event Cards */}
                    <div className="space-y-3">
                      {/* ZK Proof Verified */}
                      {successResult.events.PersonHashZKVerified && (
                        <details className="group bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700 overflow-hidden">
                          <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                              <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                                {t("addVersion.zkProofVerified", "ZK Proof Verified")}
                              </span>
                            </div>
                            <ChevronRight className="w-4 h-4 text-blue-600 group-open:rotate-90 transition-transform" />
                          </summary>
                          <div className="px-3 pb-3 space-y-2">
                            <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
                              {t(
                                "addVersion.zkProofVerifiedDesc",
                                "Zero-knowledge proof was successfully verified on-chain",
                              )}
                            </p>
                            <DataRow
                              label={t("addVersion.hashPrefix", "Hash")}
                              value={successResult.events.PersonHashZKVerified.personHash}
                              colorClass="blue"
                            />
                            <DataRow
                              label={t("addVersion.prover", "Prover")}
                              value={successResult.events.PersonHashZKVerified.prover}
                              colorClass="blue"
                            />
                          </div>
                        </details>
                      )}

                      {/* Version Added */}
                      {successResult.events.PersonVersionAdded && (
                        <details
                          className="group bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-700 overflow-hidden"
                          open
                        >
                          <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                              <span className="text-sm font-medium text-green-900 dark:text-green-100">
                                {t("addVersion.versionAdded", "Person Version Added")}
                              </span>
                            </div>
                            <ChevronRight className="w-4 h-4 text-green-600 group-open:rotate-90 transition-transform" />
                          </summary>
                          <div className="px-3 pb-3 space-y-2">
                            <p className="text-xs text-green-700 dark:text-green-300 mb-2">
                              {t(
                                "addVersion.versionAddedDesc",
                                "Person version was successfully added to the family tree",
                              )}
                            </p>
                            <DataRow
                              label={t("addVersion.hashPrefix", "Hash")}
                              value={successResult.events.PersonVersionAdded.personHash}
                              colorClass="green"
                            />
                            <DataRow
                              label={t("addVersion.versionIndex", "Version Index")}
                              value={successResult.events.PersonVersionAdded.versionIndex.toString()}
                              colorClass="green"
                            />
                            <DataRow
                              label={t("addVersion.addedBy", "Added By")}
                              value={successResult.events.PersonVersionAdded.addedBy}
                              colorClass="green"
                            />
                            <DataRow
                              label={t("addVersion.timestamp", "Timestamp")}
                              value={new Date(
                                successResult.events.PersonVersionAdded.timestamp * 1000,
                              ).toLocaleString()}
                              colorClass="green"
                              isPlainText
                            />

                            {/* Father Info */}
                            {successResult.events.PersonVersionAdded.fatherHash &&
                              successResult.events.PersonVersionAdded.fatherHash !==
                                ethers.ZeroHash && (
                                <>
                                  <DataRow
                                    label={t("addVersion.fatherHash", "Father Hash")}
                                    value={successResult.events.PersonVersionAdded.fatherHash}
                                    colorClass="green"
                                  />
                                  <DataRow
                                    label={t("addVersion.fatherVersionIndex", "Father Version")}
                                    value={successResult.events.PersonVersionAdded.fatherVersionIndex.toString()}
                                    colorClass="green"
                                  />
                                </>
                              )}

                            {/* Mother Info */}
                            {successResult.events.PersonVersionAdded.motherHash &&
                              successResult.events.PersonVersionAdded.motherHash !==
                                ethers.ZeroHash && (
                                <>
                                  <DataRow
                                    label={t("addVersion.motherHash", "Mother Hash")}
                                    value={successResult.events.PersonVersionAdded.motherHash}
                                    colorClass="green"
                                  />
                                  <DataRow
                                    label={t("addVersion.motherVersionIndex", "Mother Version")}
                                    value={successResult.events.PersonVersionAdded.motherVersionIndex.toString()}
                                    colorClass="green"
                                  />
                                </>
                              )}

                            {/* Tag */}
                            {successResult.events.PersonVersionAdded.tag && (
                              <DataRow
                                label={t("addVersion.tag", "Tag")}
                                value={`"${successResult.events.PersonVersionAdded.tag}"`}
                                colorClass="green"
                                isPlainText
                              />
                            )}
                          </div>
                        </details>
                      )}

                      {/* Token Reward */}
                      {successResult.events.TokenRewardDistributed ? (
                        <details className="group bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-700 overflow-hidden">
                          <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-yellow-100 dark:hover:bg-yellow-900/30 transition-colors">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 bg-yellow-600 rounded-full"></div>
                              <span className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
                                {t("addVersion.tokenReward", "Token Reward Distributed")}
                              </span>
                              <span className="ml-2 text-xs font-semibold text-yellow-700 dark:text-yellow-300 bg-yellow-100 dark:bg-yellow-800 px-2 py-0.5 rounded-full">
                                {(
                                  Number(successResult.events.TokenRewardDistributed.reward) /
                                  Math.pow(10, 18)
                                ).toLocaleString()}{" "}
                                DEEP
                              </span>
                            </div>
                            <ChevronRight className="w-4 h-4 text-yellow-600 group-open:rotate-90 transition-transform" />
                          </summary>
                          <div className="px-3 pb-3 space-y-2">
                            <p className="text-xs text-yellow-700 dark:text-yellow-300 mb-2">
                              {t(
                                "addVersion.familyComplete",
                                "Parent hash commitments submitted - token reward earned",
                              )}
                            </p>
                            <DataRow
                              label={t("addVersion.miner", "Miner")}
                              value={successResult.events.TokenRewardDistributed.miner}
                              colorClass="yellow"
                            />
                            <DataRow
                              label={t("addVersion.hashPrefix", "Hash")}
                              value={successResult.events.TokenRewardDistributed.personHash}
                              colorClass="yellow"
                            />
                            <DataRow
                              label={t("addVersion.versionIndex", "Version Index")}
                              value={successResult.events.TokenRewardDistributed.versionIndex.toString()}
                              colorClass="yellow"
                            />
                            <DataRow
                              label={t("addVersion.rewardAmount", "Reward Amount")}
                              value={`${(Number(successResult.events.TokenRewardDistributed.reward) / Math.pow(10, 18)).toLocaleString()} DEEP`}
                              colorClass="yellow"
                              isPlainText
                            />
                          </div>
                        </details>
                      ) : (
                        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                {t("addVersion.noTokenReward", "No Token Reward")}
                              </p>
                              <p className="text-xs text-gray-600 dark:text-gray-400">
                                {t(
                                  "addVersion.tokenRewardCondition",
                                  "Token rewards are only distributed when both parents already exist in the system",
                                )}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Error Message */}
                {errorResult && (
                  <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-700">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                        <AlertTriangle className="w-5 h-5 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-semibold text-red-900 dark:text-red-100 mb-2">
                          {t("addVersion.failed", "Transaction Failed")}
                        </p>
                        <div className="space-y-2">
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-red-800 dark:text-red-200">
                              {t("addVersion.errorType", "Error Type")}
                            </span>
                            <code className="bg-red-100 dark:bg-red-800 text-red-900 dark:text-red-100 px-2 py-1 rounded font-mono text-xs">
                              {errorResult.type}
                            </code>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-red-800 dark:text-red-200">
                              {t("addVersion.errorMessage", "Message")}
                            </span>
                            <p className="bg-red-100 dark:bg-red-800 text-red-900 dark:text-red-100 px-2 py-1 rounded text-xs">
                              {errorResult.message}
                            </p>
                          </div>
                          {errorResult.details !== errorResult.message && (
                            <div className="flex flex-col gap-1">
                              <span className="text-xs font-medium text-red-800 dark:text-red-200">
                                {t("addVersion.errorDetails", "Details")}
                              </span>
                              <p className="bg-red-100 dark:bg-red-800 text-red-900 dark:text-red-100 px-2 py-1 rounded text-xs">
                                {errorResult.details}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Submit Buttons */}
              <div className="flex flex-col-reverse sm:flex-row gap-4 p-6 bg-white dark:bg-gray-950 border-t border-gray-100 dark:border-gray-800 pb-[calc(2rem+env(safe-area-inset-bottom))]">
                {successResult ? (
                  // Success state: Show Close, Continue Adding and Go to Endorse buttons
                  <>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="flex-1 px-5 py-3.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all font-bold text-sm shadow-sm hover:shadow-md active:scale-95"
                    >
                      {t("common.close", "Close")}
                    </button>
                    <button
                      type="button"
                      onClick={handleContinueAdding}
                      className="flex-1 px-5 py-3.5 border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 rounded-xl hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-all font-bold text-sm shadow-sm hover:shadow-md active:scale-95 flex items-center justify-center gap-2.5"
                    >
                      <UserPlus className="w-4 h-4 text-orange-600 dark:text-orange-400 opacity-60" />
                      {t("addVersion.continueAdding", "Continue Adding")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const endorsedHash =
                          successResult.events.PersonVersionAdded?.personHash || successResult.hash;
                        const endorsedIndex =
                          successResult.events.PersonVersionAdded?.versionIndex ??
                          successResult.index;
                        const hasTarget =
                          !!endorsedHash &&
                          Number.isFinite(Number(endorsedIndex)) &&
                          Number(endorsedIndex) > 0;
                        if (onEndorse && hasTarget) {
                          // Let the parent component handle closing this modal and opening the endorse modal
                          onEndorse(String(endorsedHash), Number(endorsedIndex));
                        }
                      }}
                      className="flex-1 px-5 py-3.5 bg-gradient-to-r from-orange-500 to-red-600 text-white rounded-xl shadow-lg shadow-orange-500/30 hover:shadow-orange-500/40 hover:-translate-y-0.5 active:translate-y-0 transition-all font-bold text-sm flex items-center justify-center gap-2.5"
                    >
                      <Star className="w-4 h-4 fill-white/20" />
                      {t("addVersion.goToEndorse", "Endorse Now")}
                    </button>
                  </>
                ) : (
                  // Normal state: Show Cancel and Submit buttons
                  <>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="flex-1 px-6 py-4 rounded-full border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900 transition-all font-bold text-sm"
                    >
                      {t("common.cancel", "Cancel")}
                    </button>
                    <button
                      type="submit"
                      disabled={
                        isSubmitting ||
                        !safeCanonicalizeFullName(personInfo?.fullName || "").length ||
                        !allConsentsChecked
                      }
                      className="flex-[1.5] px-6 py-4 bg-gradient-to-r from-orange-400 to-red-600 hover:from-orange-500 hover:to-red-700 text-white shadow-lg shadow-orange-500/20 hover:shadow-xl hover:shadow-orange-500/30 rounded-full disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all hover:scale-[1.02] active:scale-95 text-sm font-bold flex items-center justify-center gap-2"
                    >
                      {isSubmitting ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>{t("addVersion.processing", "Processing...")}</span>
                        </>
                      ) : (
                        <>
                          <span>{t("addVersion.submit", "Add Version")}</span>
                          <ChevronRight className="w-4 h-4 opacity-80" />
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

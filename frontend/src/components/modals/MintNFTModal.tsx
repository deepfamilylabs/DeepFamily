import React, { useState, useEffect, useRef, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import {
  X,
  AlertCircle,
  Image,
  AlertTriangle,
  ChevronDown,
  Check,
  ChevronRight,
  Shield,
  Lock,
  Calendar,
  FileText,
  Link as LinkIcon,
} from "lucide-react";
import { useContract } from "../../hooks/useContract";
import { useWallet } from "../../context/WalletContext";
import { ethers } from "ethers";
import { useSearchParams } from "react-router-dom";
import PersonHashCalculator from "../PersonHashCalculator";
import type { PersonHashCalculatorHandle } from "../PersonHashCalculator";
import { getFriendlyError, sanitizeErrorForLogging } from "../../lib/errors";
import { useTreeData } from "../../context/TreeDataContext";
import {
  formatGroth16ProofForContract,
  computeDisclosureBinding,
  type PersonData,
} from "../../lib/zk";
import { zkWorkerCall } from "../../lib/zkWorkerClient";
import { safeCanonicalizeFullName } from "../../lib/identityCommitment";
import {
  computeIdentityHashMaterial,
  normalizeIdentitySaltHex,
  type IdentitySaltMode,
} from "../../lib/identityHash";
import { normalizePassphraseForHash } from "../../lib/passphraseStrength";
import { makeNodeId, type NodeData } from "../../types/graph";

// Simple themed select component (from PersonHashCalculator)
const ThemedSelect: React.FC<{
  value: number;
  onChange: (v: number) => void;
  options: { value: number; label: string }[];
  className?: string;
}> = ({ value, onChange, options, className = "" }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const current = options.find((o) => o.value === value)?.label ?? "";

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full h-10 px-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-left text-xs text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-500/30 dark:focus:ring-orange-400/30 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition flex items-center justify-between"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{current}</span>
        <ChevronDown size={16} className="text-gray-500 dark:text-gray-400" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg overflow-hidden">
          <ul role="listbox" className="max-h-60 overflow-auto">
            {options.map((o) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`px-3 py-2 text-xs cursor-pointer select-none transition-colors ${
                  o.value === value
                    ? "bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300"
                    : "text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}
              >
                {o.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// Helper: accept http/https URLs or ipfs:// URIs (or empty)
const isValidTokenUri = (v: string) => {
  if (v === "") return true;
  if (v.startsWith("ipfs://")) return v.length > "ipfs://".length;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

const createMintNFTSchema = (t: (key: string) => string) =>
  z
    .object({
      // PersonSupplementInfo
      birthPlace: z.string().max(256, t("mintNFT.validation.birthPlaceTooLong")),
      isDeathBC: z.boolean(),
      deathYear: z.union([z.number().int().min(0).max(9999), z.string()]).transform((val) => {
        if (val === "" || val === undefined) return 0;
        return typeof val === "string" ? (val === "" ? 0 : parseInt(val, 10)) : val;
      }),
      deathMonth: z.union([z.number().int().min(0).max(12), z.string()]).transform((val) => {
        if (val === "" || val === undefined) return 0;
        return typeof val === "string" ? (val === "" ? 0 : parseInt(val, 10)) : val;
      }),
      deathDay: z.union([z.number().int().min(0).max(31), z.string()]).transform((val) => {
        if (val === "" || val === undefined) return 0;
        return typeof val === "string" ? (val === "" ? 0 : parseInt(val, 10)) : val;
      }),
      deathPlace: z.string().max(256, t("mintNFT.validation.deathPlaceTooLong")),
      story: z.string().max(256, t("mintNFT.validation.storyTooLong")),

      // NFT Metadata
      tokenURI: z
        .string()
        .max(256, t("mintNFT.validation.tokenURITooLong"))
        .optional()
        .or(z.literal(""))
        .refine((v) => isValidTokenUri(v ?? ""), t("mintNFT.validation.invalidTokenURI")),
    })
    .refine(
      (data) => {
        // If AD (Anno Domini), the year must not exceed the current year
        if (!data.isDeathBC && data.deathYear > new Date().getFullYear()) {
          return false;
        }
        return true;
      },
      {
        message: t("mintNFT.validation.yearExceedsCurrent"),
        path: ["deathYear"],
      },
    );

type MintNFTForm = z.infer<ReturnType<typeof createMintNFTSchema>>;

interface MintNFTModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (tokenId: number) => void;
  onGoEndorse?: (personHash: string, versionIndex: number) => void;
  // Initial data - only used when opening, modal internal state is fully self-contained
  initialPersonHash?: string;
  initialVersionIndex?: number;
}

export default function MintNFTModal({
  isOpen,
  onClose,
  onSuccess,
  onGoEndorse,
  initialPersonHash,
  initialVersionIndex,
}: MintNFTModalProps) {
  const { t } = useTranslation();
  const { address } = useWallet();
  const { mintPersonVersionNFT, getVersionDetails, contract } = useContract();
  const { setNodesData, invalidateByTx } = useTreeData();

  // Create schema with translations
  const mintNFTSchema = useMemo(() => createMintNFTSchema(t), [t]);
  const [searchParams] = useSearchParams();

  // ===== Internal state - fully self-contained, follows modal lifecycle =====
  const [personHash, setPersonHash] = useState<string>("");
  const [versionIndex, setVersionIndex] = useState<number>(1);

  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEndorsed, setIsEndorsed] = useState(false);
  const [isAlreadyMinted, setIsAlreadyMinted] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [hasMissingParents, setHasMissingParents] = useState<{
    father: boolean;
    mother: boolean;
  } | null>(null);
  const [entered, setEntered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const startYRef = useRef<number | null>(null);
  const [showEndorseConfirm, setShowEndorseConfirm] = useState(false);

  // Result state
  const [successResult, setSuccessResult] = useState<{
    tokenId: number;
    personHash: string;
    versionIndex: number;
    tokenURI: string;
    transactionHash: string;
    blockNumber: number;
    events: { PersonNFTMinted: any };
  } | null>(null);
  const [errorResult, setErrorResult] = useState<{
    type: string;
    message: string;
    details: string;
  } | null>(null);

  // Form state
  const [consents, setConsents] = useState({ public: false, age: false, legal: false });
  const [consentError, setConsentError] = useState<string | null>(null);
  const [contractError, setContractError] = useState<any>(null);
  const [proofGenerationStep, setProofGenerationStep] = useState<string>("");

  const didPatchCacheRef = useRef(false);
  useEffect(() => {
    if (!isOpen) return;
    didPatchCacheRef.current = false;
  }, [isOpen]);

  // Person basic info from PersonHashCalculator
  const [personInfo, setPersonInfo] = useState<{
    fullName: string;
    gender: number;
    birthYear: number;
    birthMonth: number;
    birthDay: number;
    isBirthBC: boolean;
  } | null>(null);
  const [personHasPassphrase, setPersonHasPassphrase] = useState(false);
  const [personIdentityMode, setPersonIdentityMode] = useState<IdentitySaltMode>("deterministic");
  const [personRecoverySaltHex, setPersonRecoverySaltHex] = useState("");
  const personCalcRef = useRef<PersonHashCalculatorHandle | null>(null);

  // 计算属性
  const isBytes32 = (v: string | undefined | null) => !!v && /^0x[0-9a-fA-F]{64}$/.test(v.trim());
  const targetPersonHash = personHash?.trim() || "";
  const targetVersionIndex = versionIndex;
  const isPersonHashFormatValid = isBytes32(targetPersonHash);

  // Determine validity - always show input mode
  const hasValidTarget = Boolean(
    targetPersonHash &&
    isPersonHashFormatValid &&
    targetVersionIndex !== undefined &&
    targetVersionIndex > 0,
  );
  const canEdit = true;
  const allConsentsChecked = consents.public && consents.age && consents.legal;
  const hasPersonInfo = Boolean(personInfo?.fullName?.trim());
  const hasTargetInputs = hasValidTarget;
  const hashInputInvalid = Boolean(targetPersonHash && !isPersonHashFormatValid);

  const resolveSelectedPersonIdentitySaltHex = (): string | null => {
    if (personIdentityMode !== "random") return null;
    const normalizedPassphrase = normalizePassphraseForHash(
      personCalcRef.current?.getSecretInputs().passphrase || "",
    );
    if (!normalizedPassphrase.length) {
      throw new Error(
        t(
          "mintNFT.randomModePassphraseRequired",
          "Enhanced identity mode requires a non-empty identity passphrase",
        ),
      );
    }
    if (personRecoverySaltHex.trim()) {
      return normalizeIdentitySaltHex(personRecoverySaltHex);
    }
    throw new Error(
      t(
        "mintNFT.recoverySaltRequired",
        "Enhanced identity mode requires the saved recovery salt for this identity",
      ),
    );
  };

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

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    watch,
  } = useForm({
    resolver: zodResolver(mintNFTSchema),
    defaultValues: {
      birthPlace: "",
      isDeathBC: false,
      deathYear: "" as string | number,
      deathMonth: "" as string | number,
      deathDay: "" as string | number,
      deathPlace: "",
      story: "",
      tokenURI: "",
    },
  });

  // ===== Core: Modal open/close state management =====
  useEffect(() => {
    if (isOpen) {
      // On open: initialize state
      setPersonHash(initialPersonHash || "");
      setVersionIndex(initialVersionIndex || 1);
      setPersonHasPassphrase(false);
      setPersonIdentityMode("deterministic");
      setPersonRecoverySaltHex("");
      // Animation
      requestAnimationFrame(() => setEntered(true));
    } else {
      // On close: reset all state
      setEntered(false);
      reset();
      setPersonHash("");
      setVersionIndex(1);
      setPersonInfo(null);
      setPersonHasPassphrase(false);
      setPersonIdentityMode("deterministic");
      setPersonRecoverySaltHex("");
      setIsSubmitting(false);
      setIsEndorsed(false);
      setIsAlreadyMinted(false);
      setIsCheckingStatus(false);
      setHasMissingParents(null);
      setSuccessResult(null);
      setErrorResult(null);
      setContractError(null);
      setConsents({ public: false, age: false, legal: false });
      setConsentError(null);
      setProofGenerationStep("");
      setShowEndorseConfirm(false);
      setDragging(false);
      setDragOffset(0);
    }
  }, [isOpen, initialPersonHash, initialVersionIndex, reset]);

  // Check endorsement and NFT minting status
  useEffect(() => {
    const checkStatus = async () => {
      if (!address || !getVersionDetails || !targetPersonHash || !targetVersionIndex || !contract)
        return;

      setIsCheckingStatus(true);

      try {
        const details = await getVersionDetails(targetPersonHash!, targetVersionIndex!);

        // Endorsement: check user's endorsed version index for this person
        const endorsedIdx = await contract.endorsedVersionIndex(targetPersonHash!, address);
        setIsEndorsed(Number(endorsedIdx) === Number(targetVersionIndex));

        // Minted: tokenId > 0 in getVersionDetails
        const tokenId = Number(details?.tokenId ?? 0);
        setIsAlreadyMinted(tokenId > 0);

        // Check for missing parent hashes
        const fatherMissing =
          !details?.version?.fatherHash || details.version.fatherHash === ethers.ZeroHash;
        const motherMissing =
          !details?.version?.motherHash || details.version.motherHash === ethers.ZeroHash;

        if (fatherMissing || motherMissing) {
          setHasMissingParents({ father: fatherMissing, mother: motherMissing });
        } else {
          setHasMissingParents(null);
        }
      } catch (error) {
        console.error("Failed to check status:", sanitizeErrorForLogging(error));
        setIsEndorsed(false);
        setIsAlreadyMinted(false);
        setHasMissingParents(null);
      } finally {
        setIsCheckingStatus(false);
      }
    };

    if (isOpen && hasValidTarget) {
      checkStatus();
    }
  }, [
    isOpen,
    address,
    targetPersonHash,
    targetVersionIndex,
    getVersionDetails,
    contract,
    hasValidTarget,
  ]);

  // Simplified close handler - state reset is handled by isOpen useEffect
  const handleClose = () => onClose();

  // Navigate to endorse modal - simplified version
  const handleGoEndorse = () => {
    if (!targetPersonHash || !isPersonHashFormatValid || !targetVersionIndex) {
      setShowEndorseConfirm(false);
      return;
    }
    if (onGoEndorse) {
      onGoEndorse(targetPersonHash, targetVersionIndex);
    }
  };

  const toggleConsent = (key: keyof typeof consents) => {
    setConsents((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (consentError && next.public && next.age && next.legal) setConsentError(null);
      return next;
    });
  };

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // Close on mobile back button
  useEffect(() => {
    if (!isOpen) return;
    const marker = { __dfModal: "MintNFTModal", id: Math.random().toString(36).slice(2) };
    try {
      window.history.pushState(marker, "");
    } catch {}
    const onPop = () => onClose();
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
    };
  }, [isOpen, onClose]);

  // Continue minting: reset form state, keep modal open
  const handleContinueMinting = () => {
    reset();
    setPersonHash("");
    setVersionIndex(1);
    setPersonInfo(null);
    setPersonHasPassphrase(false);
    setPersonIdentityMode("deterministic");
    setPersonRecoverySaltHex("");
    setIsSubmitting(false);
    setSuccessResult(null);
    setErrorResult(null);
    setContractError(null);
    setProofGenerationStep("");
    setIsEndorsed(false);
    setIsAlreadyMinted(false);
    setIsCheckingStatus(false);
    setHasMissingParents(null);
    setConsents({ public: false, age: false, legal: false });
    setConsentError(null);
  };

  const onSubmit = async (data: any) => {
    if (!allConsentsChecked) {
      setConsentError(
        t("mintNFT.consentMissing", "Please confirm all required checkboxes before minting"),
      );
      return;
    } else {
      setConsentError(null);
    }

    if (!hasTargetInputs) {
      alert(t("mintNFT.targetRequired", "Please provide a valid person hash and version index"));
      return;
    }

    if (!address) {
      alert(t("wallet.notConnected", "Please connect your wallet"));
      return;
    }

    if (!personInfo) {
      alert(t("mintNFT.personInfoRequired", "Please fill in person information"));
      return;
    }

    // Check if user has endorsed and NFT hasn't been minted (when we have valid target)
    if (hasValidTarget) {
      if (!isEndorsed) {
        // Friendly confirm to jump to endorsement
        setShowEndorseConfirm(true);
        return;
      }
      if (isAlreadyMinted) {
        alert(t("mintNFT.alreadyMinted", "NFT has already been minted for this version"));
        return;
      }
    }

    // Clear old results
    setSuccessResult(null);
    setErrorResult(null);
    setContractError(null);
    setIsSubmitting(true);

    // Convert form data to proper types
    const processedData = {
      ...data,
      deathYear: data.deathYear === "" || data.deathYear === undefined ? 0 : Number(data.deathYear),
      deathMonth:
        data.deathMonth === "" || data.deathMonth === undefined ? 0 : Number(data.deathMonth),
      deathDay: data.deathDay === "" || data.deathDay === undefined ? 0 : Number(data.deathDay),
    };

    try {
      setProofGenerationStep(t("mintNFT.preparingProof", "Preparing proof inputs..."));

      const normalizedFullName = safeCanonicalizeFullName(personInfo.fullName || "");

      if (!normalizedFullName) {
        alert(t("mintNFT.fullNameRequired", "Full name is required to generate proof"));
        setIsSubmitting(false);
        setProofGenerationStep("");
        return;
      }

      const personIdentitySaltHex = resolveSelectedPersonIdentitySaltHex();

      const {
        canonicalFullName,
        derivedSecretField,
        identityCommitment,
        personHash: computedPersonHash,
        nameField,
        suiteCommitment,
        packedBirthGenderField,
      } = await computeIdentityHashMaterial({
        fullName: normalizedFullName,
        passphrase: personCalcRef.current?.getSecretInputs().passphrase || "",
        isBirthBC: personInfo.isBirthBC,
        birthYear: personInfo.birthYear,
        birthMonth: personInfo.birthMonth,
        birthDay: personInfo.birthDay,
        gender: personInfo.gender,
        identityMode: personIdentityMode,
        identitySaltHex: personIdentitySaltHex,
      });

      if (targetPersonHash && computedPersonHash !== targetPersonHash) {
        throw new Error(
          t(
            "mintNFT.personHashMismatch",
            "The selected identity mode or recovery salt does not match the target person hash",
          ),
        );
      }

      const personData: PersonData = {
        fullName: canonicalFullName,
        derivedSecretField,
        birthYear: personInfo.birthYear,
        birthMonth: personInfo.birthMonth,
        birthDay: personInfo.birthDay,
        isBirthBC: personInfo.isBirthBC,
        gender: personInfo.gender,
      };

      const coreInfo = {
        basicInfo: {
          identityCommitment: ethers.zeroPadValue(ethers.toBeHex(identityCommitment), 32),
          isBirthBC: personInfo.isBirthBC,
          birthYear: personInfo.birthYear,
          birthMonth: personInfo.birthMonth,
          birthDay: personInfo.birthDay,
          gender: personInfo.gender,
        },
        supplementInfo: {
          fullName: canonicalFullName,
          birthPlace: processedData.birthPlace,
          isDeathBC: processedData.isDeathBC,
          deathYear: processedData.deathYear,
          deathMonth: processedData.deathMonth,
          deathDay: processedData.deathDay,
          deathPlace: processedData.deathPlace,
          story: processedData.story,
        },
      };

      setProofGenerationStep(
        t(
          "mintNFT.generatingProof",
          "Generating zero-knowledge proof... (this may take 30-60 seconds)",
        ),
      );
      if (!address) {
        throw new Error(t("mintNFT.walletRequired", "Wallet connection required to mint"));
      }
      const { proof: generatedProof, publicSignals } = await zkWorkerCall(
        "generateDisclosureBindingProof",
        {
          person: personData,
          minterAddress: address,
        },
        { timeoutMs: 240_000 },
      );

      setProofGenerationStep(t("mintNFT.verifyingProof", "Verifying zero-knowledge proof..."));
      const { ok: isProofValid } = await zkWorkerCall(
        "verifyDisclosureBindingProof",
        { proof: generatedProof, publicSignals },
        { timeoutMs: 120_000 },
      );
      if (!isProofValid) {
        throw new Error(
          t("mintNFT.proofVerificationFailed", "Generated proof verification failed"),
        );
      }

      const proofEnvelope = formatGroth16ProofForContract(generatedProof);
      if (publicSignals.length < 6) {
        throw new Error("Invalid name disclosure public signals length");
      }
      const publicSignalsStruct = {
        identityCommitment: BigInt(publicSignals[0]),
        disclosureBinding: BigInt(publicSignals[1]),
        minter: BigInt(publicSignals[2]),
        schemaVersion: Number(publicSignals[3]),
        cryptoSuiteVersion: Number(publicSignals[4]),
        hashAlgoId: Number(publicSignals[5]),
      };

      const disclosureBindingValue = computeDisclosureBinding(
        nameField,
        packedBirthGenderField,
        suiteCommitment,
      );
      if (publicSignalsStruct.disclosureBinding !== disclosureBindingValue) {
        throw new Error("Disclosure binding mismatch");
      }

      setProofGenerationStep(
        t("mintNFT.proofVerified", "Zero-knowledge proof verified. Submitting transaction..."),
      );

      let finalPersonHash = targetPersonHash || computedPersonHash;
      if (!finalPersonHash) {
        alert(t("mintNFT.personHashRequired", "Unable to compute person hash"));
        return;
      }
      const finalVersionIndex = targetVersionIndex || 1;

      // Preflight: ensure endorsement matches target version
      try {
        if (contract) {
          const endorsedIdx = await contract.endorsedVersionIndex(finalPersonHash, address);
          if (Number(endorsedIdx) !== Number(finalVersionIndex)) {
            setShowEndorseConfirm(true);
            setIsSubmitting(false);
            return;
          }
        }
      } catch {}

      const receipt = await mintPersonVersionNFT(
        proofEnvelope,
        publicSignalsStruct,
        finalVersionIndex,
        processedData.tokenURI || "",
        coreInfo as any,
      );

      if (receipt) {
        // Extract event data from receipt logs
        let mintedEvent = null;
        try {
          // Find PersonNFTMinted event in receipt logs
          const mintedEvents =
            receipt.logs?.filter(
              (log: any) =>
                log.topics?.[0] && contract?.interface.parseLog(log)?.name === "PersonNFTMinted",
            ) || [];

          if (mintedEvents.length > 0) {
            mintedEvent = contract?.interface.parseLog(mintedEvents[0]);
          }
        } catch (e) {
          console.warn("Failed to parse mint event:", e);
        }

        // Get tokenId from contract or event
        let tokenId = 0;
        try {
          const details = await getVersionDetails?.(finalPersonHash, finalVersionIndex);
          tokenId = Number(details?.tokenId ?? 0);
        } catch {}

        if (mintedEvent && tokenId === 0) {
          tokenId = Number(mintedEvent.args?.tokenId ?? 0);
        }

        if (
          !didPatchCacheRef.current &&
          tokenId > 0 &&
          finalPersonHash &&
          Number.isFinite(finalVersionIndex) &&
          finalVersionIndex > 0
        ) {
          didPatchCacheRef.current = true;
          try {
            setNodesData?.((prev) => {
              const id = makeNodeId(finalPersonHash, finalVersionIndex);
              const cur: NodeData = (prev[id] || {
                personHash: finalPersonHash!,
                versionIndex: finalVersionIndex,
                id,
              }) as any;
              return {
                ...prev,
                [id]: {
                  ...cur,
                  tokenId: String(tokenId),
                  nftTokenURI: processedData.tokenURI || cur.nftTokenURI,
                },
              };
            });
          } catch {}
        }

        setSuccessResult({
          tokenId,
          personHash: finalPersonHash,
          versionIndex: finalVersionIndex,
          tokenURI: processedData.tokenURI || "",
          transactionHash: receipt.hash || receipt.transactionHash || "",
          blockNumber: receipt.blockNumber || 0,
          events: {
            PersonNFTMinted: mintedEvent
              ? {
                  personHash: mintedEvent.args?.personHash || finalPersonHash,
                  tokenId: mintedEvent.args?.tokenId || tokenId,
                  owner: mintedEvent.args?.owner || address,
                  versionIndex: mintedEvent.args?.versionIndex || finalVersionIndex,
                  tokenURI: mintedEvent.args?.tokenURI || processedData.tokenURI || "",
                  timestamp: mintedEvent.args?.timestamp || Math.floor(Date.now() / 1000),
                }
              : null,
          },
        });
        invalidateByTx({
          receipt,
          hints: { personHash: finalPersonHash, versionIndex: finalVersionIndex, tokenId },
        });

        if (tokenId > 0) onSuccess?.(tokenId);
      }
    } catch (error: any) {
      console.error("Mint NFT failed:", sanitizeErrorForLogging(error));

      const friendly = getFriendlyError(error, t);

      setErrorResult({
        type: friendly.reason || friendly.type || "UNKNOWN_ERROR",
        message: friendly.message,
        details: friendly.details,
      });
    } finally {
      setIsSubmitting(false);
      setProofGenerationStep("");
    }
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
    colorClass: "orange";
    isPlainText?: boolean;
  }) => {
    const colorConfig = {
      orange: {
        labelColor: "text-orange-800 dark:text-orange-200",
        valueBg: "bg-orange-100 dark:bg-orange-800",
        valueColor: "text-orange-900 dark:text-orange-100",
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
                  <Image className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50 mb-0.5">
                    {t("mintNFT.title", "Mint NFT")}
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                    {t(
                      "mintNFT.headerOnChainHint",
                      "Minting is public: plain text is permanently on-chain",
                    )}
                  </p>
                </div>
              </div>
              <button
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
              id="mint-nft-form"
              onSubmit={handleSubmit(onSubmit)}
              className="min-h-full flex flex-col"
            >
              <div className="flex-1 p-6 space-y-6">
                {/* Person Hash and Version Input (always shown as editable) */}
                <div className="space-y-4">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {t("mintNFT.targetVersion", "Target Version")}
                  </h3>

                  <div className="p-5 bg-orange-50/50 dark:bg-orange-900/10 rounded-2xl border border-orange-100 dark:border-orange-900/20">
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr,140px] gap-4">
                      <div>
                        <label className="block text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
                          {t("mintNFT.personHash", "Person Hash")}{" "}
                          <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={personHash}
                          onChange={(e) => setPersonHash(e.target.value)}
                          className={`w-full h-11 rounded-xl border bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none transition-all font-mono ${
                            hashInputInvalid
                              ? "border-red-500 focus:border-red-500 focus:ring-4 focus:ring-red-500/10"
                              : "border-gray-200 dark:border-gray-700 focus:border-orange-500 dark:focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10"
                          }`}
                          placeholder={t("search.versionsQuery.placeholder")}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
                          {t("mintNFT.versionIndex", "Version Index")}{" "}
                          <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={versionIndex}
                          onChange={(e) => setVersionIndex(parseInt(e.target.value) || 1)}
                          className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-orange-500 dark:focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 outline-none transition-all"
                          placeholder="1"
                        />
                      </div>
                    </div>

                    {/* Inline status chips (endorsed / can mint) */}
                    {hashInputInvalid && (
                      <div className="mt-3 p-3 text-sm text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        {t(
                          "mintNFT.invalidPersonHashFormat",
                          "Person hash must be 0x-prefixed 32-byte hex (64 hex chars).",
                        )}
                      </div>
                    )}

                    {!hashInputInvalid && hasValidTarget && (
                      <div className="mt-4 pt-4 border-t border-orange-100 dark:border-orange-900/20">
                        {isCheckingStatus ? (
                          <div className="text-sm font-medium text-orange-600 dark:text-orange-400 flex items-center gap-2">
                            <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            {t("mintNFT.checkingStatus", "Checking status...")}
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-3 text-sm font-bold">
                            <div
                              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${isEndorsed ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"}`}
                            >
                              <div
                                className={`w-2 h-2 rounded-full ${isEndorsed ? "bg-green-500" : "bg-orange-500"}`}
                              />
                              {isEndorsed
                                ? t("mintNFT.endorsed", "Endorsed")
                                : t("mintNFT.notEndorsed", "Not Endorsed")}
                            </div>
                            <div
                              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${isAlreadyMinted ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"}`}
                            >
                              <div
                                className={`w-2 h-2 rounded-full ${isAlreadyMinted ? "bg-red-500" : "bg-green-500"}`}
                              />
                              {isAlreadyMinted
                                ? t("mintNFT.alreadyMinted", "Already Minted")
                                : t("mintNFT.canMint", "Can Mint")}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Inline missing parents warning (merged) */}
                    {!isCheckingStatus &&
                      hasMissingParents &&
                      (hasMissingParents.father || hasMissingParents.mother) && (
                        <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/30 rounded-xl border border-amber-100 dark:border-amber-900/30">
                          <div className="flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                              <h4 className="text-sm font-bold text-amber-900 dark:text-amber-100 mb-1">
                                {t("mintNFT.missingParentsTitle", "Incomplete Parent Information")}
                              </h4>
                              <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed opacity-90">
                                {hasMissingParents.father && hasMissingParents.mother
                                  ? t(
                                      "mintNFT.missingBothParents",
                                      "Both parent hashes are empty for this version. Publish a new ZK version with parent hashes; version index 0 defers picking the exact parent version.",
                                    )
                                  : hasMissingParents.father
                                    ? t(
                                        "mintNFT.missingFather",
                                        "The father hash is empty for this version. Publish a new ZK version with the father hash; index 0 will use the highest-endorsed father version by default.",
                                      )
                                    : t(
                                        "mintNFT.missingMother",
                                        "The mother hash is empty for this version. Publish a new ZK version with the mother hash; index 0 will use the highest-endorsed mother version by default.",
                                      )}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                  </div>
                </div>

                {/* Show form content only if NFT hasn't been minted */}
                {!isAlreadyMinted && (
                  <>
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
                            "mintNFT.ageRequirement",
                            "The person minted into an NFT must be 18 years or older. Do not submit minors' identities.",
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Basic Information - Using PersonHashCalculator */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                        {t("mintNFT.basicInfo", "Basic Information")}
                      </h3>

                      {/* Verification Notice */}
                      <div className="p-3 bg-blue-50/50 dark:bg-blue-900/10 rounded-2xl border border-blue-100 dark:border-blue-900/30">
                        <div className="flex items-center gap-2">
                          <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                          <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed font-medium">
                            {t(
                              "mintNFT.basicInfoMustMatch",
                              "The basic information you enter must exactly match the target version data. The contract will verify this on-chain before minting.",
                            )}
                          </p>
                        </div>
                      </div>

                      <PersonHashCalculator
                        ref={personCalcRef}
                        showTitle={false}
                        collapsible={false}
                        className="bg-transparent border-0 shadow-none !p-0"
                        identityMode={personIdentityMode}
                        identitySaltHex={personIdentityMode === "random" ? personRecoverySaltHex : undefined}
                        initialValues={
                          personInfo
                            ? {
                                fullName: personInfo.fullName,
                                gender: personInfo.gender,
                                birthYear: personInfo.birthYear,
                                birthMonth: personInfo.birthMonth,
                                birthDay: personInfo.birthDay,
                                isBirthBC: personInfo.isBirthBC,
                              }
                            : undefined
                        }
                        onPublicFormChange={
                          canEdit
                            ? (formData) => {
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
                              }
                            : undefined
                        }
                      />

                      {personHasPassphrase && (
                        <div className="rounded-2xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/30 dark:bg-blue-900/10 p-4 space-y-4">
                        <div className="space-y-1">
                          <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                            {t("mintNFT.identityMode", "Identity Recovery Mode")}
                          </h4>
                          <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                            {t(
                              "mintNFT.identityModeHint",
                              "Use standard mode for deterministic recovery. Use enhanced mode only when this identity was originally created with a saved random recovery salt.",
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
                              {t("mintNFT.identityModeStandard", "Standard")}
                            </div>
                            <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                              {t(
                                "mintNFT.identityModeStandardHint",
                                "Deterministic identity salt from public fields.",
                              )}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPersonIdentityMode("random");
                            }}
                            className={`rounded-xl border px-4 py-3 text-left transition-all ${
                              personIdentityMode === "random"
                                ? "border-blue-500 bg-white dark:bg-gray-800 shadow-sm"
                                : "border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40"
                            }`}
                          >
                            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                              {t("mintNFT.identityModeEnhanced", "Enhanced")}
                            </div>
                            <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                              {t(
                                "mintNFT.identityModeEnhancedHint",
                                "Paste the previously saved recovery salt for this identity. Do not create a new salt here.",
                              )}
                            </div>
                          </button>
                        </div>

                        {personIdentityMode === "random" && (
                          <div className="space-y-3">
                            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
                              {t("mintNFT.identityRecoverySalt", "Recovery Salt")}
                            </label>
                            <input
                              type="text"
                              value={personRecoverySaltHex}
                              onChange={(e) => setPersonRecoverySaltHex(e.target.value)}
                              className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 text-xs font-mono text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                              placeholder={t(
                                "mintNFT.identityRecoverySaltPlaceholder",
                                "Paste the saved recovery salt for this identity",
                              )}
                            />
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                              {t(
                                "mintNFT.identityRecoverySaltNotice",
                                "Minting in enhanced mode only succeeds when this is the exact recovery salt originally saved for the target identity.",
                              )}
                            </p>
                          </div>
                        )}
                        </div>
                      )}
                    </div>

                    {/* Supplemental Information (from PersonSupplementInfo) */}
                    <div className="space-y-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                      <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                        {t("mintNFT.supplementalInfo", "Supplemental Information")}
                      </h3>

                      {/* Immutability Warning */}
                      <div className="p-3 bg-orange-50/50 dark:bg-orange-900/10 rounded-2xl border border-orange-100 dark:border-orange-900/30">
                        <div className="flex items-center gap-2">
                          <Lock className="w-4 h-4 text-orange-600 dark:text-orange-400 flex-shrink-0" />
                          <p className="text-xs text-orange-700 dark:text-orange-300 leading-relaxed font-medium">
                            {t(
                              "mintNFT.supplementalInfoImmutable",
                              "Supplemental information will be permanently stored on the blockchain and cannot be modified after submission. Please fill in carefully.",
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-5">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
                              {t("mintNFT.birthPlace", "Birth Place")}
                            </label>
                            <input
                              {...register("birthPlace")}
                              className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-orange-500 dark:focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 outline-none transition-all"
                              placeholder={t("mintNFT.birthPlacePlaceholder", "Enter birth place")}
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
                              {t("mintNFT.deathPlace", "Death Place")}
                            </label>
                            <input
                              {...register("deathPlace")}
                              className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-orange-500 dark:focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 outline-none transition-all"
                              placeholder={t(
                                "mintNFT.deathPlacePlaceholder",
                                "Enter death place (if applicable)",
                              )}
                            />
                          </div>
                        </div>

                        {/* Death Date Information - Using PersonHashCalculator style */}
                        <div className="space-y-2">
                          <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                            {t("mintNFT.deathDate", "Death Date (if applicable)")}
                          </h4>

                          <div className="flex flex-nowrap items-start gap-1">
                            <div className="flex items-start gap-1">
                              <div className="w-20 relative">
                                <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">
                                  {t("search.hashCalculator.isBirthBC")}
                                </label>
                                <ThemedSelect
                                  value={watch("isDeathBC") ? 1 : 0}
                                  onChange={(v) => setValue("isDeathBC", v === 1)}
                                  options={[
                                    { value: 0, label: t("search.hashCalculator.bcOptions.ad") },
                                    { value: 1, label: t("search.hashCalculator.bcOptions.bc") },
                                  ]}
                                />
                              </div>

                              <div className="w-20 sm:w-[120px]">
                                <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">
                                  {t("mintNFT.deathYear", "Death Year")}
                                </label>
                                <input
                                  type="number"
                                  min="0"
                                  max={watch("isDeathBC") ? 9999 : new Date().getFullYear()}
                                  placeholder={
                                    watch("isDeathBC") ? "<10000" : "<=" + new Date().getFullYear()
                                  }
                                  className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-xs text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-orange-500 dark:focus:border-orange-400 focus:ring-2 focus:ring-orange-500/30 dark:focus:ring-orange-400/30 outline-none transition"
                                  {...register("deathYear", {
                                    setValueAs: (v) => (v === "" ? "" : parseInt(v, 10)),
                                  })}
                                />
                              </div>
                            </div>

                            <div className="w-24">
                              <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">
                                {t("search.hashCalculator.birthMonthLabel")}
                              </label>
                              <input
                                type="number"
                                min="0"
                                max="12"
                                placeholder={t("search.hashCalculator.birthMonth")}
                                className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-xs text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-orange-500 dark:focus:border-orange-400 focus:ring-2 focus:ring-orange-500/30 dark:focus:ring-orange-400/30 outline-none transition"
                                {...register("deathMonth", {
                                  setValueAs: (v) => (v === "" ? "" : parseInt(v, 10)),
                                })}
                              />
                            </div>

                            <div className="w-24">
                              <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">
                                {t("search.hashCalculator.birthDayLabel")}
                              </label>
                              <input
                                type="number"
                                min="0"
                                max="31"
                                placeholder={t("search.hashCalculator.birthDay")}
                                className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-xs text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-orange-500 dark:focus:border-orange-400 focus:ring-2 focus:ring-orange-500/30 dark:focus:ring-orange-400/30 outline-none transition"
                                {...register("deathDay", {
                                  setValueAs: (v) => (v === "" ? "" : parseInt(v, 10)),
                                })}
                              />
                            </div>
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
                            {t("mintNFT.story", "Life Story Summary")}
                          </label>
                          <textarea
                            {...register("story")}
                            rows={4}
                            className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-orange-500 dark:focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 outline-none transition-all resize-none"
                            placeholder={t(
                              "mintNFT.storyPlaceholder",
                              "Enter a brief life story summary...",
                            )}
                          />
                          {errors.story && (
                            <p className="mt-1 text-xs text-red-500 font-bold">
                              {errors.story.message}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* NFT Metadata */}
                    <div className="space-y-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                      <div>
                        <label className="block text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
                          {t("mintNFT.tokenURI", "Token URI")}
                        </label>
                        <input
                          {...register("tokenURI")}
                          className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-orange-500 dark:focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 outline-none transition-all"
                          placeholder="https://... or ipfs://..."
                        />
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 font-medium">
                          {t("mintNFT.tokenURIHint", "Optional: URL or IPFS hash for NFT metadata")}
                        </p>
                        {errors.tokenURI && (
                          <p className="mt-1 text-xs text-red-500 font-bold">
                            {errors.tokenURI.message}
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {/* Message when NFT is already minted */}
                {isAlreadyMinted && !successResult && (
                  <div className="p-8 rounded-3xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800 text-center flex flex-col items-center justify-center">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-100 to-red-50 dark:from-red-900/40 dark:to-red-900/20 flex items-center justify-center mb-4 shadow-sm">
                      <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                      {t("mintNFT.nftAlreadyMinted", "NFT Already Minted")}
                    </h3>
                    <p className="text-gray-500 dark:text-gray-400 max-w-sm">
                      {t(
                        "mintNFT.nftAlreadyMintedDesc",
                        "This version has already been minted as an NFT. Each version can only be minted once.",
                      )}
                    </p>
                  </div>
                )}

                {/* Informed Consent - before success/error results, consistent with AddVersionModal */}
                {!successResult && !isAlreadyMinted && (
                  <div className="p-5 rounded-2xl border border-red-200/50 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/10 backdrop-blur-sm !mt-8">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                        <Shield className="w-4 h-4 text-red-600 dark:text-red-400" />
                      </div>
                      <div className="space-y-3 w-full pt-1">
                        <p className="text-sm font-bold text-gray-900 dark:text-red-100">
                          {t("mintNFT.consentTitle", "Informed consent (required)")}
                        </p>
                        <div className="space-y-2">
                          {(
                            [
                              {
                                key: "public",
                                label: t(
                                  "mintNFT.consentPublic",
                                  "I understand this mint makes the entered info permanently public on-chain and undeletable.",
                                ),
                              },
                              {
                                key: "age",
                                label: t(
                                  "mintNFT.consentAge",
                                  "I confirm the person is 18 years or older.",
                                ),
                              },
                              {
                                key: "legal",
                                label: t(
                                  "mintNFT.consentLegal",
                                  "I confirm the data is lawful, truthful, and authorized for public disclosure without extra private content.",
                                ),
                              },
                            ] as const
                          ).map((item) => (
                            <label
                              key={item.key}
                              className="flex items-start gap-3 cursor-pointer group select-none"
                            >
                              <div className="relative flex items-center justify-center shrink-0 w-4 h-4 mt-[2px]">
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
                {isSubmitting && !successResult && !errorResult && (
                  <div className="p-5 bg-orange-50/50 dark:bg-orange-900/10 rounded-2xl border border-orange-100 dark:border-orange-900/20 animate-fadeIn">
                    <div className="flex items-center gap-4">
                      <div className="relative w-10 h-10 flex-shrink-0">
                        <div className="absolute inset-0 rounded-full border-4 border-orange-200 dark:border-orange-800 opacity-30"></div>
                        <div className="absolute inset-0 rounded-full border-4 border-orange-500 border-t-transparent animate-spin"></div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-gray-900 dark:text-white mb-1">
                          {proofGenerationStep
                            ? t("mintNFT.processing", "Processing...")
                            : t("mintNFT.minting", "Minting NFT...")}
                        </p>
                        <p className="text-xs font-medium text-orange-700 dark:text-orange-300">
                          {proofGenerationStep ||
                            t(
                              "mintNFT.mintingDesc",
                              "Creating your unique NFT on the blockchain...",
                            )}
                        </p>
                      </div>
                    </div>
                    {proofGenerationStep?.includes("30-60 seconds") && (
                      <div className="mt-4 pt-4 border-t border-orange-200/50 dark:border-orange-800/50 text-xs font-medium text-orange-600 dark:text-orange-400">
                        {t(
                          "mintNFT.proofGenerationNote",
                          "ZK proof generation requires heavy cryptography. Please keep this tab active until completion.",
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Success Message */}
                {successResult && (
                  <div className="space-y-4 animate-fadeIn">
                    {/* Success Header */}
                    <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl border border-green-200 dark:border-green-700">
                      <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                        <Check className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-green-900 dark:text-green-100">
                          {t("mintNFT.successTitle", "NFT Minted Successfully")}
                        </h3>
                        <p className="text-sm text-green-700 dark:text-green-300">
                          {t("mintNFT.successDesc", "Your NFT has been created on the blockchain")}
                        </p>
                      </div>
                    </div>

                    {/* Event Information - collapsible */}
                    {successResult.events.PersonNFTMinted && (
                      <details
                        className="group bg-orange-50 dark:bg-orange-900/20 rounded-xl border border-orange-200 dark:border-orange-700 overflow-hidden"
                        open
                      >
                        <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-colors">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-orange-600 rounded-full"></div>
                            <span className="text-sm font-bold text-orange-900 dark:text-orange-100">
                              {t("mintNFT.nftDetails", "NFT Details")}
                            </span>
                            <span className="ml-2 text-xs font-bold text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-800 px-2 py-0.5 rounded-full uppercase tracking-wide">
                              #{successResult.tokenId}
                            </span>
                          </div>
                          <ChevronRight className="w-4 h-4 text-orange-600 group-open:rotate-90 transition-transform" />
                        </summary>
                        <div className="px-3 pb-3 space-y-3">
                          {/* Basic Info */}
                          <div className="space-y-2">
                            <DataRow
                              label={t("mintNFT.personHash", "Person Hash")}
                              value={successResult.personHash}
                              colorClass="orange"
                            />
                            <DataRow
                              label={t("mintNFT.tokenId", "Token ID")}
                              value={`#${successResult.tokenId}`}
                              colorClass="orange"
                            />
                            <DataRow
                              label={t("mintNFT.versionIndex", "Version Index")}
                              value={successResult.versionIndex.toString()}
                              colorClass="orange"
                            />
                            {successResult.tokenURI && (
                              <DataRow
                                label={t("mintNFT.tokenURI", "Token URI")}
                                value={successResult.tokenURI}
                                colorClass="orange"
                              />
                            )}
                            <DataRow
                              label={t("mintNFT.owner", "Owner")}
                              value={successResult.events.PersonNFTMinted.owner}
                              colorClass="orange"
                            />
                          </div>

                          {/* Transaction Info Section */}
                          <div className="pt-2 border-t border-orange-200/50 dark:border-orange-700/50">
                            <p className="text-xs font-bold text-orange-800 dark:text-orange-200 mb-2 uppercase tracking-wide">
                              {t("mintNFT.transactionInfo", "Transaction Info")}
                            </p>
                            <div className="space-y-2">
                              <DataRow
                                label={t("mintNFT.transactionHash", "Transaction Hash")}
                                value={successResult.transactionHash}
                                colorClass="orange"
                              />
                              <DataRow
                                label={t("mintNFT.blockNumber", "Block Number")}
                                value={successResult.blockNumber.toString()}
                                colorClass="orange"
                              />
                              <DataRow
                                label={t("mintNFT.timestamp", "Timestamp")}
                                value={new Date(
                                  Number(successResult.events.PersonNFTMinted.timestamp) * 1000,
                                ).toLocaleString()}
                                colorClass="orange"
                                isPlainText
                              />
                            </div>
                          </div>
                        </div>
                      </details>
                    )}
                  </div>
                )}

                {/* Error Message */}
                {errorResult && (
                  <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-700 animate-fadeIn">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                        <AlertTriangle className="w-5 h-5 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-bold text-red-900 dark:text-red-100 mb-2">
                          {t("mintNFT.mintFailed", "NFT Minting Failed")}
                        </p>
                        <div className="space-y-2">
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-bold text-red-800 dark:text-red-200 uppercase tracking-wide">
                              {t("mintNFT.errorType", "Error Type")}
                            </span>
                            <code className="bg-red-100 dark:bg-red-800 text-red-900 dark:text-red-100 px-2 py-1.5 rounded-lg font-mono text-xs">
                              {errorResult.type}
                            </code>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-bold text-red-800 dark:text-red-200 uppercase tracking-wide">
                              {t("mintNFT.errorMessage", "Message")}
                            </span>
                            <p className="bg-red-100 dark:bg-red-800 text-red-900 dark:text-red-100 px-2 py-1.5 rounded-lg text-xs font-medium">
                              {errorResult.message}
                            </p>
                          </div>
                          {errorResult.details !== errorResult.message && (
                            <div className="flex flex-col gap-1">
                              <span className="text-xs font-bold text-red-800 dark:text-red-200 uppercase tracking-wide">
                                {t("mintNFT.errorDetails", "Details")}
                              </span>
                              <p className="bg-red-100 dark:bg-red-800 text-red-900 dark:text-red-100 px-2 py-1.5 rounded-lg text-xs font-medium">
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
                  // Success state: Show Continue Minting and Close buttons
                  <>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="flex-1 px-6 py-4 rounded-full border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900 transition-all font-bold text-sm"
                    >
                      {t("common.close", "Close")}
                    </button>
                    <button
                      type="button"
                      onClick={handleContinueMinting}
                      className="flex-1 px-6 py-4 bg-gradient-to-r from-orange-400 to-red-600 hover:from-orange-500 hover:to-red-700 text-white shadow-lg shadow-orange-500/20 hover:shadow-orange-500/30 rounded-full transition-all hover:scale-[1.02] active:scale-95 font-bold text-sm"
                    >
                      {t("mintNFT.continueMinting", "Continue Minting")}
                    </button>
                  </>
                ) : (
                  // Normal state: Show Cancel and Mint buttons
                  <>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="flex-1 px-6 py-4 rounded-full border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900 transition-all font-bold text-sm"
                    >
                      {t("common.cancel", "Cancel")}
                    </button>

                    {/* Only show mint button if NFT hasn't been minted */}
                    {!isAlreadyMinted && (
                      <>
                        {hasValidTarget && !isEndorsed ? (
                          <button
                            type="button"
                            onClick={() => setShowEndorseConfirm(true)}
                            disabled={isCheckingStatus}
                            className="flex-[1.5] px-6 py-4 bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-[1.02] active:scale-95 text-sm font-bold"
                          >
                            {t("mintNFT.goEndorse", "Go Endorse")}
                          </button>
                        ) : (
                          <button
                            type="submit"
                            disabled={
                              isSubmitting ||
                              isCheckingStatus ||
                              !allConsentsChecked ||
                              !hasPersonInfo ||
                              !hasTargetInputs
                            }
                            className="flex-[1.5] px-6 py-4 bg-gradient-to-r from-orange-400 to-red-600 hover:from-orange-500 hover:to-red-700 text-white shadow-lg shadow-orange-500/20 hover:shadow-xl hover:shadow-orange-500/30 rounded-full disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all hover:scale-[1.02] active:scale-95 text-sm font-bold flex items-center justify-center gap-2"
                          >
                            {isSubmitting ? (
                              <>
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                <span>{t("mintNFT.minting", "Minting...")}</span>
                              </>
                            ) : (
                              <>
                                <span>{t("mintNFT.mint", "Mint NFT")}</span>
                                <ChevronRight className="w-4 h-4 opacity-80" />
                              </>
                            )}
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
        {/* Confirm to jump to endorse */}
        {showEndorseConfirm && (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn"
            onClick={() => setShowEndorseConfirm(false)}
          >
            <div
              className="w-full max-w-sm rounded-3xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-2xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4">
                <AlertCircle className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">
                {t("mintNFT.endorsementRequiredTitle", "Endorsement Required")}
              </h3>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
                {t(
                  "mintNFT.endorsementRequiredDesc",
                  "You must endorse this version before minting. Would you like to go endorse now?",
                )}
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowEndorseConfirm(false)}
                  className="flex-1 px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all font-bold text-sm"
                >
                  {t("common.cancel", "Cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleGoEndorse}
                  className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.02] active:scale-95 text-sm font-bold"
                >
                  {t("mintNFT.goEndorse", "Go Endorse")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

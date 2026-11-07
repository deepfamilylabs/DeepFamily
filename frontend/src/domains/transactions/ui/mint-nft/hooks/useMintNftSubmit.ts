import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import {
  getFriendlyError,
  isArchivePreviewRejected,
  sanitizeErrorForLogging,
} from "../../../../../shared/lib/errors";
import {
  classifyProtocolPassphraseRisk,
  type ProtocolPassphraseRisk,
} from "../../../../../shared/crypto/passphraseStrength";
import type { PersonHashCalculatorHandle } from "../../../../person";
import type {
  ExecuteMintFlowResult,
  MintCoreInfo,
  MintDisclosurePublicSignals,
  MintNFTErrorResultView,
  MintNFTFormValues,
  MintNFTSuccessResultView,
  MintNFTT,
  MintNftFlowArgs,
  MintPersonInfo,
} from "../model/mintNftTypes";
import { buildMintNFTSuccessResultView, toMintNFTErrorResult } from "../model/mintNftResultView";
import type { TransactionSettlement } from "../../shared/useTransactionCenterEntry";

type GenerateDisclosureProof = (args: {
  address: string;
  personInfo: MintPersonInfo;
  formData: MintNFTFormValues;
  targetPersonHash: string;
  selfSuiteId: number;
  getPassphrase: () => string;
}) => Promise<{
  computedPersonHash: string;
  proofEnvelope: any;
  publicSignals: MintDisclosurePublicSignals;
  coreInfo: MintCoreInfo;
  tokenURI: string;
}>;

interface UseMintNftSubmitArgs {
  t: MintNFTT;
  address?: string | null;
  contract?: any;
  allConsentsChecked: boolean;
  hasTargetInputs: boolean;
  hasValidTarget: boolean;
  isEndorsed: boolean;
  isAlreadyMinted: boolean;
  personInfo: MintPersonInfo | null;
  personCalcRef: MutableRefObject<PersonHashCalculatorHandle | null>;
  targetPersonHash: string;
  targetVersionIndex: number;
  targetSelfSuiteId: number | null;
  didPatchCacheRef: MutableRefObject<boolean>;
  generateDisclosureProof: GenerateDisclosureProof;
  resetDisclosureProof: () => void;
  runMintNftOrThrow: (args: MintNftFlowArgs) => Promise<ExecuteMintFlowResult>;
  markVersionMinted: (args: {
    personHash: string;
    versionIndex: number;
    tokenId: string;
    tokenURI?: string;
    receipt?: any;
  }) => void;
  onSuccess?: (tokenId: number) => void;
  setConsentError: (value: string | null) => void;
  setErrorResult: (value: MintNFTErrorResultView | null) => void;
  setSuccessResult: (value: MintNFTSuccessResultView | null) => void;
  setShowEndorseConfirm: (value: boolean) => void;
  modalOpenRef: MutableRefObject<boolean>;
  submissionAttemptRef: MutableRefObject<number>;
  settleTransaction: (outcome: TransactionSettlement) => void;
  captureSettlement: (options?: { newEntry?: boolean }) => (outcome: TransactionSettlement) => void;
}

export function useMintNftSubmit({
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
}: UseMintNftSubmitArgs) {
  const mountedRef = useRef(true);
  const runtimeScopeRef = useRef({ address, contract });
  runtimeScopeRef.current = { address, contract };
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  return useCallback(
    async (data: MintNFTFormValues) => {
      if (!mountedRef.current || !modalOpenRef.current) return;
      const attempt = ++submissionAttemptRef.current;
      const isCurrentAttempt = () =>
        mountedRef.current && modalOpenRef.current && attempt === submissionAttemptRef.current;
      const isSameScope = () =>
        runtimeScopeRef.current.address === address && runtimeScopeRef.current.contract === contract;
      const calculator = personCalcRef.current;
      if (!allConsentsChecked) {
        setConsentError(
          t("mintNFT.consentMissing", "Please confirm all required checkboxes before minting"),
        );
        return;
      }
      setConsentError(null);

      if (!calculator?.passphrasesMatch()) {
        setErrorResult(
          toMintNFTErrorResult(
            "PASSPHRASE_MISMATCH",
            t("mintNFT.passphraseMismatch", "The identity passphrases do not match"),
          ),
        );
        return;
      }

      if (
        classifyProtocolPassphraseRisk(calculator.getSecretInputs().passphrase) === "disallowed"
      ) {
        setErrorResult(
          toMintNFTErrorResult(
            "PASSPHRASE_DISALLOWED",
            t(
              "mintNFT.passphraseDisallowed",
              "This passphrase contains malformed Unicode. Re-enter the affected text.",
            ),
          ),
        );
        return;
      }

      if (!hasTargetInputs) {
        setErrorResult(
          toMintNFTErrorResult(
            "INVALID_TARGET",
            t("mintNFT.targetRequired", "Please provide a valid person hash and version index"),
          ),
        );
        return;
      }

      if (!address || !contract) {
        setErrorResult(
          toMintNFTErrorResult(
            "WALLET_NOT_CONNECTED",
            t("wallet.notConnected", "Please connect your wallet"),
          ),
        );
        return;
      }

      if (!personInfo) {
        setErrorResult(
          toMintNFTErrorResult(
            "PERSON_INFO_REQUIRED",
            t("mintNFT.personInfoRequired", "Please fill in person information"),
          ),
        );
        return;
      }

      if (hasValidTarget && targetSelfSuiteId === null) {
        setErrorResult(
          toMintNFTErrorResult(
            "TARGET_ENVELOPE_HEADER_UNAVAILABLE",
            t(
              "mintNFT.targetEnvelopeHeaderRequired",
              "The target metadata envelope header must be verified before minting",
            ),
          ),
        );
        return;
      }

      if (hasValidTarget) {
        if (!isEndorsed) {
          setShowEndorseConfirm(true);
          return;
        }
        if (isAlreadyMinted) {
          setErrorResult(
            toMintNFTErrorResult(
              "ALREADY_MINTED",
              t("mintNFT.alreadyMinted", "NFT has already been minted for this version"),
            ),
          );
          return;
        }
      }

      setSuccessResult(null);
      setErrorResult(null);
      const settle = captureSettlement({ newEntry: true }) ?? settleTransaction;
      let handedOff = false;
      let transactionHash: string | undefined;

      try {
        const proof = await generateDisclosureProof({
          address,
          personInfo,
          formData: data,
          targetPersonHash,
          selfSuiteId: targetSelfSuiteId!,
          getPassphrase: () => calculator.getSecretInputs().passphrase,
        });
        if (!isCurrentAttempt()) {
          throw Object.assign(new Error("Mint submission cancelled before wallet request"), {
            code: "ARCHIVE_PREVIEW_REJECTED",
          });
        }

        // The proof, core info and token URI are built, so the passphrase is
        // not needed again. Clear the secret input before any wallet or RPC
        // wait, the same point add-version clears at.
        calculator.clearSecretInputs();

        const finalPersonHash = targetPersonHash || proof.computedPersonHash;
        if (!finalPersonHash) {
          throw new Error(t("mintNFT.personHashRequired", "Unable to compute person hash"));
        }
        const finalVersionIndex = targetVersionIndex || 1;

        handedOff = true;
        const mintResult = await runMintNftOrThrow({
          personHash: finalPersonHash,
          versionIndex: finalVersionIndex,
          selfSuiteId: targetSelfSuiteId!,
          proofEnvelope: proof.proofEnvelope,
          publicSignals: proof.publicSignals,
          tokenURI: proof.tokenURI,
          coreInfo: proof.coreInfo,
          storyTitle: data.storyTitle,
          story: data.story,
          onTransactionSubmitted: (hash) => { transactionHash = hash; },
        });

        if (mintResult.requiresEndorsement) {
          settle({ phase: "failed", error: getFriendlyError(new Error("Endorsement required"), t) });
          if (isCurrentAttempt()) setShowEndorseConfirm(true);
          return;
        }

        const successfulResult = mintResult as Extract<
          ExecuteMintFlowResult,
          { requiresEndorsement: false }
        >;
        const tokenId = successfulResult.tokenId;
        settle({ phase: "done", transactionHash: successfulResult.transactionHash, error: null });
        if (!isCurrentAttempt() || !isSameScope()) return;

        if (
          !didPatchCacheRef.current &&
          tokenId > 0 &&
          finalPersonHash &&
          Number.isFinite(finalVersionIndex) &&
          finalVersionIndex > 0
        ) {
          didPatchCacheRef.current = true;
          try {
            markVersionMinted({
              personHash: finalPersonHash,
              versionIndex: finalVersionIndex,
              tokenId: String(tokenId),
              tokenURI: proof.tokenURI,
              receipt: successfulResult.receipt,
            });
          } catch {}
        }

        if (!isCurrentAttempt() || !isSameScope()) return;
        setSuccessResult(
          buildMintNFTSuccessResultView({
            result: successfulResult,
            personHash: finalPersonHash,
            versionIndex: finalVersionIndex,
            tokenURI: proof.tokenURI,
            owner: address,
          }),
        );

        if (tokenId > 0) {
          onSuccess?.(tokenId);
        }
      } catch (error) {
        const knownHash = (error as any)?.transactionHash ?? transactionHash;
        const transactionConfirmed = (error as any)?.transactionConfirmed === true;
        const verificationFailure = transactionConfirmed
          ? ((error as any)?.verificationFailure === "read" ? "read" : "mismatch")
          : undefined;
        if (!isCurrentAttempt() && transactionConfirmed && knownHash) {
          settle({ phase: "done", transactionHash: knownHash, error: null });
          return;
        }
        if (isArchivePreviewRejected(error) || (!isCurrentAttempt() && !handedOff)) {
          const cancellation = Object.assign(new Error("Mint submission cancelled before wallet request"), {
            code: "ARCHIVE_PREVIEW_REJECTED",
          });
          settle({ phase: "failed", error: getFriendlyError(cancellation, t) });
          return;
        }
        const original = getFriendlyError(error, t);
        const friendly = transactionConfirmed
          ? { ...original, message: verificationFailure === "read"
            ? t(
              "mintNFT.detailsReadFailed",
              "The mint transaction is confirmed. Refresh the page to load its details.",
            )
            : t(
              "mintNFT.verificationMismatch",
              "The retrieved data did not pass verification. Check the transaction details.",
            ), retryable: false }
          : original;
        settle({ phase: "failed", transactionHash: knownHash, error: friendly });
        if (!isCurrentAttempt() || !isSameScope()) return;
        console.error("Mint NFT failed:", sanitizeErrorForLogging(error));
        setErrorResult({
          type: friendly.reason || friendly.type || "UNKNOWN_ERROR",
          message: friendly.message,
          details: [friendly.details, knownHash ? `${t("transaction.rowTransaction", "Transaction")}: ${knownHash}` : ""].filter(Boolean).join("\n"),
          retryable: friendly.retryable,
          transactionHash: knownHash,
          transactionConfirmed,
          verificationFailure,
        });
      } finally {
        if (isCurrentAttempt()) resetDisclosureProof();
      }
    },
    [
      address,
      allConsentsChecked,
      contract,
      captureSettlement,
      didPatchCacheRef,
      generateDisclosureProof,
      hasTargetInputs,
      hasValidTarget,
      isAlreadyMinted,
      isEndorsed,
      markVersionMinted,
      modalOpenRef,
      onSuccess,
      personCalcRef,
      personInfo,
      resetDisclosureProof,
      runMintNftOrThrow,
      setConsentError,
      setErrorResult,
      setShowEndorseConfirm,
      setSuccessResult,
      settleTransaction,
      submissionAttemptRef,
      t,
      targetPersonHash,
      targetSelfSuiteId,
      targetVersionIndex,
    ],
  );
}

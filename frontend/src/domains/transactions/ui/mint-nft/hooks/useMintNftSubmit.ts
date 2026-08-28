import { useCallback, type MutableRefObject } from "react";
import { getFriendlyError, sanitizeErrorForLogging } from "../../../../../shared/lib/errors";
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
}: UseMintNftSubmitArgs) {
  return useCallback(
    async (data: MintNFTFormValues) => {
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

      try {
        const proof = await generateDisclosureProof({
          address,
          personInfo,
          formData: data,
          targetPersonHash,
          selfSuiteId: targetSelfSuiteId!,
          getPassphrase: () => personCalcRef.current?.getSecretInputs().passphrase || "",
        });

        const finalPersonHash = targetPersonHash || proof.computedPersonHash;
        if (!finalPersonHash) {
          throw new Error(t("mintNFT.personHashRequired", "Unable to compute person hash"));
        }
        const finalVersionIndex = targetVersionIndex || 1;

        const mintResult = await runMintNftOrThrow({
          personHash: finalPersonHash,
          versionIndex: finalVersionIndex,
          selfSuiteId: targetSelfSuiteId!,
          proofEnvelope: proof.proofEnvelope,
          publicSignals: proof.publicSignals,
          tokenURI: proof.tokenURI,
          coreInfo: proof.coreInfo,
        });

        if (mintResult.requiresEndorsement) {
          setShowEndorseConfirm(true);
          return;
        }

        const successfulResult = mintResult as Extract<
          ExecuteMintFlowResult,
          { requiresEndorsement: false }
        >;
        const tokenId = successfulResult.tokenId;

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
        console.error("Mint NFT failed:", sanitizeErrorForLogging(error));
        const friendly = getFriendlyError(error, t);
        setErrorResult({
          type: friendly.reason || friendly.type || "UNKNOWN_ERROR",
          message: friendly.message,
          details: friendly.details,
          retryable: friendly.retryable,
        });
      } finally {
        resetDisclosureProof();
      }
    },
    [
      address,
      allConsentsChecked,
      contract,
      didPatchCacheRef,
      generateDisclosureProof,
      hasTargetInputs,
      hasValidTarget,
      isAlreadyMinted,
      isEndorsed,
      markVersionMinted,
      onSuccess,
      personCalcRef,
      personInfo,
      resetDisclosureProof,
      runMintNftOrThrow,
      setConsentError,
      setErrorResult,
      setShowEndorseConfirm,
      setSuccessResult,
      t,
      targetPersonHash,
      targetSelfSuiteId,
      targetVersionIndex,
    ],
  );
}

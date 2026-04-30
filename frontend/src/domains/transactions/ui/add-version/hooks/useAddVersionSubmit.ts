import { useCallback, type MutableRefObject } from "react";
import type { PersonHashCalculatorHandle } from "../../../../person";
import { getFriendlyError, sanitizeErrorForLogging } from "../../../../../shared/lib/errors";
import { safeCanonicalizeFullName } from "../../../../../shared/crypto/identityCommitment";
import { addVersionSchema } from "../model/addVersionSchema";
import {
  buildAddVersionSuccessResultView,
  toAddVersionErrorResult,
} from "../model/addVersionResultView";
import type {
  AddVersionErrorResultView,
  AddVersionFormData,
  AddVersionFormInput,
  AddVersionResult,
  AddVersionSuccessResultView,
  AddVersionT,
  IdentityMaterial,
  IdentitySaltSelections,
} from "../model/addVersionTypes";

interface UseAddVersionSubmitArgs {
  t: AddVersionT;
  signer?: { getAddress: () => Promise<string> } | null;
  isContractReady: boolean;
  allConsentsChecked: boolean;
  personCalcRef: MutableRefObject<PersonHashCalculatorHandle | null>;
  resolveIdentitySaltSelections: () => IdentitySaltSelections;
  resolveIdentityMaterial: (
    calc: PersonHashCalculatorHandle | null,
    options?: { identityMode?: any; identitySaltHex?: string | null },
  ) => Promise<IdentityMaterial | null>;
  personIdentityMode: any;
  fatherCalcRef: MutableRefObject<PersonHashCalculatorHandle | null>;
  fatherIdentityMode: any;
  motherCalcRef: MutableRefObject<PersonHashCalculatorHandle | null>;
  motherIdentityMode: any;
  validateEncryptionPassword: () => boolean;
  resolveEncryptionPassword: () => string;
  prepareEncryptedMetadata: (
    tagValue: string,
    processedData: AddVersionFormData,
    password: string,
    identitySaltSelections: IdentitySaltSelections,
  ) => Promise<{ cid: string }>;
  generatePersonCommitmentProof: (args: {
    personData: IdentityMaterial["personData"];
    fatherData: IdentityMaterial["personData"] | null;
    motherData: IdentityMaterial["personData"] | null;
    submitterAddress: string;
  }) => Promise<{ proof: any; publicSignals: any }>;
  setProofGenerationStep: (value: string) => void;
  runAddVersionOrThrow: (args: {
    proof: any;
    publicSignals: any;
    fatherVersionIndex: number;
    motherVersionIndex: number;
    tag: string;
    metadataCID: string;
  }) => Promise<AddVersionResult>;
  setMetadataCid: (cid: string) => void;
  toastSuccess: (message: string) => void;
  toastError: (message: string) => void;
  invalidateByTx: (args: any) => void;
  onSuccess?: (result: any) => void;
  setConsentError: (value: string | null) => void;
  setErrorResult: (value: AddVersionErrorResultView | null) => void;
  setSuccessResult: (value: AddVersionSuccessResultView | null) => void;
  setIsSubmitting: (value: boolean) => void;
}

export function useAddVersionSubmit({
  t,
  signer,
  isContractReady,
  allConsentsChecked,
  personCalcRef,
  resolveIdentitySaltSelections,
  resolveIdentityMaterial,
  personIdentityMode,
  fatherCalcRef,
  fatherIdentityMode,
  motherCalcRef,
  motherIdentityMode,
  validateEncryptionPassword,
  resolveEncryptionPassword,
  prepareEncryptedMetadata,
  generatePersonCommitmentProof,
  setProofGenerationStep,
  runAddVersionOrThrow,
  setMetadataCid,
  toastSuccess,
  toastError,
  invalidateByTx,
  onSuccess,
  setConsentError,
  setErrorResult,
  setSuccessResult,
  setIsSubmitting,
}: UseAddVersionSubmitArgs) {
  return useCallback(
    async (data: AddVersionFormInput) => {
      if (!allConsentsChecked) {
        setConsentError(
          t(
            "addVersion.consentMissing",
            "Please confirm all required checkboxes before submitting",
          ),
        );
        return;
      }
      setConsentError(null);

      if (!signer || !isContractReady) {
        setErrorResult(
          toAddVersionErrorResult(
            "WALLET_NOT_CONNECTED",
            t("wallet.notConnected", "Please connect your wallet"),
          ),
        );
        return;
      }

      const processedData = addVersionSchema.parse(data);
      const personCalc = personCalcRef.current;
      const personPublic = personCalc?.getPublicFormData();
      const canonicalPersonFullName = safeCanonicalizeFullName(personPublic?.fullName || "");
      if (!personCalc || !personPublic || !canonicalPersonFullName) {
        setErrorResult(
          toAddVersionErrorResult(
            "PERSON_INFO_REQUIRED",
            t("addVersion.personInfoRequired", "Please fill in person information"),
          ),
        );
        return;
      }
      if (!validateEncryptionPassword()) {
        return;
      }

      setSuccessResult(null);
      setErrorResult(null);
      setIsSubmitting(true);
      setProofGenerationStep(t("addVersion.preparingData", "Preparing data..."));

      try {
        const submitterAddress = await signer.getAddress();
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

        const { proof, publicSignals } = await generatePersonCommitmentProof({
          personData: personIdentity.personData,
          fatherData: fatherIdentity?.personData ?? null,
          motherData: motherIdentity?.personData ?? null,
          submitterAddress,
        });

        setProofGenerationStep(t("addVersion.generatingMetadataCID", "Generating metadata CID..."));
        const { cid: metadataCID } = await prepareEncryptedMetadata(
          processedData.tag,
          processedData,
          resolveEncryptionPassword(),
          identitySaltSelections,
        );

        processedData.metadataCID = metadataCID;
        setMetadataCid(metadataCID);
        setProofGenerationStep(
          t("addVersion.submittingToBlockchain", "Submitting to blockchain..."),
        );

        const result = await runAddVersionOrThrow({
          proof,
          publicSignals,
          fatherVersionIndex: processedData.fatherVersionIndex,
          motherVersionIndex: processedData.motherVersionIndex,
          tag: processedData.tag,
          metadataCID: processedData.metadataCID || "",
        });

        toastSuccess(t("contract.addVersionSuccess", "Person version added successfully"));
        setSuccessResult(buildAddVersionSuccessResultView(result));
        setProofGenerationStep("");
        invalidateByTx({
          events: { PersonVersionAdded: result.events?.PersonVersionAdded || null },
          hints: { personHash: result.hash, versionIndex: result.index },
        });
        onSuccess?.(result);
      } catch (error) {
        console.error("Add version failed:", sanitizeErrorForLogging(error));
        const friendly = getFriendlyError(error, t);
        toastError(
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
    },
    [
      allConsentsChecked,
      fatherCalcRef,
      fatherIdentityMode,
      generatePersonCommitmentProof,
      invalidateByTx,
      isContractReady,
      motherCalcRef,
      motherIdentityMode,
      onSuccess,
      personCalcRef,
      personIdentityMode,
      prepareEncryptedMetadata,
      resolveEncryptionPassword,
      resolveIdentityMaterial,
      resolveIdentitySaltSelections,
      runAddVersionOrThrow,
      setConsentError,
      setErrorResult,
      setIsSubmitting,
      setMetadataCid,
      setProofGenerationStep,
      setSuccessResult,
      signer,
      t,
      toastError,
      toastSuccess,
      validateEncryptionPassword,
    ],
  );
}

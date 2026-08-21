import { ethers } from "ethers";
import { useCallback, type MutableRefObject } from "react";
import {
  ZERO_BYTES32,
  computeVersionHash,
  type MetadataContextInput,
  type PersonVersionMetadataInput,
} from "@deepfamily/protocol-core";
import type { PersonHashCalculatorHandle } from "../../../../person";
import {
  createDeepFamilyContract,
  createDeepFamilyReaderContract,
} from "../../../../../shared/clients/contractFactory";
import {
  cryptoWorkerCall,
  terminateCryptoWorkerIfIdle,
  type PreparedPersonVersionContentV1Result,
  type ValidatedPersonVersionV1Result,
} from "../../../../../shared/workers/cryptoWorkerClient";
import { terminateZkWorkerIfIdle } from "../../../../../shared/workers/zkWorkerClient";
import { getFriendlyError, sanitizeErrorForLogging } from "../../../../../shared/lib/errors";
import {
  makeNodeId,
  mergeValidatedMetadataUnlock,
  parseVersionDetailsResult,
  type NodeData,
} from "../../../../../shared/model";
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
} from "../model/addVersionTypes";

interface UseAddVersionSubmitArgs {
  t: AddVersionT;
  signer?: ethers.Signer | null;
  isContractReady: boolean;
  chainId: number;
  contractAddress: string;
  readerAddress: string;
  allConsentsChecked: boolean;
  personCalcRef: MutableRefObject<PersonHashCalculatorHandle | null>;
  fatherCalcRef: MutableRefObject<PersonHashCalculatorHandle | null>;
  motherCalcRef: MutableRefObject<PersonHashCalculatorHandle | null>;
  resolveIdentityMaterial: (
    calc: PersonHashCalculatorHandle | null,
  ) => Promise<IdentityMaterial | null>;
  buildMetadataPayload: (input: {
    processedData: AddVersionFormData;
    personIdentity: IdentityMaterial;
    fatherIdentity: IdentityMaterial | null;
    motherIdentity: IdentityMaterial | null;
  }) => PersonVersionMetadataInput;
  generatePersonCommitmentProof: (args: {
    personData: IdentityMaterial["personData"];
    fatherData: IdentityMaterial["personData"] | null;
    motherData: IdentityMaterial["personData"] | null;
    submitterAddress: string;
    contentDigestLo: string | bigint;
    contentDigestHi: string | bigint;
  }) => Promise<{ proof: any; publicSignals: any }>;
  setProofGenerationStep: (value: string) => void;
  runAddVersionOrThrow: (args: {
    proof: any;
    publicSignals: any;
    fatherVersionIndex: number;
    motherVersionIndex: number;
    metadataEnvelope: Uint8Array;
  }) => Promise<AddVersionResult>;
  cacheValidatedPersonVersion: (node: NodeData) => void;
  toastSuccess: (message: string) => void;
  toastError: (message: string) => void;
  invalidateByTx: (args: any) => void;
  onSuccess?: (result: any) => void;
  setConsentError: (value: string | null) => void;
  setErrorResult: (value: AddVersionErrorResultView | null) => void;
  setSuccessResult: (value: AddVersionSuccessResultView | null) => void;
  setIsSubmitting: (value: boolean) => void;
  submissionPackageRef: MutableRefObject<RetryableAddVersionSubmission | null>;
}

export interface RetryableAddVersionSubmission {
  draftKey: string;
  args: {
    proof: any;
    publicSignals: any;
    fatherVersionIndex: number;
    motherVersionIndex: number;
    metadataEnvelope: Uint8Array;
  };
  versionCommitment: bigint;
  payloadHash: string;
  validated: ValidatedPersonVersionV1Result;
  personHash: string;
  fatherHash: string;
  motherHash: string;
  submitterAddress: string;
  broadcastConfirmed: boolean;
}

function publicIdentitySnapshot(calc: PersonHashCalculatorHandle | null) {
  const value = calc?.getPublicFormData();
  if (!value?.fullName) return null;
  const { hasPassphrase: _hasPassphrase, ...identity } = value;
  return identity;
}

function buildDraftKey(input: {
  data: AddVersionFormData;
  person: PersonHashCalculatorHandle | null;
  father: PersonHashCalculatorHandle | null;
  mother: PersonHashCalculatorHandle | null;
}): string {
  return JSON.stringify({
    data: input.data,
    person: publicIdentitySnapshot(input.person),
    father: publicIdentitySnapshot(input.father),
    mother: publicIdentitySnapshot(input.mother),
  });
}

function isDefinitelyNotRetryable(error: unknown): boolean {
  const value = error && typeof error === "object" ? (error as Record<string, any>) : {};
  const code = value.code ?? value.error?.code;
  const reason = String(value.reason ?? value.shortMessage ?? value.message ?? "");
  return (
    code === 4001 ||
    code === "ACTION_REJECTED" ||
    code === "INSUFFICIENT_FUNDS" ||
    code === "CALL_EXCEPTION" ||
    code === "TRANSACTION_RECONCILIATION_MISMATCH" ||
    reason.includes("DuplicateVersionCommitment")
  );
}

function sameHex(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function duplicateVersionError(): Error {
  return Object.assign(new Error("DuplicateVersionCommitment"), {
    reason: "DuplicateVersionCommitment",
    __dfDecodedReason: "DuplicateVersionCommitment",
  });
}

async function verifyConfirmedVersion(input: {
  signer: ethers.Signer;
  contractAddress: string;
  readerAddress: string;
  result: AddVersionResult;
  expectedVersionCommitment: bigint;
  expectedPayloadHash: string;
}) {
  const deepFamily = createDeepFamilyContract(input.contractAddress, input.signer);
  const reader = createDeepFamilyReaderContract(input.readerAddress, input.signer);
  const [configuredArchive, readerDeepFamily, readerArchive, rawDetails] = await Promise.all([
    deepFamily.metadataArchive(),
    reader.DEEP_FAMILY(),
    reader.METADATA_ARCHIVE(),
    reader.getVersionDetails(input.result.hash, input.result.index),
  ]);
  if (!sameHex(configuredArchive, readerArchive) || !sameHex(readerDeepFamily, input.contractAddress)) {
    throw new Error("Reader and DeepFamily metadata archive binding mismatch after confirmation");
  }
  const details = parseVersionDetailsResult(rawDetails);
  if (details.version.versionCommitment !== input.expectedVersionCommitment.toString()) {
    throw new Error("Confirmed versionCommitment does not match the prepared submission");
  }
  if (!sameHex(details.metadata.payloadHash, input.expectedPayloadHash)) {
    throw new Error("Confirmed metadata payloadHash does not match the prepared envelope");
  }
  if (!details.metadata.pointer || !Number.isInteger(details.metadata.payloadLength)) {
    throw new Error("Confirmed metadata reference is incomplete");
  }
  return details;
}

export function useAddVersionSubmit({
  t,
  signer,
  isContractReady,
  chainId,
  contractAddress,
  readerAddress,
  allConsentsChecked,
  personCalcRef,
  fatherCalcRef,
  motherCalcRef,
  resolveIdentityMaterial,
  buildMetadataPayload,
  generatePersonCommitmentProof,
  setProofGenerationStep,
  runAddVersionOrThrow,
  cacheValidatedPersonVersion,
  toastSuccess,
  toastError,
  invalidateByTx,
  onSuccess,
  setConsentError,
  setErrorResult,
  setSuccessResult,
  setIsSubmitting,
  submissionPackageRef,
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

      if (!signer || !isContractReady || !contractAddress || !readerAddress || chainId <= 0) {
        setErrorResult(
          toAddVersionErrorResult(
            "WALLET_NOT_CONNECTED",
            t("wallet.notConnected", "Please connect a supported wallet and network"),
          ),
        );
        return;
      }

      const processedData = addVersionSchema.parse(data);
      if (!personCalcRef.current?.getPublicFormData().fullName) {
        setErrorResult(
          toAddVersionErrorResult(
            "PERSON_INFO_REQUIRED",
            t("addVersion.personInfoRequired", "Please fill in person information"),
          ),
        );
        return;
      }
      const draftKey = buildDraftKey({
        data: processedData,
        person: personCalcRef.current,
        father: fatherCalcRef.current,
        mother: motherCalcRef.current,
      });

      setSuccessResult(null);
      setErrorResult(null);
      setIsSubmitting(true);
      setProofGenerationStep(
        submissionPackageRef.current
          ? t("addVersion.reusingSubmission", "Reusing the previously verified submission package...")
          : t("addVersion.preparingData", "Deriving identity material..."),
      );

      let rawPassphrase = "";
      let personIdentity: IdentityMaterial | null = null;
      let fatherIdentity: IdentityMaterial | null = null;
      let motherIdentity: IdentityMaterial | null = null;
      let prepared: PreparedPersonVersionContentV1Result | null = null;
      let cryptoWorkStarted = false;
      let zkWorkStarted = false;
      let cryptoWorkerReleased = false;
      let zkWorkerReleased = false;

      const submitPrepared = async (submission: RetryableAddVersionSubmission) => {
        setProofGenerationStep(
          t(
            "addVersion.submittingToBlockchain",
            `Submitting ${submission.args.metadataEnvelope.length}-byte envelope to blockchain...`,
          ),
        );
        const result = await runAddVersionOrThrow(submission.args);
        // A receipt now proves this exact package is on-chain. Never retry it,
        // even if a subsequent Reader/cache check fails.
        submission.broadcastConfirmed = true;

        const confirmed = await verifyConfirmedVersion({
          signer,
          contractAddress,
          readerAddress,
          result,
          expectedVersionCommitment: submission.versionCommitment,
          expectedPayloadHash: submission.payloadHash,
        });
        const anchors = {
          personHash: result.hash,
          versionIndex: result.index,
          versionCommitment: submission.versionCommitment.toString(),
          metadataPointer: confirmed.metadata.pointer!,
          metadataPayloadHash: confirmed.metadata.payloadHash!,
          metadataPayloadLength: confirmed.metadata.payloadLength!,
        };
        const versionEvent = result.events.PersonVersionAdded;
        const baseNode: NodeData = {
          id: makeNodeId(result.hash, result.index),
          ...anchors,
          fatherHash: versionEvent?.fatherHash ?? submission.fatherHash,
          motherHash: versionEvent?.motherHash ?? submission.motherHash,
          fatherVersionIndex:
            versionEvent?.fatherVersionIndex ?? submission.args.fatherVersionIndex,
          motherVersionIndex:
            versionEvent?.motherVersionIndex ?? submission.args.motherVersionIndex,
          addedBy: versionEvent?.addedBy ?? submission.submitterAddress,
          timestamp: versionEvent?.timestamp,
          tokenId: "0",
        };
        const node = mergeValidatedMetadataUnlock(baseNode, anchors, {
          person: submission.validated.metadata.person,
          parents: submission.validated.metadata.parents,
          tag: submission.validated.metadata.tag,
          biography: submission.validated.metadata.biography,
          formatVersion: submission.validated.formatVersion,
          identitySuiteId: submission.validated.identitySuiteId,
        });
        cacheValidatedPersonVersion(node);
        submissionPackageRef.current = null;

        toastSuccess(t("contract.addVersionSuccess", "Person version added successfully"));
        setSuccessResult(buildAddVersionSuccessResultView(result));
        setProofGenerationStep("");
        invalidateByTx({
          events: { PersonVersionAdded: result.events?.PersonVersionAdded || null },
          hints: { personHash: result.hash, versionIndex: result.index },
        });
        onSuccess?.(result);
      };

      try {
        const existingSubmission = submissionPackageRef.current;
        if (existingSubmission) {
          if (existingSubmission.draftKey !== draftKey) {
            submissionPackageRef.current = null;
            throw new Error(
              t(
                "addVersion.changedAfterPreparation",
                "The version content changed after preparation. Re-enter the identity passphrases and submit again to build a new proof and envelope.",
              ),
            );
          }
          await submitPrepared(existingSubmission);
          return;
        }

        const submitterAddress = await signer.getAddress();

        // Application-level KDF concurrency is deliberately one: each awaited
        // identity job finishes before the next role is sent to the worker.
        cryptoWorkStarted = true;
        personIdentity = await resolveIdentityMaterial(personCalcRef.current);
        if (!personIdentity) {
          throw new Error(t("addVersion.personInfoRequired", "Please fill in person information"));
        }
        fatherIdentity = await resolveIdentityMaterial(fatherCalcRef.current);
        motherIdentity = await resolveIdentityMaterial(motherCalcRef.current);
        if (!fatherIdentity && processedData.fatherVersionIndex !== 0) {
          throw new Error("A father version index requires complete father identity fields");
        }
        if (!motherIdentity && processedData.motherVersionIndex !== 0) {
          throw new Error("A mother version index requires complete mother identity fields");
        }

        rawPassphrase = personCalcRef.current?.getSecretInputs().passphrase ?? "";
        const metadata = buildMetadataPayload({
          processedData,
          personIdentity,
          fatherIdentity,
          motherIdentity,
        });
        prepared = await cryptoWorkerCall(
          "preparePersonVersionContentV1",
          {
            metadata,
            derivedSecretField: personIdentity.derivedSecretField.toString(),
          },
          { timeoutMs: 120_000 },
        );
        const versionCommitment = BigInt(prepared.versionCommitment);
        const fatherHash = fatherIdentity?.personHash ?? ZERO_BYTES32;
        const motherHash = motherIdentity?.personHash ?? ZERO_BYTES32;
        const versionHash = computeVersionHash({
          personHash: personIdentity.personHash,
          fatherHash,
          fatherVersionIndex: processedData.fatherVersionIndex,
          motherHash,
          motherVersionIndex: processedData.motherVersionIndex,
          versionCommitment,
        });

        // This public commitment preflight happens before compression, Groth16,
        // or file encryption so random re-encryption cannot waste proof work.
        const deepFamily = createDeepFamilyContract(contractAddress, signer);
        if (await deepFamily.versionExists(personIdentity.personHash, versionHash)) {
          throw duplicateVersionError();
        }

        const context: MetadataContextInput = {
          chainId,
          deepFamilyProxy: contractAddress,
          personHash: personIdentity.personHash,
          fatherHash,
          fatherVersionIndex: processedData.fatherVersionIndex,
          motherHash,
          motherVersionIndex: processedData.motherVersionIndex,
          versionCommitment,
        };

        zkWorkStarted = true;
        const { proof, publicSignals } = await generatePersonCommitmentProof({
          personData: personIdentity.personData,
          fatherData: fatherIdentity?.personData ?? null,
          motherData: motherIdentity?.personData ?? null,
          submitterAddress,
          contentDigestLo: prepared.contentDigestLo,
          contentDigestHi: prepared.contentDigestHi,
        });
        if (BigInt(publicSignals.versionCommitment) !== versionCommitment) {
          throw new Error("Relation proof versionCommitment does not match canonical metadata");
        }

        setProofGenerationStep(t("addVersion.encryptingMetadata", "Encrypting metadata..."));
        const encrypted = await cryptoWorkerCall(
          "encryptPersonVersionEnvelopeV1",
          {
            metadata,
            rawPassphrase,
            identitySuiteId: personIdentity.identitySuiteId,
            context,
          },
          { timeoutMs: 240_000 },
        );
        const validated = await cryptoWorkerCall(
          "roundTripPersonVersionEnvelopeV1",
          {
            envelopeHex: encrypted.envelopeHex,
            rawPassphrase,
            context,
            expectedMetadata: metadata,
            submitterAndSelfSuiteId: publicSignals.submitterAndSelfSuiteId.toString(),
            expectedSubmitter: submitterAddress,
          },
          { timeoutMs: 300_000 },
        );
        if (
          validated.versionCommitment !== versionCommitment.toString() ||
          !sameHex(validated.payloadHash, encrypted.payloadHash)
        ) {
          throw new Error("Local production decoder round-trip did not reproduce the submission");
        }

        // Freeze the exact public transaction material before clearing secrets.
        // RPC timeout/re-sign/replacement retries reuse this same package and
        // therefore never rerun KDF, proving, compression, or encryption.
        const submission: RetryableAddVersionSubmission = {
          draftKey,
          args: {
            proof,
            publicSignals,
            fatherVersionIndex: processedData.fatherVersionIndex,
            motherVersionIndex: processedData.motherVersionIndex,
            metadataEnvelope: ethers.getBytes(encrypted.envelopeHex),
          },
          versionCommitment,
          payloadHash: encrypted.payloadHash,
          validated,
          personHash: personIdentity.personHash,
          fatherHash,
          motherHash,
          submitterAddress,
          broadcastConfirmed: false,
        };
        submissionPackageRef.current = submission;

        // From this point only the immutable public package and a separately
        // validated display DTO remain reachable. Clear every secret input
        // element before any wallet or RPC wait.
        rawPassphrase = "";
        personCalcRef.current?.clearSecretInputs();
        fatherCalcRef.current?.clearSecretInputs();
        motherCalcRef.current?.clearSecretInputs();
        personIdentity = null;
        fatherIdentity = null;
        motherIdentity = null;
        prepared = null;
        cryptoWorkerReleased = terminateCryptoWorkerIfIdle();
        zkWorkerReleased = terminateZkWorkerIfIdle();
        await submitPrepared(submission);
      } catch (error) {
        const retained = submissionPackageRef.current;
        if (retained?.broadcastConfirmed || isDefinitelyNotRetryable(error)) {
          submissionPackageRef.current = null;
        }
        console.error("Add version failed:", sanitizeErrorForLogging(error));
        const friendly = getFriendlyError(error, t);
        toastError(
          t("contract.addVersionFailed", "Failed to add person version") + ": " + friendly.message,
        );
        setErrorResult({
          type: friendly.type || "UNKNOWN_ERROR",
          message: friendly.message,
          details: friendly.details,
          retryable: friendly.retryable,
        });
        setProofGenerationStep("");
      } finally {
        rawPassphrase = "";
        personIdentity = null;
        fatherIdentity = null;
        motherIdentity = null;
        prepared = null;
        if (cryptoWorkStarted && !cryptoWorkerReleased) terminateCryptoWorkerIfIdle();
        if (zkWorkStarted && !zkWorkerReleased) terminateZkWorkerIfIdle();
        setIsSubmitting(false);
      }
    },
    [
      allConsentsChecked,
      buildMetadataPayload,
      cacheValidatedPersonVersion,
      chainId,
      contractAddress,
      fatherCalcRef,
      generatePersonCommitmentProof,
      invalidateByTx,
      isContractReady,
      motherCalcRef,
      onSuccess,
      personCalcRef,
      readerAddress,
      resolveIdentityMaterial,
      runAddVersionOrThrow,
      setConsentError,
      setErrorResult,
      setIsSubmitting,
      setProofGenerationStep,
      setSuccessResult,
      signer,
      submissionPackageRef,
      t,
      toastError,
      toastSuccess,
    ],
  );
}

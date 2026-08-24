import { ethers } from "ethers";
import { useCallback, useRef, type MutableRefObject } from "react";
import {
  DFM1_MAX_ENVELOPE_BYTES,
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
import { getReadonlyProvider } from "../../../../../shared/clients/providerRegistry";
import {
  cryptoWorkerCall,
  terminateCryptoWorkerIfIdle,
  type EncryptedPersonVersionEnvelopeV1Result,
  type PreparedPersonVersionContentV1Result,
  type ValidatedPersonVersionV1Result,
} from "../../../../../shared/workers/cryptoWorkerClient";
import { terminateZkWorkerIfIdle } from "../../../../../shared/workers/zkWorkerClient";
import { getFriendlyError, sanitizeErrorForLogging } from "../../../../../shared/lib/errors";
import type { ProofEnvelope } from "../../../../../shared/zk/zk";
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
import {
  ADD_VERSION_SCOPE_CHANGED,
  addVersionScopeChangedError,
  assertAddVersionTransactionScope,
  createAddVersionTransactionScope,
  type AddVersionTransactionScope,
} from "../model/addVersionTransactionScope";
import type {
  AddVersionErrorResultView,
  AddVersionFormData,
  AddVersionFormInput,
  AddVersionPublicSignals,
  AddVersionResult,
  AddVersionSuccessResultView,
  AddVersionT,
  IdentityMaterial,
} from "../model/addVersionTypes";

interface UseAddVersionSubmitArgs {
  t: AddVersionT;
  signer?: ethers.Signer | null;
  isContractReady: boolean;
  rpcUrl: string;
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
  }) => Promise<{ proof: ProofEnvelope; publicSignals: AddVersionPublicSignals }>;
  setProofGenerationStep: (value: string) => void;
  runAddVersionOrThrow: (args: {
    proof: ProofEnvelope;
    publicSignals: AddVersionPublicSignals;
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
  scope: AddVersionTransactionScope;
  confirmationRpcUrl: string;
  args: {
    proof: ProofEnvelope;
    publicSignals: AddVersionPublicSignals;
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
  broadcastConfirmed: boolean;
}

function copyProofEnvelope(value: ProofEnvelope): ProofEnvelope {
  return {
    circuitId: value.circuitId,
    proofEncodingId: value.proofEncodingId,
    proofData: value.proofData,
  };
}

function copyAddVersionPublicSignals(value: AddVersionPublicSignals): AddVersionPublicSignals {
  return {
    identityCommitment: value.identityCommitment,
    fatherIdentityCommitment: value.fatherIdentityCommitment,
    motherIdentityCommitment: value.motherIdentityCommitment,
    submitterAndSelfSuiteId: value.submitterAndSelfSuiteId,
    versionCommitment: value.versionCommitment,
  };
}

function copyValidatedPersonVersion(
  value: ValidatedPersonVersionV1Result,
): ValidatedPersonVersionV1Result {
  const copyPerson = (person: ValidatedPersonVersionV1Result["metadata"]["person"]) => ({
    fullName: person.fullName,
    gender: person.gender,
    birthYear: person.birthYear,
    birthMonth: person.birthMonth,
    birthDay: person.birthDay,
    isBirthBC: person.isBirthBC,
    personHash: person.personHash,
  });
  const copyParent = (parent: ValidatedPersonVersionV1Result["metadata"]["parents"]["father"]) =>
    parent === null
      ? null
      : {
          ...copyPerson(parent),
          versionIndex: parent.versionIndex,
        };

  // Treat Worker responses as an untrusted runtime boundary even though their
  // TypeScript shape is narrow. Retain an explicit DTO so future diagnostic or
  // crypto fields cannot silently join a retryable transaction package.
  return {
    metadata: {
      schema: value.metadata.schema,
      person: copyPerson(value.metadata.person),
      parents: {
        father: copyParent(value.metadata.parents.father),
        mother: copyParent(value.metadata.parents.mother),
      },
      tag: value.metadata.tag,
      biography: value.metadata.biography,
    },
    formatVersion: value.formatVersion,
    identitySuiteId: value.identitySuiteId,
    payloadHash: value.payloadHash,
    versionCommitment: value.versionCommitment,
    metadataUnlockValidated: true,
    protocolGeneration: value.protocolGeneration,
  };
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
  if (value.transactionReconciliationFinal === true) return true;
  const code = value.code ?? value.error?.code;
  const reason = String(value.reason ?? value.shortMessage ?? value.message ?? "");
  return (
    code === 4001 ||
    code === "ACTION_REJECTED" ||
    code === "INSUFFICIENT_FUNDS" ||
    code === "CALL_EXCEPTION" ||
    code === ADD_VERSION_SCOPE_CHANGED ||
    code === "ADD_VERSION_PREVIEW_REJECTED" ||
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
  runner: ethers.ContractRunner;
  contractAddress: string;
  readerAddress: string;
  result: AddVersionResult;
  expectedVersionCommitment: bigint;
  expectedPayloadHash: string;
}) {
  const deepFamily = createDeepFamilyContract(input.contractAddress, input.runner);
  const reader = createDeepFamilyReaderContract(input.readerAddress, input.runner);
  const [configuredArchive, readerDeepFamily, readerArchive, rawDetails] = await Promise.all([
    deepFamily.metadataArchive(),
    reader.DEEP_FAMILY(),
    reader.METADATA_ARCHIVE(),
    reader.getVersionDetails(input.result.hash, input.result.index),
  ]);
  if (
    !sameHex(configuredArchive, readerArchive) ||
    !sameHex(readerDeepFamily, input.contractAddress)
  ) {
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
  rpcUrl,
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
  const latestRuntimeScopeRef = useRef({
    signer,
    chainId,
    contractAddress,
    readerAddress,
  });
  latestRuntimeScopeRef.current = { signer, chainId, contractAddress, readerAddress };

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

      if (
        !signer ||
        !isContractReady ||
        !rpcUrl ||
        !contractAddress ||
        !readerAddress ||
        chainId <= 0
      ) {
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
          ? t(
              "addVersion.reusingSubmission",
              "Reusing the previously verified submission package...",
            )
          : t("addVersion.preparingData", "Deriving identity material..."),
      );

      let rawPassphrase = "";
      let personIdentity: IdentityMaterial | null = null;
      let fatherIdentity: IdentityMaterial | null = null;
      let motherIdentity: IdentityMaterial | null = null;
      let prepared: PreparedPersonVersionContentV1Result | null = null;
      let encrypted: EncryptedPersonVersionEnvelopeV1Result | null = null;
      let validatedWorkerResult: ValidatedPersonVersionV1Result | null = null;
      let cryptoWorkStarted = false;
      let zkWorkStarted = false;
      let cryptoWorkerReleased = false;
      let zkWorkerReleased = false;

      const submitPrepared = async (submission: RetryableAddVersionSubmission) => {
        const assertCurrentScope = async () => {
          const current = latestRuntimeScopeRef.current;
          if (!current.signer) throw addVersionScopeChangedError();
          await assertAddVersionTransactionScope({
            expected: submission.scope,
            chainId: current.chainId,
            contractAddress: current.contractAddress,
            readerAddress: current.readerAddress,
            signer: current.signer,
          });
        };

        await assertCurrentScope();
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
        await assertCurrentScope();

        const confirmationProvider = getReadonlyProvider(
          submission.confirmationRpcUrl,
          submission.scope.chainId,
        );
        const confirmed = await verifyConfirmedVersion({
          runner: confirmationProvider,
          contractAddress: submission.scope.contractAddress,
          readerAddress: submission.scope.readerAddress,
          result,
          expectedVersionCommitment: submission.versionCommitment,
          expectedPayloadHash: submission.payloadHash,
        });
        await assertCurrentScope();
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
          addedBy: versionEvent?.addedBy ?? submission.scope.submitterAddress,
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
        await assertCurrentScope();
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
        const scope = createAddVersionTransactionScope({
          chainId,
          contractAddress,
          readerAddress,
          submitterAddress,
        });

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
        const deepFamily = createDeepFamilyContract(scope.contractAddress, signer);
        if (await deepFamily.versionExists(personIdentity.personHash, versionHash)) {
          throw duplicateVersionError();
        }

        const context: MetadataContextInput = {
          chainId: scope.chainId,
          deepFamilyProxy: scope.contractAddress,
          personHash: personIdentity.personHash,
          fatherHash,
          fatherVersionIndex: processedData.fatherVersionIndex,
          motherHash,
          motherVersionIndex: processedData.motherVersionIndex,
          versionCommitment,
        };

        const sizePreflight = await cryptoWorkerCall(
          "preflightPersonVersionEnvelopeSizeV1",
          { metadata },
          { timeoutMs: 120_000 },
        );
        setProofGenerationStep(
          t(
            "addVersion.metadataSizeReady",
            `Metadata fits in an exact ${sizePreflight.envelopeLength}-byte envelope.`,
          ),
        );

        zkWorkStarted = true;
        const { proof, publicSignals } = await generatePersonCommitmentProof({
          personData: personIdentity.personData,
          fatherData: fatherIdentity?.personData ?? null,
          motherData: motherIdentity?.personData ?? null,
          submitterAddress: scope.submitterAddress,
          contentDigestLo: prepared.contentDigestLo,
          contentDigestHi: prepared.contentDigestHi,
        }).then((generated) => ({
          proof: copyProofEnvelope(generated.proof),
          publicSignals: copyAddVersionPublicSignals(generated.publicSignals),
        }));
        if (BigInt(publicSignals.versionCommitment) !== versionCommitment) {
          throw new Error("Relation proof versionCommitment does not match canonical metadata");
        }

        setProofGenerationStep(t("addVersion.encryptingMetadata", "Encrypting metadata..."));
        encrypted = await cryptoWorkerCall(
          "encryptPersonVersionEnvelopeV1",
          {
            metadata,
            rawPassphrase,
            identitySuiteId: personIdentity.identitySuiteId,
            context,
          },
          { timeoutMs: 240_000 },
        );
        const metadataEnvelope = ethers.getBytes(encrypted.envelopeHex);
        if (
          metadataEnvelope.length > DFM1_MAX_ENVELOPE_BYTES ||
          metadataEnvelope.length !== encrypted.envelopeLength ||
          encrypted.canonicalJsonLength !== sizePreflight.canonicalJsonLength ||
          encrypted.envelopeLength !== sizePreflight.envelopeLength ||
          encrypted.compressedPlaintextLength !== sizePreflight.compressedPlaintextLength
        ) {
          throw new Error("Encrypted envelope length differs from deterministic size preflight");
        }
        validatedWorkerResult = await cryptoWorkerCall(
          "roundTripPersonVersionEnvelopeV1",
          {
            envelopeHex: encrypted.envelopeHex,
            rawPassphrase,
            context,
            expectedMetadata: metadata,
            submitterAndSelfSuiteId: publicSignals.submitterAndSelfSuiteId.toString(),
            expectedSubmitter: scope.submitterAddress,
          },
          { timeoutMs: 300_000 },
        );
        if (
          validatedWorkerResult.versionCommitment !== versionCommitment.toString() ||
          !sameHex(validatedWorkerResult.payloadHash, encrypted.payloadHash)
        ) {
          throw new Error("Local production decoder round-trip did not reproduce the submission");
        }
        const validated = copyValidatedPersonVersion(validatedWorkerResult);
        const payloadHash = encrypted.payloadHash;

        // Neither result shape is allowed to flow into retry state wholesale.
        // The retained package below uses only explicit ciphertext/public
        // fields and the projected validated display DTO.
        encrypted = null;
        validatedWorkerResult = null;

        // Freeze the exact public transaction material before clearing secrets.
        // RPC timeout/re-sign/replacement retries reuse this same package and
        // therefore never rerun KDF, proving, compression, or encryption.
        const submission: RetryableAddVersionSubmission = {
          draftKey,
          scope,
          confirmationRpcUrl: rpcUrl,
          args: {
            proof,
            publicSignals,
            fatherVersionIndex: processedData.fatherVersionIndex,
            motherVersionIndex: processedData.motherVersionIndex,
            metadataEnvelope,
          },
          versionCommitment,
          payloadHash,
          validated,
          personHash: personIdentity.personHash,
          fatherHash,
          motherHash,
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
        encrypted = null;
        validatedWorkerResult = null;
        cryptoWorkerReleased = terminateCryptoWorkerIfIdle();
        zkWorkerReleased = terminateZkWorkerIfIdle();
        await submitPrepared(submission);
      } catch (error) {
        const retained = submissionPackageRef.current;
        if (retained?.broadcastConfirmed || isDefinitelyNotRetryable(error)) {
          submissionPackageRef.current = null;
        }
        if ((error as any)?.code === "ADD_VERSION_PREVIEW_REJECTED") {
          setProofGenerationStep("");
          return;
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
        encrypted = null;
        validatedWorkerResult = null;
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
      rpcUrl,
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

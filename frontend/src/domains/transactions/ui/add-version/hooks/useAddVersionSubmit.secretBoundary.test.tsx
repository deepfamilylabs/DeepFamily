// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAddVersionSubmit, type RetryableAddVersionSubmission } from "./useAddVersionSubmit";
import { addVersionSchema } from "../model/addVersionSchema";
import { createAddVersionTransactionScope } from "../model/addVersionTransactionScope";

const PERSON_HASH = `0x${"ab".repeat(32)}`;
const ZERO_HASH = `0x${"00".repeat(32)}`;
const SUBMITTER = "0x00000000000000000000000000000000000000aa";
const CONTRACT = "0x0000000000000000000000000000000000000abc";
const READER = "0x0000000000000000000000000000000000000def";
const ARCHIVE = "0x0000000000000000000000000000000000000acd";
const POINTER = "0x0000000000000000000000000000000000000b10";
const PAYLOAD_HASH = `0x${"44".repeat(32)}`;
const ENVELOPE_HEX = `0x${"44".repeat(20)}`;
const VERSION_COMMITMENT = 998877665544332211n;

const secrets = {
  rawPassphrase: "raw-passphrase-\u00e9-sentinel-7f43",
  nfkdPassphrase: "raw-passphrase-e\u0301-sentinel-7f43",
  identityPasswordInputHex: "identity-password-input-2718281828",
  filePasswordInputHex: "file-password-input-3141592653",
  identitySaltHex: "identity-salt-1618033988",
  fileSaltHex: "file-salt-1414213562",
  derivedSecretHex: "derived-secret-bytes-2236067977",
  derivedSecretField: "918273645546372819",
  roleWitness: "role-witness-1732050807",
  proverWitness: "prover-witness-2449489742",
  kekHex: "kek-2645751311",
  dekHex: "dek-3162277660",
  contentDigest: "content-digest-3316624790",
  contentDigestLo: "717273747576777879",
  contentDigestHi: "818283848586878889",
} as const;

const forbiddenKeys = [
  "rawPassphrase",
  "normalizedPassphrase",
  "identityPasswordInput",
  "identityPasswordInputHex",
  "filePasswordInput",
  "filePasswordInputHex",
  "identitySalt",
  "identitySaltHex",
  "derivedSecretBytes",
  "derivedSecretHex",
  "derivedSecretField",
  "roleWitness",
  "proverWitness",
  "witness",
  "kek",
  "kekHex",
  "dek",
  "dekHex",
  "contentDigest",
  "contentDigestBytes",
  "contentDigestLo",
  "contentDigestHi",
] as const;

function serializeForSecretAudit(value: unknown): string {
  return JSON.stringify(value, (_key, current) =>
    typeof current === "bigint" ? current.toString() : current,
  );
}

function expectNoSecretSentinels(value: unknown): void {
  const serialized = serializeForSecretAudit(value);
  for (const [name, sentinel] of Object.entries(secrets)) {
    expect(serialized, `leaked ${name}`).not.toContain(sentinel);
  }
  for (const key of forbiddenKeys) {
    expect(serialized, `retained forbidden key ${key}`).not.toContain(`"${key}"`);
  }
}

const mocks = vi.hoisted(() => ({
  settleTransaction: vi.fn(),
  cryptoWorkerCall: vi.fn(),
  terminateCryptoWorkerIfIdle: vi.fn(() => true),
  terminateZkWorkerIfIdle: vi.fn(() => true),
  deepFamily: {
    versionExists: vi.fn(),
    archive: vi.fn(),
  },
  reader: {
    DEEP_FAMILY: vi.fn(),
    ARCHIVE: vi.fn(),
    getVersionDetails: vi.fn(),
  },
}));

vi.mock("../../../../../shared/workers/cryptoWorkerClient", () => ({
  cryptoWorkerCall: (...args: unknown[]) => mocks.cryptoWorkerCall(...args),
  terminateCryptoWorkerIfIdle: () => mocks.terminateCryptoWorkerIfIdle(),
}));

vi.mock("../../../../../shared/workers/zkWorkerClient", () => ({
  terminateZkWorkerIfIdle: () => mocks.terminateZkWorkerIfIdle(),
}));

vi.mock("../../../../../shared/clients/contractFactory", () => ({
  createDeepFamilyContract: () => mocks.deepFamily,
  createDeepFamilyReaderContract: () => mocks.reader,
}));

describe("AddVersion secret-state boundary", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    mocks.terminateCryptoWorkerIfIdle.mockReturnValue(true);
    mocks.terminateZkWorkerIfIdle.mockReturnValue(true);
    mocks.deepFamily.versionExists.mockResolvedValue(false);
    mocks.deepFamily.archive.mockResolvedValue(ARCHIVE);
    mocks.reader.DEEP_FAMILY.mockResolvedValue(CONTRACT);
    mocks.reader.ARCHIVE.mockResolvedValue(ARCHIVE);
    mocks.reader.getVersionDetails.mockResolvedValue([
      {
        personHash: PERSON_HASH,
        fatherHash: ZERO_HASH,
        motherHash: ZERO_HASH,
        versionIndex: 1n,
        fatherVersionIndex: 0n,
        motherVersionIndex: 0n,
        versionCommitment: VERSION_COMMITMENT,
        addedBy: SUBMITTER,
        timestamp: 123n,
      },
      { pointer: POINTER, payloadHash: PAYLOAD_HASH, segmentCount: 1n, payloadLength: 20n },
      0n,
      0n,
    ]);

    mocks.cryptoWorkerCall.mockImplementation((method: string) => {
      if (method === "preparePersonVersionContentV1") {
        return Promise.resolve({
          canonicalJsonLength: 200,
          contentDigestLo: secrets.contentDigestLo,
          contentDigestHi: secrets.contentDigestHi,
          versionCommitment: VERSION_COMMITMENT.toString(),
          contentDigest: secrets.contentDigest,
          contentDigestBytes: secrets.contentDigest,
          proverWitness: secrets.proverWitness,
        });
      }
      if (method === "preflightPersonVersionEnvelopeSizeV1") {
        return Promise.resolve({
          canonicalJsonLength: 200,
          compressedPlaintextLength: 100,
          envelopeLength: 20,
        });
      }
      if (method === "encryptPersonVersionEnvelopeV1") {
        return Promise.resolve({
          envelopeHex: ENVELOPE_HEX,
          payloadHash: PAYLOAD_HASH,
          formatVersion: 1,
          identitySuiteId: 1,
          envelopeLength: 20,
          canonicalJsonLength: 200,
          compressedPlaintextLength: 100,
          identityPasswordInputHex: secrets.identityPasswordInputHex,
          filePasswordInputHex: secrets.filePasswordInputHex,
          identitySaltHex: secrets.identitySaltHex,
          fileSaltHex: secrets.fileSaltHex,
          derivedSecretHex: secrets.derivedSecretHex,
          kekHex: secrets.kekHex,
          dekHex: secrets.dekHex,
        });
      }
      if (method === "roundTripPersonVersionEnvelopeV1") {
        return Promise.resolve({
          metadata: {
            schema: "deepfamily/person-version@1.0",
            person: {
              fullName: "Ada Lovelace",
              gender: 2,
              birthYear: 1815,
              birthMonth: 12,
              birthDay: 10,
              isBirthBC: false,
              personHash: PERSON_HASH,
            },
            parents: { father: null, mother: null },
            tag: "private revision",
            biography: "encrypted biography",
          },
          formatVersion: 1,
          identitySuiteId: 1,
          payloadHash: PAYLOAD_HASH,
          versionCommitment: VERSION_COMMITMENT.toString(),
          metadataUnlockValidated: true,
          protocolGeneration: "df-onchain-biography-v1",
          rawPassphrase: secrets.rawPassphrase,
          normalizedPassphrase: secrets.nfkdPassphrase,
          identitySaltHex: secrets.identitySaltHex,
          derivedSecretField: secrets.derivedSecretField,
          roleWitness: secrets.roleWitness,
          kekHex: secrets.kekHex,
          dekHex: secrets.dekHex,
          contentDigest: secrets.contentDigest,
        });
      }
      return Promise.reject(new Error(`unexpected crypto method ${method}`));
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each([
    {
      name: "an uncertain send",
      error: new Error("uncertain RPC timeout after broadcast"),
      lifecycle: "foreground",
    },
    {
      name: "a cancelled preview",
      error: Object.assign(new Error("preview cancelled"), {
        code: "ADD_VERSION_PREVIEW_REJECTED",
      }),
      lifecycle: "foreground",
    },
    {
      name: "a rejected wallet request",
      error: Object.assign(new Error("wallet rejected"), { code: "ACTION_REJECTED" }),
      lifecycle: "foreground",
    },
    {
      name: "an EIP-1193 wallet rejection",
      error: Object.assign(new Error("wallet rejected"), { code: 4001 }),
      lifecycle: "foreground",
    },
    {
      name: "an uncertain send followed by ordinary close and reopening",
      error: new Error("RPC timeout"),
      lifecycle: "closed",
    },
    {
      name: "an uncertain send followed by unmounting",
      error: new Error("RPC timeout"),
      lifecycle: "unmounted",
    },
  ])(
    "retries the exact ciphertext/public package after $name and caches no secret",
    async ({ error, lifecycle }) => {
      let secretInput: string = secrets.rawPassphrase;
      const clearSecretInputs = vi.fn(() => {
        secretInput = "";
      });
      const calculator = {
        getPublicFormData: () => ({
          fullName: "Ada Lovelace",
          gender: 2,
          birthYear: 1815,
          birthMonth: 12,
          birthDay: 10,
          isBirthBC: false,
          hasPassphrase: true,
        }),
        getSecretInputs: () => ({ passphrase: secretInput }),
        clearSecretInputs,
      } as any;
      const personCalcRef = { current: calculator };
      const fatherCalcRef = { current: null };
      const motherCalcRef = { current: null };
      const submissionPackageRef = {
        current: null as RetryableAddVersionSubmission | null,
      };
      const cacheValidatedPersonVersion = vi.fn();
      const defaultCache = vi.fn();
      const capturedSettlement = vi.fn();
      const onSubmissionDiscarded = vi.fn();
      const onSuccess = vi.fn();
      const toastSuccess = vi.fn();
      const toastError = vi.fn();
      const invalidateByTx = vi.fn();
      const setSuccessResult = vi.fn();
      const setIsSubmitting = vi.fn();
      const submissionAttemptRef = { current: 0 };
      const resolveIdentityMaterial = vi.fn(async (current: unknown) =>
        current
          ? {
              personData: {
                fullName: "Ada Lovelace",
                gender: 2,
                birthYear: 1815,
                birthMonth: 12,
                birthDay: 10,
                isBirthBC: false,
                identitySuiteId: 1,
                derivedSecretField: BigInt(secrets.derivedSecretField),
              },
              personHash: PERSON_HASH,
              identitySuiteId: 1,
              identityCommitment: 11n,
              derivedSecretField: BigInt(secrets.derivedSecretField),
              identityPasswordInputHex: secrets.identityPasswordInputHex,
              identitySaltHex: secrets.identitySaltHex,
              derivedSecretHex: secrets.derivedSecretHex,
            }
          : null,
      );
      const generatePersonCommitmentProof = vi.fn(async (input: any) => {
        expect(input.personData.derivedSecretField.toString()).toBe(secrets.derivedSecretField);
        expect(input.contentDigestLo).toBe(secrets.contentDigestLo);
        expect(input.contentDigestHi).toBe(secrets.contentDigestHi);
        return {
          proof: {
            circuitId: 1,
            proofEncodingId: 1,
            proofData: "0x1234",
            proverWitness: secrets.proverWitness,
            derivedSecretField: secrets.derivedSecretField,
          },
          publicSignals: {
            identityCommitment: 11n,
            fatherIdentityCommitment: 0n,
            motherIdentityCommitment: 0n,
            submitterAndSelfSuiteId: BigInt(SUBMITTER) | (1n << 160n),
            versionCommitment: VERSION_COMMITMENT,
            contentDigest: secrets.contentDigest,
            roleWitness: secrets.roleWitness,
          },
        };
      });
      const successfulResult = {
        hash: PERSON_HASH,
        index: 1,
        rewardAmount: 0,
        transactionHash: "0xadd",
        blockNumber: 456,
        events: {
          PersonHashZKVerified: { personHash: PERSON_HASH, prover: SUBMITTER },
          PersonVersionAdded: {
            personHash: PERSON_HASH,
            versionIndex: 1,
            addedBy: SUBMITTER,
            timestamp: 123,
            fatherHash: ZERO_HASH,
            fatherVersionIndex: 0,
            motherHash: ZERO_HASH,
            motherVersionIndex: 0,
            versionCommitment: VERSION_COMMITMENT.toString(),
          },
          MetadataStored: {
            personHash: PERSON_HASH,
            versionIndex: 1,
            pointer: POINTER,
            payloadHash: PAYLOAD_HASH,
            segmentCount: 1,
            payloadLength: 20,
          },
          TokenRewardDistributed: null,
        },
      };
      let resolveSecondReceipt!: (value: typeof successfulResult) => void;
      const runAddVersionOrThrow = vi
        .fn()
        .mockImplementationOnce(async (args: unknown) => {
          expect(secretInput).toBe("");
          expectNoSecretSentinels(args);
          throw error;
        })
        .mockImplementationOnce(async (args: unknown) => {
          expect(secretInput).toBe("");
          expectNoSecretSentinels(args);
          if (lifecycle !== "foreground") {
            return new Promise<typeof successfulResult>((resolve) => {
              resolveSecondReceipt = resolve;
            });
          }
          return successfulResult;
        });
      const signer = { getAddress: vi.fn(async () => SUBMITTER) } as any;

      const { result, unmount } = renderHook(() =>
        useAddVersionSubmit({
          t: ((_key: string, fallback?: string) => fallback ?? _key) as any,
          signer,
          isContractReady: true,
          rpcUrl: "https://rpc.example",
          chainId: 71,
          contractAddress: CONTRACT,
          readerAddress: READER,
          allConsentsChecked: true,
          personCalcRef,
          fatherCalcRef,
          motherCalcRef,
          resolveIdentityMaterial,
          buildMetadataPayload: () => ({
            schema: "deepfamily/person-version@1.0",
            person: {
              fullName: "Ada Lovelace",
              gender: 2,
              birthYear: 1815,
              birthMonth: 12,
              birthDay: 10,
              isBirthBC: false,
              personHash: PERSON_HASH,
            },
            parents: { father: null, mother: null },
            tag: "private revision",
            biography: "encrypted biography",
          }),
          generatePersonCommitmentProof,
          setProofStep: vi.fn(),
          runAddVersionOrThrow,
          cacheValidatedPersonVersion: defaultCache,
          captureValidatedPersonVersionCache: () => cacheValidatedPersonVersion,
          toastSuccess,
          toastError,
          invalidateByTx,
          onSuccess,
          setConsentError: vi.fn(),
          setErrorResult: vi.fn(),
          setSuccessResult,
          setIsSubmitting,
          submissionPackageRef,
          submissionAttemptRef,
          onSubmissionDiscarded,
          settleTransaction: mocks.settleTransaction,
          captureSettlement: () => capturedSettlement,
        }),
      );

      await act(async () => {
        await result.current({
          fatherVersionIndex: "",
          motherVersionIndex: "",
          tag: "private revision",
          biography: "encrypted biography",
        });
      });

      expect(submissionPackageRef.current).not.toBeNull();
      expect(onSubmissionDiscarded).not.toHaveBeenCalled();
      expectNoSecretSentinels(submissionPackageRef.current);
      expect(clearSecretInputs).toHaveBeenCalledTimes(1);
      expect(mocks.terminateCryptoWorkerIfIdle).toHaveBeenCalledTimes(1);
      expect(mocks.terminateZkWorkerIfIdle).toHaveBeenCalledTimes(1);
      expect(cacheValidatedPersonVersion).not.toHaveBeenCalled();
      expectNoSecretSentinels({
        localStorage: { ...localStorage },
        sessionStorage: { ...sessionStorage },
      });

      const firstTransactionArgs = runAddVersionOrThrow.mock.calls[0][0];
      const retryInput = {
        fatherVersionIndex: "" as const,
        motherVersionIndex: "" as const,
        tag: "private revision",
        biography: "encrypted biography",
      };
      let nextSubmission: RetryableAddVersionSubmission | null = null;
      if (lifecycle === "foreground") {
        await act(async () => {
          await result.current(retryInput);
        });
      } else {
        let pending!: Promise<void>;
        act(() => {
          pending = result.current(retryInput);
        });
        await vi.waitFor(() => expect(runAddVersionOrThrow).toHaveBeenCalledTimes(2));
        const successWrites = setSuccessResult.mock.calls.length;
        const submittingWrites = setIsSubmitting.mock.calls.length;
        submissionAttemptRef.current += 1;
        if (lifecycle === "unmounted") unmount();
        else nextSubmission = { ...submissionPackageRef.current!, draftKey: "a new version" };
        submissionPackageRef.current = nextSubmission;
        resolveSecondReceipt(successfulResult);
        await act(async () => {
          await pending;
        });
        expect(setSuccessResult).toHaveBeenCalledTimes(successWrites);
        expect(setIsSubmitting).toHaveBeenCalledTimes(submittingWrites);
      }

      expect(runAddVersionOrThrow.mock.calls[1][0]).toBe(firstTransactionArgs);
      expect(submissionPackageRef.current).toBe(nextSubmission);
      expect(onSubmissionDiscarded).not.toHaveBeenCalled();
      expect(resolveIdentityMaterial).toHaveBeenCalledTimes(3);
      expect(generatePersonCommitmentProof).toHaveBeenCalledTimes(1);
      expect(mocks.cryptoWorkerCall).toHaveBeenCalledTimes(4);
      const completesLocally = lifecycle === "foreground";
      expect(cacheValidatedPersonVersion).toHaveBeenCalledTimes(completesLocally ? 1 : 0);
      expect(toastSuccess).toHaveBeenCalledTimes(completesLocally ? 1 : 0);
      expect(invalidateByTx).toHaveBeenCalledTimes(completesLocally ? 1 : 0);
      expect(defaultCache).not.toHaveBeenCalled();
      expect(mocks.settleTransaction).not.toHaveBeenCalled();
      expect(capturedSettlement).toHaveBeenLastCalledWith({
        phase: "done",
        transactionHash: "0xadd",
      });
      expect(onSuccess).toHaveBeenCalledTimes(lifecycle === "foreground" ? 1 : 0);
      if (completesLocally) {
        expectNoSecretSentinels(cacheValidatedPersonVersion.mock.calls[0][0]);
      } else {
        expect(mocks.reader.getVersionDetails).not.toHaveBeenCalled();
      }
      expectNoSecretSentinels({
        localStorage: { ...localStorage },
        sessionStorage: { ...sessionStorage },
      });
    },
  );

  it("stops an old identity job without clearing the reopened form or replacing its package", async () => {
    const submissionAttemptRef = { current: 0 };
    const clearSecretInputs = vi.fn();
    const personCalcRef = {
      current: {
        getPublicFormData: () => ({ fullName: "Ada Lovelace" }),
        getSecretInputs: vi.fn(() => ({ passphrase: secrets.rawPassphrase })),
        clearSecretInputs,
      },
    } as any;
    const submissionPackageRef = { current: null as RetryableAddVersionSubmission | null };
    let resolveIdentity!: (value: any) => void;
    const resolveIdentityMaterial = vi.fn(
      () =>
        new Promise<any>((resolve) => {
          resolveIdentity = resolve;
        }),
    );
    const buildMetadataPayload = vi.fn();
    const runAddVersionOrThrow = vi.fn();
    const setIsSubmitting = vi.fn();
    const onSubmissionDiscarded = vi.fn();
    const toastError = vi.fn();
    const capturedSettlement = vi.fn();
    const { result } = renderHook(() =>
      useAddVersionSubmit({
        t: ((_key: string, fallback?: string) => fallback ?? _key) as any,
        signer: { getAddress: vi.fn(async () => SUBMITTER) } as any,
        isContractReady: true,
        rpcUrl: "https://rpc.example",
        chainId: 71,
        contractAddress: CONTRACT,
        readerAddress: READER,
        allConsentsChecked: true,
        personCalcRef,
        fatherCalcRef: { current: null },
        motherCalcRef: { current: null },
        resolveIdentityMaterial,
        buildMetadataPayload,
        generatePersonCommitmentProof: vi.fn(),
        setProofStep: vi.fn(),
        runAddVersionOrThrow,
        cacheValidatedPersonVersion: vi.fn(),
        toastSuccess: vi.fn(),
        toastError,
        invalidateByTx: vi.fn(),
        setConsentError: vi.fn(),
        setErrorResult: vi.fn(),
        setSuccessResult: vi.fn(),
        setIsSubmitting,
        submissionPackageRef,
        submissionAttemptRef,
        onSubmissionDiscarded,
        settleTransaction: mocks.settleTransaction,
        captureSettlement: () => capturedSettlement,
      }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current({
        fatherVersionIndex: "",
        motherVersionIndex: "",
        tag: "",
        biography: "",
      });
    });
    await vi.waitFor(() => expect(resolveIdentityMaterial).toHaveBeenCalledOnce());
    submissionAttemptRef.current += 1;
    const nextSubmission = { draftKey: "a new version" } as RetryableAddVersionSubmission;
    submissionPackageRef.current = nextSubmission;
    resolveIdentity({ personHash: PERSON_HASH });
    await act(async () => {
      await pending;
    });

    expect(submissionPackageRef.current).toBe(nextSubmission);
    expect(resolveIdentityMaterial).toHaveBeenCalledOnce();
    expect(buildMetadataPayload).not.toHaveBeenCalled();
    expect(mocks.cryptoWorkerCall).not.toHaveBeenCalled();
    expect(runAddVersionOrThrow).not.toHaveBeenCalled();
    expect(clearSecretInputs).not.toHaveBeenCalled();
    expect(setIsSubmitting).toHaveBeenCalledExactlyOnceWith(true);
    expect(onSubmissionDiscarded).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(capturedSettlement).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ phase: "failed", error: expect.any(Object) }),
    );
  });

  it.each([
    { name: "network changes", chainId: 72, changedDraft: false, reverted: false },
    { name: "draft changes", chainId: 71, changedDraft: true, reverted: false },
    { name: "transaction reverts", chainId: 71, changedDraft: false, reverted: true },
  ])(
    "requires renewed consent when the frozen retry package is discarded after $name",
    async ({ chainId, changedDraft, reverted }) => {
      const formInput = {
        fatherVersionIndex: "" as const,
        motherVersionIndex: "" as const,
        tag: "private revision",
        biography: "encrypted biography",
      };
      const publicPerson = {
        fullName: "Ada Lovelace",
        gender: 2,
        birthYear: 1815,
        birthMonth: 12,
        birthDay: 10,
        isBirthBC: false,
        hasPassphrase: true,
      };
      const { hasPassphrase: _hasPassphrase, ...publicIdentity } = publicPerson;
      const submissionPackageRef = {
        current: {
          draftKey: JSON.stringify({
            data: addVersionSchema.parse(formInput),
            person: publicIdentity,
            father: null,
            mother: null,
          }),
          scope: createAddVersionTransactionScope({
            chainId: 71,
            contractAddress: CONTRACT,
            readerAddress: READER,
            submitterAddress: SUBMITTER,
          }),
          confirmationRpcUrl: "https://rpc.example",
          args: {
            proof: { circuitId: 1, proofEncodingId: 1, proofData: "0x1234" },
            publicSignals: {
              identityCommitment: 11n,
              fatherIdentityCommitment: 0n,
              motherIdentityCommitment: 0n,
              submitterAndSelfSuiteId: BigInt(SUBMITTER) | (1n << 160n),
              versionCommitment: VERSION_COMMITMENT,
            },
            fatherVersionIndex: 0,
            motherVersionIndex: 0,
            metadataEnvelope: new Uint8Array(20),
          },
          versionCommitment: VERSION_COMMITMENT,
          payloadHash: PAYLOAD_HASH,
          validated: {} as any,
          personHash: PERSON_HASH,
          fatherHash: ZERO_HASH,
          motherHash: ZERO_HASH,
          broadcastConfirmed: false,
        } satisfies RetryableAddVersionSubmission,
      };
      const runAddVersionOrThrow = vi.fn();
      if (reverted) {
        runAddVersionOrThrow.mockRejectedValue(
          Object.assign(new Error("transaction reverted"), { code: "CALL_EXCEPTION" }),
        );
      }
      const onSubmissionDiscarded = vi.fn();
      const resolveIdentityMaterial = vi.fn();
      const generatePersonCommitmentProof = vi.fn();
      const setErrorResult = vi.fn();
      const signer = {
        getAddress: vi.fn(async () => SUBMITTER),
        provider: { send: vi.fn(async () => `0x${chainId.toString(16)}`) },
      } as any;
      const personCalcRef = {
        current: {
          getPublicFormData: () => publicPerson,
          getSecretInputs: () => ({ passphrase: "" }),
          clearSecretInputs: vi.fn(),
        },
      } as any;

      const { result } = renderHook(() =>
        useAddVersionSubmit({
          t: ((_key: string, fallback?: string) => fallback ?? _key) as any,
          signer,
          isContractReady: true,
          rpcUrl: "https://rpc.example",
          chainId,
          contractAddress: CONTRACT,
          readerAddress: READER,
          allConsentsChecked: true,
          personCalcRef,
          fatherCalcRef: { current: null },
          motherCalcRef: { current: null },
          resolveIdentityMaterial,
          buildMetadataPayload: vi.fn(),
          generatePersonCommitmentProof,
          setProofStep: vi.fn(),
          runAddVersionOrThrow,
          cacheValidatedPersonVersion: vi.fn(),
          toastSuccess: vi.fn(),
          toastError: vi.fn(),
          invalidateByTx: vi.fn(),
          setConsentError: vi.fn(),
          setErrorResult,
          setSuccessResult: vi.fn(),
          setIsSubmitting: vi.fn(),
          submissionPackageRef,
          onSubmissionDiscarded,
          settleTransaction: mocks.settleTransaction,
        }),
      );

      await act(async () => {
        await result.current(
          changedDraft ? { ...formInput, biography: "changed biography" } : formInput,
        );
      });

      expect(submissionPackageRef.current).toBeNull();
      expect(onSubmissionDiscarded).toHaveBeenCalledTimes(1);
      expect(runAddVersionOrThrow).toHaveBeenCalledTimes(reverted ? 1 : 0);
      expect(resolveIdentityMaterial).not.toHaveBeenCalled();
      expect(generatePersonCommitmentProof).not.toHaveBeenCalled();
      expect(mocks.cryptoWorkerCall).not.toHaveBeenCalled();
      expect(setErrorResult).toHaveBeenCalledWith(
        expect.objectContaining({ retryable: expect.any(Boolean) }),
      );
    },
  );

  it("does not read anchors or cache after scope changes while a receipt is pending", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const formInput = {
      fatherVersionIndex: "" as const,
      motherVersionIndex: "" as const,
      tag: "private revision",
      biography: "encrypted biography",
    };
    const publicPerson = {
      fullName: "Ada Lovelace",
      gender: 2,
      birthYear: 1815,
      birthMonth: 12,
      birthDay: 10,
      isBirthBC: false,
      hasPassphrase: true,
    };
    const { hasPassphrase: _hasPassphrase, ...publicIdentity } = publicPerson;
    const submissionPackageRef = {
      current: {
        draftKey: JSON.stringify({
          data: addVersionSchema.parse(formInput),
          person: publicIdentity,
          father: null,
          mother: null,
        }),
        scope: createAddVersionTransactionScope({
          chainId: 71,
          contractAddress: CONTRACT,
          readerAddress: READER,
          submitterAddress: SUBMITTER,
        }),
        confirmationRpcUrl: "https://rpc.example",
        args: {
          proof: { circuitId: 1, proofEncodingId: 1, proofData: "0x1234" },
          publicSignals: {
            identityCommitment: 11n,
            fatherIdentityCommitment: 0n,
            motherIdentityCommitment: 0n,
            submitterAndSelfSuiteId: BigInt(SUBMITTER) | (1n << 160n),
            versionCommitment: VERSION_COMMITMENT,
          },
          fatherVersionIndex: 0,
          motherVersionIndex: 0,
          metadataEnvelope: new Uint8Array(20),
        },
        versionCommitment: VERSION_COMMITMENT,
        payloadHash: PAYLOAD_HASH,
        validated: {} as any,
        personHash: PERSON_HASH,
        fatherHash: ZERO_HASH,
        motherHash: ZERO_HASH,
        broadcastConfirmed: false,
      } satisfies RetryableAddVersionSubmission,
    };
    let resolveReceipt!: (result: any) => void;
    const runAddVersionOrThrow = vi.fn(
      () =>
        new Promise<any>((resolve) => {
          resolveReceipt = resolve;
        }),
    );
    const cacheValidatedPersonVersion = vi.fn();
    const invalidateByTx = vi.fn();
    const setSuccessResult = vi.fn();
    const signer = {
      getAddress: vi.fn(async () => SUBMITTER),
      provider: { send: vi.fn(async () => "0x47") },
    } as any;
    const personCalcRef = {
      current: {
        getPublicFormData: () => publicPerson,
        getSecretInputs: () => ({ passphrase: "" }),
        clearSecretInputs: vi.fn(),
      },
    } as any;
    let activeReaderAddress = READER;

    const { result, rerender } = renderHook(() =>
      useAddVersionSubmit({
        t: ((_key: string, fallback?: string) => fallback ?? _key) as any,
        signer,
        isContractReady: true,
        rpcUrl: "https://rpc.example",
        chainId: 71,
        contractAddress: CONTRACT,
        readerAddress: activeReaderAddress,
        allConsentsChecked: true,
        personCalcRef,
        fatherCalcRef: { current: null },
        motherCalcRef: { current: null },
        resolveIdentityMaterial: vi.fn(),
        buildMetadataPayload: vi.fn(),
        generatePersonCommitmentProof: vi.fn(),
        setProofStep: vi.fn(),
        runAddVersionOrThrow,
        cacheValidatedPersonVersion,
        toastSuccess: vi.fn(),
        toastError: vi.fn(),
        invalidateByTx,
        setConsentError: vi.fn(),
        setErrorResult: vi.fn(),
        setSuccessResult,
        setIsSubmitting: vi.fn(),
        submissionPackageRef,
        settleTransaction: mocks.settleTransaction,
      }),
    );

    let pending!: Promise<void>;
    act(() => {
      pending = result.current(formInput);
    });
    await vi.waitFor(() => expect(runAddVersionOrThrow).toHaveBeenCalledTimes(1));
    activeReaderAddress = "0x0000000000000000000000000000000000000fed";
    rerender();
    resolveReceipt({});
    await act(async () => {
      await pending;
    });

    expect(submissionPackageRef.current).toBeNull();
    expect(mocks.reader.getVersionDetails).not.toHaveBeenCalled();
    expect(cacheValidatedPersonVersion).not.toHaveBeenCalled();
    expect(invalidateByTx).not.toHaveBeenCalled();
    expect(setSuccessResult).toHaveBeenCalledTimes(1);
    expect(setSuccessResult).toHaveBeenCalledWith(null);
  });
});

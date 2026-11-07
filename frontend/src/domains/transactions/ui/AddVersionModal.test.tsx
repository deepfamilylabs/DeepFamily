// @vitest-environment jsdom
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AddVersionModal from "./AddVersionModal";
import { formSectionsHidden, precedesFormSections } from "./transactionPhaseContract";
import {
  TransactionCenterProvider,
  useTransactionCenter,
} from "../context/TransactionCenterContext";

const personHash = `0x${"ab".repeat(32)}`;
const submitter = "0x00000000000000000000000000000000000000aa";
const contractAddress = "0x0000000000000000000000000000000000000abc";
const readerAddress = "0x0000000000000000000000000000000000000def";
const archiveAddress = "0x0000000000000000000000000000000000000acd";
const pointer = "0x0000000000000000000000000000000000000b10";
const payloadHash = `0x${"44".repeat(32)}`;
const envelopeHex = `0x${"44".repeat(20)}`;
const packedSubmitterAndSelfSuiteId = BigInt(submitter) | (1n << 160n);

const successfulFlowResult = () => ({
  hash: personHash,
  index: 3,
  rewardAmount: 0,
  transactionHash: "0xadd",
  blockNumber: 456,
  events: {
    PersonHashZKVerified: {
      personHash,
      prover: submitter,
    },
    PersonVersionAdded: {
      personHash,
      versionIndex: 3,
      addedBy: submitter,
      timestamp: 789,
      fatherHash: "",
      fatherVersionIndex: 0,
      motherHash: "",
      motherVersionIndex: 0,
      versionCommitment: "99",
    },
    MetadataStored: {
      personHash,
      versionIndex: 3,
      pointer,
      payloadHash,
      segmentCount: 1,
      payloadLength: 20,
    },
    TokenRewardDistributed: null,
  },
});

const mocks = vi.hoisted(() => ({
  signer: {
    getAddress: vi.fn(),
  },
  addVersionRunOrThrow: vi.fn(),
  addVersionFlow: { status: "idle" } as { status: string },
  addVersionReset: vi.fn(),
  confirmTransactionPreview: null as null | ((preview: any) => Promise<boolean> | boolean),
  invalidateByTx: vi.fn(),
  cacheValidatedPersonVersion: vi.fn(),
  captureMetadataCacheRevision: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  onClose: vi.fn(),
  onSuccess: vi.fn(),
  onEndorse: vi.fn(),
  zkWorkerCall: vi.fn(),
  cryptoWorkerCall: vi.fn(),
  terminateCryptoWorkerIfIdle: vi.fn(),
  terminateZkWorkerIfIdle: vi.fn(),
  clearSecretInputs: vi.fn(),
  secretInputRead: vi.fn(),
  fatherPresent: false,
  motherPresent: false,
  personGateway: {
    listVersionEndorsements: vi.fn(async () => ({
      versionIndices: [] as number[],
      endorsementCounts: [] as number[],
      tokenIds: [] as number[],
      totalVersions: 0,
      hasMore: false,
      nextOffset: 0,
    })),
    listPersonVersionsPage: vi.fn(async () => ({
      versions: [] as { versionIndex: number; addedBy: string; timestamp: number }[],
      totalVersions: 0,
      hasMore: false,
      nextOffset: 0,
    })),
  },
  deepFamilyContract: {
    versionExists: vi.fn(),
    archive: vi.fn(),
  },
  readerContract: {
    DEEP_FAMILY: vi.fn(),
    ARCHIVE: vi.fn(),
    getVersionDetails: vi.fn(),
  },
  createDeepFamilyContract: vi.fn(),
  createDeepFamilyReaderContract: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("../../wallet", () => ({
  useWallet: () => ({
    signer: mocks.signer,
  }),
}));

vi.mock("../../config", () => ({
  useConfig: () => ({
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 71,
    contractAddress: "0x0000000000000000000000000000000000000abc",
    readerAddress: "0x0000000000000000000000000000000000000def",
  }),
}));

vi.mock("../hooks/useContractClient", () => ({
  useContractClient: () => ({
    isContractReady: true,
  }),
}));

vi.mock("../../../shared/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../shared/ui")>();
  return {
    ...actual,
    useToast: () => ({
      success: mocks.toastSuccess,
      error: mocks.toastError,
    }),
    useResponsiveModalMode: () => true,
  };
});

vi.mock("../../tree", () => ({
  useTreeMutations: () => ({
    invalidateByTx: mocks.invalidateByTx,
    cacheValidatedPersonVersion: mocks.cacheValidatedPersonVersion,
    cacheConfirmedPersonVersion: mocks.cacheValidatedPersonVersion,
    captureMetadataCacheRevision: mocks.captureMetadataCacheRevision,
  }),
}));

vi.mock("./add-version/hooks/useAddVersionFlow", () => ({
  useAddVersionFlow: (options?: any) => {
    mocks.confirmTransactionPreview = options?.confirmTransactionPreview ?? null;
    return {
      status: mocks.addVersionFlow.status,
      reset: mocks.addVersionReset,
      runOrThrow: mocks.addVersionRunOrThrow,
    };
  },
}));

vi.mock("../../../shared/workers/cryptoWorkerClient", () => ({
  cryptoWorkerCall: (...args: any[]) => mocks.cryptoWorkerCall(...args),
  terminateCryptoWorkerIfIdle: () => mocks.terminateCryptoWorkerIfIdle(),
}));

vi.mock("../../../shared/workers/zkWorkerClient", () => ({
  zkWorkerCall: (...args: any[]) => mocks.zkWorkerCall(...args),
  terminateZkWorkerIfIdle: () => mocks.terminateZkWorkerIfIdle(),
}));

vi.mock("../../../shared/zk/zk", () => ({
  formatGroth16ProofForContract: () => ({
    circuitId: 1,
    proofEncodingId: 1,
    proofData: "0x1234",
  }),
}));

vi.mock("../../../shared/clients/contractFactory", () => ({
  createDeepFamilyContract: (...args: any[]) => mocks.createDeepFamilyContract(...args),
  createDeepFamilyReaderContract: (...args: any[]) => mocks.createDeepFamilyReaderContract(...args),
}));

vi.mock("../../../shared/lib/errors", () => ({
  getFriendlyError: (error: any) => ({
    type: error?.type || "UNKNOWN_ERROR",
    reason: error?.reason || error?.code,
    message: error?.message || "Operation failed",
    details: error?.details || error?.message || "Operation failed",
  }),
  sanitizeErrorForLogging: (error: any) => error,
}));

vi.mock("../../person", () => ({
  usePersonGateway: () => mocks.personGateway,
  PersonHashCalculator: forwardRef((props: any, ref) => {
    const isParent = props.initialValues?.fullName === "";
    const role = !isParent ? "person" : props.initialValues?.gender === 1 ? "father" : "mother";
    const secretRef = useRef("identity-passphrase");
    const secretInputRef = useRef<HTMLInputElement | null>(null);
    const originalParentName =
      role === "father" && mocks.fatherPresent
        ? "Charles Babbage"
        : role === "mother" && mocks.motherPresent
          ? "Annabella Byron"
          : "";
    const publicFormDataRef = useRef(
      isParent
        ? {
            fullName: originalParentName,
            gender: props.initialValues?.gender ?? 0,
            birthYear: 0,
            birthMonth: 0,
            birthDay: 0,
            isBirthBC: false,
          }
        : {
            fullName: "Ada Lovelace",
            gender: 2,
            birthYear: 1815,
            birthMonth: 12,
            birthDay: 10,
            isBirthBC: false,
          },
    );
    const publicFormData = publicFormDataRef.current;
    const publishParentHash = () => {
      if (!isParent) return;
      const identity = publicFormDataRef.current;
      if (!identity.fullName) {
        props.onComputedHashChange?.("");
        return;
      }
      const originalIdentity =
        identity.fullName === originalParentName &&
        identity.birthYear === 0 &&
        secretRef.current === "identity-passphrase";
      const hashByte =
        role === "father" ? (originalIdentity ? "cd" : "ce") : originalIdentity ? "ef" : "f0";
      props.onComputedHashChange?.(`0x${hashByte.repeat(32)}`);
    };
    useImperativeHandle(ref, () => ({
      getSecretInputs: () => {
        mocks.secretInputRead(role);
        return { passphrase: secretRef.current };
      },
      getPublicFormData: () => publicFormDataRef.current,
      passphrasesMatch: () => true,
      clearSecretInputs: () => {
        secretRef.current = "";
        if (secretInputRef.current) secretInputRef.current.value = "";
        mocks.clearSecretInputs(role);
        props.onPublicFormChange?.({ ...publicFormDataRef.current, hasPassphrase: false });
        props.onComputedHashChange?.("");
      },
    }));

    useEffect(() => {
      props.onPublicFormChange?.(publicFormData);
      props.onPassphraseChange?.();
      publishParentHash();
    }, []);

    return (
      <div data-testid="person-hash-calculator">
        {isParent && (
          <>
            <input
              aria-label={`${role} identity name test input`}
              defaultValue={publicFormData.fullName}
              onChange={(event) => {
                publicFormDataRef.current = {
                  ...publicFormDataRef.current,
                  fullName: event.currentTarget.value,
                };
                props.onPublicFormChange?.(publicFormDataRef.current);
                publishParentHash();
              }}
            />
            <input
              aria-label={`${role} identity birth year test input`}
              defaultValue={publicFormData.birthYear}
              onChange={(event) => {
                publicFormDataRef.current = {
                  ...publicFormDataRef.current,
                  birthYear: Number(event.currentTarget.value),
                };
                props.onPublicFormChange?.(publicFormDataRef.current);
                publishParentHash();
              }}
            />
          </>
        )}
        <input
          ref={secretInputRef}
          aria-label={`${role} identity passphrase test input`}
          defaultValue={secretRef.current}
          onChange={(event) => {
            secretRef.current = event.currentTarget.value;
            props.onPassphraseChange?.();
            publishParentHash();
          }}
        />
      </div>
    );
  }),
}));

function addVersionModalElement(isOpen = true) {
  return (
    <AddVersionModal
      isOpen={isOpen}
      onClose={mocks.onClose}
      onSuccess={mocks.onSuccess}
      onEndorse={mocks.onEndorse}
    />
  );
}

function TransactionRecords() {
  const centre = useTransactionCenter();
  return <output data-testid="transaction-records">{JSON.stringify(centre?.records)}</output>;
}

function modalWithTransactionCentre(isOpen = true) {
  return (
    <TransactionCenterProvider>
      {addVersionModalElement(isOpen)}
      <TransactionRecords />
    </TransactionCenterProvider>
  );
}

function transactionRecords() {
  return JSON.parse(screen.getByTestId("transaction-records").textContent || "[]") as {
    id: string;
    phase: string;
    transactionHash?: string;
  }[];
}

function renderAddVersionModal() {
  const result = render(addVersionModalElement());
  /** Re-renders with the current mock state, for phases the flow enters later. */
  return { ...result, refresh: () => result.rerender(addVersionModalElement()) };
}

async function checkConsentBoxes() {
  const checkboxes = screen.getAllByRole("checkbox");
  for (const checkbox of checkboxes.slice(-4)) {
    await act(async () => {
      fireEvent.click(checkbox);
    });
  }
}

async function fillRequiredFields() {
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText("e.g. From the family register"), {
      target: { value: "verified" },
    });
    fireEvent.change(screen.getByPlaceholderText("Life story, deeds, family memories…"), {
      target: { value: "private biography" },
    });
  });
  await checkConsentBoxes();
}

async function prepareFailedParentSubmission(role: "father" | "mother") {
  const originalHash = `0x${(role === "father" ? "cd" : "ef").repeat(32)}`;
  const changedHash = `0x${(role === "father" ? "ce" : "f0").repeat(32)}`;
  mocks[role === "father" ? "fatherPresent" : "motherPresent"] = true;
  const versionForHash = (hash: unknown) => (hash === changedHash ? 7 : 4);
  mocks.personGateway.listVersionEndorsements.mockImplementation(async (...args: unknown[]) => ({
    versionIndices: [versionForHash(args[0])],
    endorsementCounts: [7],
    tokenIds: [0],
    totalVersions: versionForHash(args[0]),
    hasMore: false,
    nextOffset: 0,
  }));
  mocks.personGateway.listPersonVersionsPage.mockImplementation(async (...args: unknown[]) => ({
    versions: [{ versionIndex: versionForHash(args[0]), addedBy: submitter, timestamp: 1 }],
    totalVersions: versionForHash(args[0]),
    hasMore: false,
    nextOffset: 0,
  }));
  mocks.addVersionRunOrThrow.mockRejectedValue(new Error("RPC timeout while waiting for receipt"));
  renderAddVersionModal();
  await waitFor(() =>
    expect(mocks.personGateway.listVersionEndorsements).toHaveBeenCalledWith(originalHash, 0, 100),
  );
  await fillRequiredFields();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
  });
  await waitFor(() => expect(mocks.toastError).toHaveBeenCalledOnce());
  const firstArgs = mocks.addVersionRunOrThrow.mock.calls[0][0];
  expect(firstArgs[`${role}VersionIndex`]).toBe(4);
  fireEvent.click(screen.getByRole("button", { name: /Back to edit/i }));
  expect(mocks.personGateway.listVersionEndorsements).not.toHaveBeenCalledWith(changedHash, 0, 100);
  return { firstArgs, changedHash };
}

async function expectFreshParentSubmission(
  role: "father" | "mother",
  firstArgs: unknown,
  changedHash: string,
) {
  await waitFor(() =>
    expect(mocks.personGateway.listVersionEndorsements).toHaveBeenCalledWith(changedHash, 0, 100),
  );
  const consent = screen.getByRole("checkbox", {
    name: /guess the passphrase offline/i,
  }) as HTMLInputElement;
  expect(consent.checked).toBe(false);
  fireEvent.click(consent);
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: /Add Version/i }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
  });
  await waitFor(() => expect(mocks.addVersionRunOrThrow).toHaveBeenCalledTimes(2));
  expect(mocks.addVersionRunOrThrow.mock.calls[1][0]).not.toBe(firstArgs);
  expect(mocks.addVersionRunOrThrow.mock.calls[1][0][`${role}VersionIndex`]).toBe(7);
  expect(
    mocks.cryptoWorkerCall.mock.calls.filter(([method]) => method === "deriveIdentityMaterialV1"),
  ).toHaveLength(4);
}

describe("AddVersionModal", () => {
  beforeEach(() => {
    mocks.signer.getAddress.mockReset();
    mocks.addVersionRunOrThrow.mockReset();
    mocks.addVersionFlow = { status: "idle" };
    mocks.addVersionReset.mockReset();
    mocks.addVersionReset.mockImplementation(() => {
      mocks.addVersionFlow.status = "idle";
    });
    mocks.confirmTransactionPreview = null;
    mocks.invalidateByTx.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    mocks.onClose.mockReset();
    mocks.onSuccess.mockReset();
    mocks.onEndorse.mockReset();
    mocks.zkWorkerCall.mockReset();
    mocks.cryptoWorkerCall.mockReset();
    mocks.terminateCryptoWorkerIfIdle.mockReset();
    mocks.terminateZkWorkerIfIdle.mockReset();
    mocks.terminateCryptoWorkerIfIdle.mockReturnValue(true);
    mocks.terminateZkWorkerIfIdle.mockReturnValue(true);
    mocks.clearSecretInputs.mockReset();
    mocks.secretInputRead.mockReset();
    mocks.fatherPresent = false;
    mocks.motherPresent = false;
    mocks.personGateway.listVersionEndorsements.mockReset().mockResolvedValue({
      versionIndices: [],
      endorsementCounts: [],
      tokenIds: [],
      totalVersions: 0,
      hasMore: false,
      nextOffset: 0,
    });
    mocks.personGateway.listPersonVersionsPage.mockReset().mockResolvedValue({
      versions: [],
      totalVersions: 0,
      hasMore: false,
      nextOffset: 0,
    });
    mocks.cacheValidatedPersonVersion.mockReset();
    mocks.cacheValidatedPersonVersion.mockResolvedValue(undefined);
    mocks.captureMetadataCacheRevision.mockReset();
    mocks.captureMetadataCacheRevision.mockReturnValue(11);
    mocks.deepFamilyContract.versionExists.mockReset();
    mocks.deepFamilyContract.archive.mockReset();
    mocks.readerContract.DEEP_FAMILY.mockReset();
    mocks.readerContract.ARCHIVE.mockReset();
    mocks.readerContract.getVersionDetails.mockReset();
    mocks.createDeepFamilyContract.mockReset();
    mocks.createDeepFamilyReaderContract.mockReset();

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    vi.spyOn(window.history, "pushState").mockImplementation(() => {});
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.signer.getAddress.mockResolvedValue(submitter);
    mocks.deepFamilyContract.versionExists.mockResolvedValue(false);
    mocks.deepFamilyContract.archive.mockResolvedValue(archiveAddress);
    mocks.readerContract.DEEP_FAMILY.mockResolvedValue(contractAddress);
    mocks.readerContract.ARCHIVE.mockResolvedValue(archiveAddress);
    mocks.readerContract.getVersionDetails.mockResolvedValue([
      {
        personHash,
        fatherHash: `0x${"00".repeat(32)}`,
        motherHash: `0x${"00".repeat(32)}`,
        versionIndex: 3n,
        fatherVersionIndex: 0n,
        motherVersionIndex: 0n,
        versionCommitment: 99n,
        addedBy: submitter,
        timestamp: 789n,
      },
      { pointer, payloadHash, segmentCount: 1n, payloadLength: 20n },
      0n,
      0n,
    ]);
    mocks.createDeepFamilyContract.mockReturnValue(mocks.deepFamilyContract);
    mocks.createDeepFamilyReaderContract.mockReturnValue(mocks.readerContract);
    mocks.cryptoWorkerCall.mockImplementation((method: string) => {
      if (method === "deriveIdentityMaterialV1") {
        return Promise.resolve({
          identitySuiteId: 1,
          identity: {
            fullName: "Ada Lovelace",
            gender: 2,
            birthYear: 1815,
            birthMonth: 12,
            birthDay: 10,
            isBirthBC: false,
          },
          derivedSecretField: "1",
          nameField: "2",
          packedBirthGenderField: "3",
          suiteCommitment: "4",
          nameSecretCommitment: "5",
          identityCommitment: "11",
          personHash,
        });
      }
      if (method === "preparePersonVersionContentV1") {
        return Promise.resolve({
          canonicalJsonLength: 2,
          contentDigestLo: "7",
          contentDigestHi: "8",
          versionCommitment: "99",
        });
      }
      if (method === "preflightPersonVersionEnvelopeSizeV1") {
        return Promise.resolve({
          canonicalJsonLength: 2,
          compressedPlaintextLength: 1,
          envelopeLength: 20,
        });
      }
      if (method === "encryptPersonVersionEnvelopeV1") {
        return Promise.resolve({
          envelopeHex,
          payloadHash,
          formatVersion: 1,
          identitySuiteId: 1,
          envelopeLength: 20,
          canonicalJsonLength: 2,
          compressedPlaintextLength: 1,
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
              personHash,
            },
            parents: { father: null, mother: null },
            tag: "verified",
            biography: "private biography",
          },
          formatVersion: 1,
          identitySuiteId: 1,
          payloadHash,
          versionCommitment: "99",
          metadataUnlockValidated: true,
          protocolGeneration: "df-onchain-biography-v1",
        });
      }
      return Promise.reject(new Error(`unexpected crypto method ${method}`));
    });
    mocks.zkWorkerCall.mockImplementation((method: string) => {
      if (method === "generatePersonRelationProof") {
        return Promise.resolve({
          proof: { pi_a: [], pi_b: [], pi_c: [] },
          publicSignals: ["11", "0", "0", packedSubmitterAndSelfSuiteId.toString(), "99"],
        });
      }
      if (method === "verifyPersonRelationProof") {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error(`unexpected zk method ${method}`));
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("invalidates the passphrase confirmation after every passphrase edit", async () => {
    renderAddVersionModal();

    await waitFor(() => expect(screen.getAllByTestId("person-hash-calculator")).toHaveLength(3));
    await fillRequiredFields();
    const submitButton = screen.getByRole("button", { name: /Add Version/i }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);

    const passphraseConsent = () =>
      screen.getByRole("checkbox", { name: /guess the passphrase offline/i }) as HTMLInputElement;

    fireEvent.change(screen.getByLabelText("person identity passphrase test input"), {
      target: { value: "" },
    });
    // Emptying the passphrase adds no extra checkbox: the single confirmation
    // already covers weak and empty passphrases alike.
    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(3));
    expect(passphraseConsent().checked).toBe(false);
    expect(submitButton.disabled).toBe(true);

    fireEvent.click(passphraseConsent());
    await waitFor(() => expect(submitButton.disabled).toBe(false));

    fireEvent.change(screen.getByLabelText("person identity passphrase test input"), {
      target: { value: "\u00a0\u2003" },
    });
    expect(passphraseConsent().checked).toBe(false);
    expect(submitButton.disabled).toBe(true);

    fireEvent.click(passphraseConsent());
    await waitFor(() => expect(submitButton.disabled).toBe(false));

    // A different passphrase in the same risk class must also invalidate the
    // prior confirmation; classification equality is not consent equality.
    fireEvent.change(screen.getByLabelText("person identity passphrase test input"), {
      target: { value: "\t" },
    });
    expect(passphraseConsent().checked).toBe(false);
    expect(submitButton.disabled).toBe(true);
  });

  it("reports confirmed success even when local confirmed-node persistence fails", async () => {
    const flowResult = successfulFlowResult();
    mocks.addVersionRunOrThrow.mockResolvedValue(flowResult);
    mocks.cacheValidatedPersonVersion.mockRejectedValueOnce(
      new Error("IndexedDB confirmed-node write failed"),
    );

    renderAddVersionModal();

    await waitFor(() => expect(screen.getAllByTestId("person-hash-calculator").length).toBe(3));
    await fillRequiredFields();
    expect(
      (screen.getByRole("button", { name: /Add Version/i }) as HTMLButtonElement).disabled,
    ).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
    });

    await waitFor(() => expect(mocks.addVersionRunOrThrow).toHaveBeenCalledTimes(1));
    expect(mocks.addVersionRunOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        fatherVersionIndex: 0,
        motherVersionIndex: 0,
        metadataEnvelope: new Uint8Array(20).fill(0x44),
        proof: expect.any(Object),
        publicSignals: expect.objectContaining({
          identityCommitment: 11n,
          submitterAndSelfSuiteId: packedSubmitterAndSelfSuiteId,
          versionCommitment: 99n,
        }),
      }),
    );
    expect(mocks.cacheValidatedPersonVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        personHash,
        versionIndex: 3,
        versionCommitment: "99",
        metadataPointer: pointer,
        metadataPayloadHash: payloadHash,
        metadataUnlockValidated: true,
        tag: "verified",
        biography: "private biography",
      }),
      11,
    );
    // The spent form gets out of the way once the result owns the view.
    expect(formSectionsHidden()).toBe(true);
    // Short on purpose: what was created, what it earned, and how to look it
    // up. The parent hashes the user just typed in are not a result.
    const summary = screen.getByRole("status", { name: /Version Added Successfully/i });
    // This submission mined nothing, and a zero reward is not a result.
    expect(Array.from(summary.querySelectorAll("dt")).map((dt) => dt.textContent)).toEqual([
      "Hash",
      "Version",
      "Transaction",
    ]);
    expect(summary.textContent).not.toContain("0x331690");
    expect(mocks.clearSecretInputs).toHaveBeenCalledTimes(3);
    expect(mocks.terminateCryptoWorkerIfIdle).toHaveBeenCalledOnce();
    expect(mocks.terminateZkWorkerIfIdle).toHaveBeenCalledOnce();
    expect(mocks.terminateCryptoWorkerIfIdle.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.addVersionRunOrThrow.mock.invocationCallOrder[0],
    );
    expect(mocks.terminateZkWorkerIfIdle.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.addVersionRunOrThrow.mock.invocationCallOrder[0],
    );
    expect(mocks.cryptoWorkerCall.mock.calls.map(([method]) => method)).toEqual([
      "deriveIdentityMaterialV1",
      "preparePersonVersionContentV1",
      "preflightPersonVersionEnvelopeSizeV1",
      "encryptPersonVersionEnvelopeV1",
      "roundTripPersonVersionEnvelopeV1",
    ]);
    expect(mocks.secretInputRead).not.toHaveBeenCalledWith("father");
    expect(mocks.secretInputRead).not.toHaveBeenCalledWith("mother");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Person version added successfully");
    expect(mocks.invalidateByTx).toHaveBeenCalledWith({
      events: { PersonVersionAdded: flowResult.events.PersonVersionAdded },
      hints: { personHash, versionIndex: 3 },
    });
    expect(mocks.onSuccess).toHaveBeenCalledWith(flowResult);
    expect(await screen.findByText("Version Added Successfully")).toBeTruthy();
  });

  it("refuses to cache plaintext when the confirmed Reader ref differs from the frozen envelope", async () => {
    mocks.addVersionRunOrThrow.mockResolvedValue(successfulFlowResult());
    mocks.readerContract.getVersionDetails.mockResolvedValueOnce([
      {
        personHash,
        fatherHash: `0x${"00".repeat(32)}`,
        motherHash: `0x${"00".repeat(32)}`,
        versionIndex: 3n,
        fatherVersionIndex: 0n,
        motherVersionIndex: 0n,
        versionCommitment: 99n,
        addedBy: submitter,
        timestamp: 789n,
      },
      // The frozen package contains exactly 20 bytes. A Reader response for a
      // different Archive ref must not produce an unlocked NodeData record.
      { pointer, payloadHash, segmentCount: 1n, payloadLength: 19n },
      0n,
      0n,
    ]);

    renderAddVersionModal();
    await waitFor(() => expect(screen.getAllByTestId("person-hash-calculator")).toHaveLength(3));
    await fillRequiredFields();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
    });

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    expect(mocks.readerContract.getVersionDetails).toHaveBeenCalledWith(personHash, 3);
    expect(mocks.cacheValidatedPersonVersion).not.toHaveBeenCalled();
    expect(mocks.invalidateByTx).not.toHaveBeenCalled();
    expect(mocks.onSuccess).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.cacheValidatedPersonVersion.mock.calls)).not.toContain(
      "private biography",
    );
  });

  it("refuses to cache plaintext when the Reader pointer differs from the receipt anchor", async () => {
    mocks.addVersionRunOrThrow.mockResolvedValue(successfulFlowResult());
    mocks.readerContract.getVersionDetails.mockResolvedValueOnce([
      {
        personHash,
        fatherHash: `0x${"00".repeat(32)}`,
        motherHash: `0x${"00".repeat(32)}`,
        versionIndex: 3n,
        fatherVersionIndex: 0n,
        motherVersionIndex: 0n,
        versionCommitment: 99n,
        addedBy: submitter,
        timestamp: 789n,
      },
      {
        pointer: "0x0000000000000000000000000000000000000b11",
        payloadHash,
        segmentCount: 1,
        payloadLength: 20n,
      },
      0n,
      0n,
    ]);

    renderAddVersionModal();
    await waitFor(() => expect(screen.getAllByTestId("person-hash-calculator")).toHaveLength(3));
    await fillRequiredFields();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
    });

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    expect(mocks.cacheValidatedPersonVersion).not.toHaveBeenCalled();
    expect(mocks.invalidateByTx).not.toHaveBeenCalled();
    expect(mocks.onSuccess).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("reuses the exact verified submission package after an uncertain RPC send failure", async () => {
    const flowResult = successfulFlowResult();
    mocks.addVersionRunOrThrow
      .mockRejectedValueOnce(new Error("temporary RPC timeout after transaction send"))
      .mockResolvedValueOnce(flowResult);

    renderAddVersionModal();

    await waitFor(() => expect(screen.getAllByTestId("person-hash-calculator")).toHaveLength(3));
    await fillRequiredFields();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
    });

    await waitFor(() => expect(mocks.addVersionRunOrThrow).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    const firstArgs = mocks.addVersionRunOrThrow.mock.calls[0][0];
    const cryptoMethodsAfterFirstSend = mocks.cryptoWorkerCall.mock.calls.map(([method]) => method);
    const zkMethodsAfterFirstSend = mocks.zkWorkerCall.mock.calls.map(([method]) => method);
    const secretReadsAfterFirstSend = mocks.secretInputRead.mock.calls.length;

    expect(cryptoMethodsAfterFirstSend).toEqual([
      "deriveIdentityMaterialV1",
      "preparePersonVersionContentV1",
      "preflightPersonVersionEnvelopeSizeV1",
      "encryptPersonVersionEnvelopeV1",
      "roundTripPersonVersionEnvelopeV1",
    ]);
    expect(zkMethodsAfterFirstSend).toEqual([
      "generatePersonRelationProof",
      "verifyPersonRelationProof",
    ]);
    expect(firstArgs.publicSignals.versionCommitment).toBe(99n);

    const backToEdit = await screen.findByRole("button", { name: /Back to edit/i });
    await act(async () => {
      fireEvent.click(backToEdit);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
    });

    await waitFor(() => expect(mocks.addVersionRunOrThrow).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledTimes(1));
    const secondArgs = mocks.addVersionRunOrThrow.mock.calls[1][0];

    // The retry receives the same frozen public package, not merely equivalent
    // data reconstructed through a second KDF/proof/encryption pass.
    expect(secondArgs).toBe(firstArgs);
    expect(secondArgs.proof).toBe(firstArgs.proof);
    expect(secondArgs.publicSignals).toBe(firstArgs.publicSignals);
    expect(secondArgs.metadataEnvelope).toBe(firstArgs.metadataEnvelope);
    expect(secondArgs.publicSignals.versionCommitment).toBe(
      firstArgs.publicSignals.versionCommitment,
    );
    expect(mocks.cryptoWorkerCall.mock.calls.map(([method]) => method)).toEqual(
      cryptoMethodsAfterFirstSend,
    );
    expect(mocks.zkWorkerCall.mock.calls.map(([method]) => method)).toEqual(
      zkMethodsAfterFirstSend,
    );
    expect(mocks.secretInputRead).toHaveBeenCalledTimes(secretReadsAfterFirstSend);
    expect(mocks.deepFamilyContract.versionExists).toHaveBeenCalledTimes(1);
    expect(mocks.clearSecretInputs).toHaveBeenCalledTimes(3);
    expect(mocks.terminateCryptoWorkerIfIdle).toHaveBeenCalledTimes(1);
    expect(mocks.terminateZkWorkerIfIdle).toHaveBeenCalledTimes(1);
    expect(mocks.cacheValidatedPersonVersion).toHaveBeenCalledTimes(1);
    expect(mocks.onSuccess).toHaveBeenCalledWith(flowResult);
  });

  it("reuses the encrypted package after cancelling preview without rebuilding an empty-passphrase identity", async () => {
    const flowResult = successfulFlowResult();
    mocks.addVersionRunOrThrow
      .mockImplementationOnce(async () => {
        const approved = await mocks.confirmTransactionPreview?.({
          envelopeBytes: 20,
          payloadBytes: 20,
          segmentCount: 1,
          canonicalPayload: "0x1234",
          payloadHash,
          estimated: true,
          estimatedGas: 100n,
          gasLimit: 120n,
          estimatedFee: 1n,
          maximumFee: 2n,
          nativeSymbol: "ETH",
        });
        if (!approved)
          throw Object.assign(new Error("cancelled"), { code: "ADD_VERSION_PREVIEW_REJECTED" });
        return flowResult;
      })
      .mockResolvedValueOnce(flowResult);
    render(modalWithTransactionCentre());
    await fillRequiredFields();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel Submission" }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /Add Version/i }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    const firstArgs = mocks.addVersionRunOrThrow.mock.calls[0][0];
    expect(transactionRecords()).toMatchObject([{ phase: "failed" }]);
    expect(mocks.toastError).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
    });
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledOnce());
    expect(mocks.addVersionRunOrThrow.mock.calls[1][0]).toBe(firstArgs);
    expect(
      mocks.cryptoWorkerCall.mock.calls.filter(([method]) => method === "deriveIdentityMaterialV1"),
    ).toHaveLength(1);
    expect(
      mocks.cryptoWorkerCall.mock.calls.filter(
        ([method]) => method === "encryptPersonVersionEnvelopeV1",
      ),
    ).toHaveLength(1);
    expect(transactionRecords()).toMatchObject([
      { phase: "done", transactionHash: "0xadd" },
      { phase: "failed" },
    ]);
  });

  it("keeps the selected parent version after secret cleanup and retries the same package", async () => {
    mocks.fatherPresent = true;
    mocks.personGateway.listVersionEndorsements.mockResolvedValue({
      versionIndices: [4],
      endorsementCounts: [7],
      tokenIds: [0],
      totalVersions: 1,
      hasMore: false,
      nextOffset: 0,
    });
    mocks.personGateway.listPersonVersionsPage.mockResolvedValue({
      versions: [{ versionIndex: 4, addedBy: submitter, timestamp: 1 }],
      totalVersions: 1,
      hasMore: false,
      nextOffset: 0,
    });
    mocks.addVersionRunOrThrow.mockRejectedValue(
      new Error("RPC timeout while waiting for receipt"),
    );
    renderAddVersionModal();
    await waitFor(() => expect(mocks.personGateway.listVersionEndorsements).toHaveBeenCalled());
    await fillRequiredFields();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
    });
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledOnce());
    const firstArgs = mocks.addVersionRunOrThrow.mock.calls[0][0];
    expect(firstArgs.fatherVersionIndex).toBe(4);
    fireEvent.click(screen.getByRole("button", { name: /Back to edit/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
    });
    await waitFor(() => expect(mocks.addVersionRunOrThrow).toHaveBeenCalledTimes(2));
    expect(mocks.addVersionRunOrThrow.mock.calls[1][0]).toBe(firstArgs);
    expect(
      mocks.cryptoWorkerCall.mock.calls.filter(([method]) => method === "deriveIdentityMaterialV1"),
    ).toHaveLength(2);
  });

  it.each(["father", "mother"] as const)(
    "queries the new %s identity and rebuilds after a manual passphrase edit",
    async (role) => {
      const { firstArgs, changedHash } = await prepareFailedParentSubmission(role);
      fireEvent.change(screen.getByLabelText(`${role} identity passphrase test input`), {
        target: { value: "replacement-parent-passphrase" },
      });
      await expectFreshParentSubmission(role, firstArgs, changedHash);
    },
  );

  it.each(["father", "mother"] as const)(
    "discards the old %s package when its name is cleared, passphrase edited and name restored",
    async (role) => {
      const { firstArgs, changedHash } = await prepareFailedParentSubmission(role);
      const nameInput = screen.getByLabelText(
        `${role} identity name test input`,
      ) as HTMLInputElement;
      const originalName = nameInput.value;
      fireEvent.change(nameInput, { target: { value: "" } });
      fireEvent.change(screen.getByLabelText(`${role} identity passphrase test input`), {
        target: { value: "replacement-parent-passphrase" },
      });
      fireEvent.change(nameInput, { target: { value: originalName } });
      await expectFreshParentSubmission(role, firstArgs, changedHash);
    },
  );

  it.each([
    ["father", "name", "A different father"],
    ["mother", "name", "A different mother"],
    ["father", "birth year", "1791"],
    ["mother", "birth year", "1792"],
  ] as const)(
    "immediately requeries the %s after editing its %s while a package is prepared",
    async (role, field, value) => {
      const { changedHash } = await prepareFailedParentSubmission(role);
      fireEvent.change(screen.getByLabelText(`${role} identity ${field} test input`), {
        target: { value },
      });
      await waitFor(() =>
        expect(mocks.personGateway.listVersionEndorsements).toHaveBeenCalledWith(
          changedHash,
          0,
          100,
        ),
      );
      expect(mocks.addVersionRunOrThrow).toHaveBeenCalledOnce();
      expect(
        (
          screen.getByRole("checkbox", {
            name: /guess the passphrase offline/i,
          }) as HTMLInputElement
        ).checked,
      ).toBe(false);
    },
  );

  it("requires renewed passphrase consent after discarding a terminally failed package", async () => {
    mocks.addVersionRunOrThrow.mockRejectedValue(
      Object.assign(new Error("insufficient funds"), { code: "INSUFFICIENT_FUNDS" }),
    );
    renderAddVersionModal();
    await fillRequiredFields();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
    });
    fireEvent.click(await screen.findByRole("button", { name: /Back to edit/i }));
    expect(
      (screen.getByRole("checkbox", { name: /guess the passphrase offline/i }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: /Add Version/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("settles background confirmation with its original cache revision without changing a reopened form", async () => {
    let confirm!: (result: ReturnType<typeof successfulFlowResult>) => void;
    mocks.addVersionRunOrThrow.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          confirm = resolve;
        }),
    );
    const view = render(modalWithTransactionCentre());
    await fillRequiredFields();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
    });
    await waitFor(() => expect(mocks.addVersionRunOrThrow).toHaveBeenCalledOnce());
    mocks.addVersionFlow.status = "confirming";
    view.rerender(modalWithTransactionCentre());
    const originalId = transactionRecords()[0].id;
    fireEvent.click(screen.getByRole("button", { name: /Continue in background/i }));
    view.rerender(modalWithTransactionCentre(false));
    view.rerender(modalWithTransactionCentre());
    mocks.captureMetadataCacheRevision.mockReturnValue(22);
    await act(async () => {
      confirm(successfulFlowResult());
    });
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledOnce());
    expect(transactionRecords()).toMatchObject([
      { id: originalId, phase: "done", transactionHash: "0xadd" },
    ]);
    expect(mocks.cacheValidatedPersonVersion).toHaveBeenCalledWith(expect.any(Object), 11);
    expect(mocks.invalidateByTx).toHaveBeenCalledOnce();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.onSuccess).not.toHaveBeenCalled();
    expect(formSectionsHidden()).toBe(false);
    expect(screen.queryByText("Transaction Successful")).toBeNull();
  });

  it("ordinary close resets and cancels local completion while recording an already-sent transaction", async () => {
    let confirm!: (result: ReturnType<typeof successfulFlowResult>) => void;
    mocks.addVersionRunOrThrow.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          confirm = resolve;
        }),
    );
    const view = render(modalWithTransactionCentre());
    await fillRequiredFields();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
    });
    await waitFor(() => expect(mocks.addVersionRunOrThrow).toHaveBeenCalledOnce());
    mocks.addVersionFlow.status = "confirming";
    view.rerender(modalWithTransactionCentre());
    const originalId = transactionRecords()[0].id;
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(mocks.addVersionReset).toHaveBeenCalled();
    view.rerender(modalWithTransactionCentre(false));
    view.rerender(modalWithTransactionCentre());
    await act(async () => {
      confirm(successfulFlowResult());
    });
    await waitFor(() =>
      expect(transactionRecords()).toMatchObject([
        { id: originalId, phase: "done", transactionHash: "0xadd" },
      ]),
    );
    expect(mocks.readerContract.getVersionDetails).not.toHaveBeenCalled();
    expect(mocks.cacheValidatedPersonVersion).not.toHaveBeenCalled();
    expect(mocks.invalidateByTx).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.onSuccess).not.toHaveBeenCalled();
    expect(formSectionsHidden()).toBe(false);
    expect(
      (screen.getByPlaceholderText("e.g. From the family register") as HTMLInputElement).value,
    ).toBe("");
    expect(
      screen.getAllByRole("checkbox").every((checkbox) => !(checkbox as HTMLInputElement).checked),
    ).toBe(true);
  });

  it("close during Reader verification cancels enrichment even if the delayed read fails", async () => {
    let rejectRead!: (reason: Error) => void;
    mocks.readerContract.getVersionDetails.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRead = reject;
        }),
    );
    mocks.addVersionRunOrThrow.mockResolvedValueOnce(successfulFlowResult());
    const view = render(modalWithTransactionCentre());
    await fillRequiredFields();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
    });
    await waitFor(() => expect(mocks.readerContract.getVersionDetails).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    view.rerender(modalWithTransactionCentre(false));
    await act(async () => {
      rejectRead(new Error("Reader unavailable after close"));
    });
    await waitFor(() =>
      expect(transactionRecords()).toMatchObject([{ phase: "done", transactionHash: "0xadd" }]),
    );
    expect(mocks.cacheValidatedPersonVersion).not.toHaveBeenCalled();
    expect(mocks.invalidateByTx).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.onSuccess).not.toHaveBeenCalled();
  });

  it("builds a new package when a passphrase is edited after an uncertain send failure", async () => {
    const flowResult = successfulFlowResult();
    mocks.addVersionRunOrThrow
      .mockRejectedValueOnce(new Error("temporary RPC timeout after transaction send"))
      .mockResolvedValueOnce(flowResult);

    renderAddVersionModal();
    await waitFor(() => expect(screen.getAllByTestId("person-hash-calculator")).toHaveLength(3));
    await fillRequiredFields();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
    });
    await waitFor(() => expect(mocks.addVersionRunOrThrow).toHaveBeenCalledTimes(1));
    const firstArgs = mocks.addVersionRunOrThrow.mock.calls[0][0];
    const backToEdit = await screen.findByRole("button", { name: /Back to edit/i });
    await act(async () => {
      fireEvent.click(backToEdit);
    });

    fireEvent.change(screen.getByLabelText("person identity passphrase test input"), {
      target: { value: "replacement-passphrase" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /guess the passphrase offline/i,
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
    });

    await waitFor(() => expect(mocks.addVersionRunOrThrow).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledTimes(1));
    const secondArgs = mocks.addVersionRunOrThrow.mock.calls[1][0];

    expect(secondArgs).not.toBe(firstArgs);
    expect(
      mocks.cryptoWorkerCall.mock.calls.filter(([method]) => method === "deriveIdentityMaterialV1"),
    ).toHaveLength(2);
    expect(
      mocks.cryptoWorkerCall.mock.calls.filter(
        ([method]) => method === "encryptPersonVersionEnvelopeV1",
      ),
    ).toHaveLength(2);
    expect(
      mocks.zkWorkerCall.mock.calls.filter(([method]) => method === "generatePersonRelationProof"),
    ).toHaveLength(2);
    expect(mocks.deepFamilyContract.versionExists).toHaveBeenCalledTimes(2);
  });

  describe("what the modal shows in each phase", () => {
    const preview = {
      canonicalPayload: "0x00",
      payloadHash: "0xhash",
      payloadBytes: 1,
      segmentCount: 1,
      estimated: true as const,
      estimatedGas: 100n,
      gasLimit: 120n,
      estimatedFee: 200n,
      maximumFee: 240n,
      nativeSymbol: "ETH",
      envelopeBytes: 20,
    };

    async function openModal() {
      const view = renderAddVersionModal();
      await waitFor(() => expect(screen.getAllByTestId("person-hash-calculator").length).toBe(3));
      return view;
    }

    it("shares its spine with minting, plus the envelope only it encrypts", async () => {
      await openModal();
      await act(async () => {
        void mocks.confirmTransactionPreview?.(preview);
      });

      const labels = Array.from(document.querySelectorAll("ol li")).map(
        (li) => li.querySelector("div")?.nextElementSibling?.firstElementChild?.textContent ?? "",
      );
      expect(labels).toEqual([
        "Derive identity material",
        "Generate zero-knowledge proof",
        "Encrypt the metadata envelope",
        "Confirm the transaction",
        "Waiting for on-chain confirmation",
      ]);
    });

    it("waits on the user at the confirm step rather than looking busy", async () => {
      await openModal();
      await act(async () => {
        void mocks.confirmTransactionPreview?.(preview);
      });
      // A spinner here would claim the flow is working when it is the user's
      // turn, which reads as a step already under way.
      const marks = Array.from(document.querySelectorAll("ol li")).map(
        (li) =>
          li
            .querySelector("svg")
            ?.getAttribute("class")
            ?.match(/lucide-([a-z-]+)/)?.[1] ?? "dot",
      );
      const confirmIndex = marks.length - 2;
      expect(marks[confirmIndex]).toBe("arrow-right");
      expect(marks.slice(0, confirmIndex).every((mark) => mark === "check")).toBe(true);
      expect(marks[marks.length - 1]).toBe("dot");
    });

    it("keeps the form on screen while it is the user's turn", async () => {
      await openModal();

      expect(formSectionsHidden()).toBe(false);
    });

    it("hides the form and shows progress while the flow is busy", async () => {
      const { refresh } = await openModal();

      // Opening resets the flow, so the phase is entered after the first render.
      mocks.addVersionFlow.status = "confirming";
      await act(async () => {
        refresh();
      });

      const progress = screen.getByRole("status", {
        name: "Transactions: Waiting for on-chain confirmation",
      });
      expect(formSectionsHidden()).toBe(true);
      expect(precedesFormSections(progress)).toBe(true);
    });

    it("hides the form and focuses the frozen package while it awaits a decision", async () => {
      await openModal();

      // The flow asks the controller to confirm; that is what raises the panel.
      await act(async () => {
        void mocks.confirmTransactionPreview?.(preview);
      });

      const panel = screen.getByRole("group", { name: "Review before opening your wallet" });
      expect(formSectionsHidden()).toBe(true);
      expect(document.activeElement).toBe(panel);
      expect(precedesFormSections(panel)).toBe(true);
      expect(screen.getByRole("button", { name: /Continue to Wallet/i })).toBeTruthy();
    });
  });

  it("shows a friendly error when the add-version flow fails", async () => {
    mocks.addVersionRunOrThrow.mockRejectedValue(new Error("add version reverted"));

    renderAddVersionModal();

    await waitFor(() => expect(screen.getAllByTestId("person-hash-calculator").length).toBe(3));
    await fillRequiredFields();
    expect(
      (screen.getByRole("button", { name: /Add Version/i }) as HTMLButtonElement).disabled,
    ).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
    });

    await waitFor(() => expect(mocks.addVersionRunOrThrow).toHaveBeenCalledTimes(1));
    expect(mocks.onSuccess).not.toHaveBeenCalled();
    expect(mocks.invalidateByTx).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Failed to add person version: add version reverted",
    );
    expect(await screen.findByText("Transaction Failed")).toBeTruthy();
    expect(screen.getAllByText("add version reverted").length).toBeGreaterThan(0);

    const alert = screen.getByRole("alert");
    // A failure is a result like success: it owns the view, and the alert takes focus.
    expect(formSectionsHidden()).toBe(true);
    expect(document.activeElement).toBe(alert);

    // "Back to edit" brings the form back, without the error — and must not
    // resubmit it. In a browser the click's default action runs after React has
    // re-rendered, so a <button> reused in place as the submit button submits.
    const backToEdit = await screen.findByRole("button", { name: /Back to edit/i });
    await act(async () => {
      fireEvent.click(backToEdit);
    });
    expect(backToEdit.isConnected).toBe(false);
    expect(formSectionsHidden()).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stops before Groth16, encryption, or transaction submission when gzip cannot fit", async () => {
    const defaultCryptoCall = mocks.cryptoWorkerCall.getMockImplementation();
    mocks.cryptoWorkerCall.mockImplementation((method: string, ...args: any[]) => {
      if (method === "preflightPersonVersionEnvelopeSizeV1") {
        return Promise.reject(
          Object.assign(
            new Error("Compressed metadata cannot fit in the 16384-byte envelope limit"),
            {
              code: "ENVELOPE_TOO_LARGE",
            },
          ),
        );
      }
      return defaultCryptoCall?.(method, ...args);
    });

    renderAddVersionModal();
    await waitFor(() => expect(screen.getAllByTestId("person-hash-calculator")).toHaveLength(3));
    await fillRequiredFields();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
    });

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    expect(mocks.cryptoWorkerCall.mock.calls.map(([method]) => method)).toEqual([
      "deriveIdentityMaterialV1",
      "preparePersonVersionContentV1",
      "preflightPersonVersionEnvelopeSizeV1",
    ]);
    expect(mocks.zkWorkerCall).not.toHaveBeenCalled();
    expect(mocks.addVersionRunOrThrow).not.toHaveBeenCalled();
  });

  it("shows exact envelope bytes and RPC gas before allowing the wallet request", async () => {
    const flowResult = successfulFlowResult();
    mocks.addVersionRunOrThrow.mockImplementation(async () => {
      const approved = await mocks.confirmTransactionPreview?.({
        envelopeBytes: 20,
        payloadBytes: 20,
        segmentCount: 1,
        canonicalPayload: "0x1234",
        payloadHash: "0x" + "11".repeat(32),
        estimatedFee: 1n,
        maximumFee: 2n,
        nativeSymbol: "ETH",
        estimatedGas: 123_456n,
        gasLimit: 148_147n,
        estimated: true,
      });
      if (!approved) throw new Error("preview rejected");
      return flowResult;
    });

    renderAddVersionModal();
    await waitFor(() => expect(screen.getAllByTestId("person-hash-calculator")).toHaveLength(3));
    await fillRequiredFields();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
    });

    expect(await screen.findByText("Review before opening your wallet")).toBeTruthy();
    expect(screen.getAllByText("20")[0]).toBeTruthy();
    expect(screen.getByText("123,456")).toBeTruthy();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue to Wallet" }));
    });

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledTimes(1));
  });

  it("prevents native form submission when submitting add version", async () => {
    mocks.addVersionRunOrThrow.mockRejectedValue(new Error("add version reverted"));

    renderAddVersionModal();

    await waitFor(() => expect(screen.getAllByTestId("person-hash-calculator").length).toBe(3));
    await fillRequiredFields();
    expect(
      (screen.getByRole("button", { name: /Add Version/i }) as HTMLButtonElement).disabled,
    ).toBe(false);

    const form = document.getElementById("add-version-form");
    expect(form).toBeTruthy();

    const submitEvent = new Event("submit", { bubbles: true, cancelable: true });

    await act(async () => {
      form!.dispatchEvent(submitEvent);
    });

    expect(submitEvent.defaultPrevented).toBe(true);
    await waitFor(() => expect(mocks.addVersionRunOrThrow).toHaveBeenCalledTimes(1));
  });
});

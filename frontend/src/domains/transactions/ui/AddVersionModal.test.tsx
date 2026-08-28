// @vitest-environment jsdom
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AddVersionModal from "./AddVersionModal";

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
  deepFamilyContract: {
    versionExists: vi.fn(),
    metadataArchive: vi.fn(),
  },
  readerContract: {
    DEEP_FAMILY: vi.fn(),
    METADATA_ARCHIVE: vi.fn(),
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
      status: "idle",
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

vi.mock("../../../shared/identity/fullName", () => ({
  safeCanonicalizeFullName: (value: string) => value.trim(),
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
  PersonHashCalculator: forwardRef((props: any, ref) => {
    const isParent = props.initialValues?.fullName === "";
    const role = !isParent ? "person" : props.initialValues?.gender === 1 ? "father" : "mother";
    const secretRef = useRef("identity-passphrase");
    const publicFormData = isParent
      ? {
          fullName: "",
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
        };
    useImperativeHandle(ref, () => ({
      getSecretInputs: () => {
        mocks.secretInputRead(role);
        return { passphrase: secretRef.current };
      },
      getPublicFormData: () => publicFormData,
      passphrasesMatch: () => true,
      clearSecretInputs: () => {
        secretRef.current = "";
        mocks.clearSecretInputs(role);
      },
    }));

    useEffect(() => {
      props.onPublicFormChange?.(publicFormData);
      props.onPassphraseChange?.();
    }, []);

    return (
      <div data-testid="person-hash-calculator">
        <input
          aria-label={`${role} identity passphrase test input`}
          defaultValue={secretRef.current}
          onChange={(event) => {
            secretRef.current = event.currentTarget.value;
            props.onPassphraseChange?.();
          }}
        />
      </div>
    );
  }),
}));

function renderAddVersionModal() {
  return render(
    <AddVersionModal
      isOpen
      onClose={mocks.onClose}
      onSuccess={mocks.onSuccess}
      onEndorse={mocks.onEndorse}
    />,
  );
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
    fireEvent.change(screen.getByPlaceholderText("Optional private revision label"), {
      target: { value: "verified" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "This immutable biography is encrypted on this device before it is stored on-chain.",
      ),
      {
        target: { value: "private biography" },
      },
    );
  });
  await checkConsentBoxes();
}

describe("AddVersionModal", () => {
  beforeEach(() => {
    mocks.signer.getAddress.mockReset();
    mocks.addVersionRunOrThrow.mockReset();
    mocks.addVersionReset.mockReset();
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
    mocks.cacheValidatedPersonVersion.mockReset();
    mocks.cacheValidatedPersonVersion.mockResolvedValue(undefined);
    mocks.captureMetadataCacheRevision.mockReset();
    mocks.captureMetadataCacheRevision.mockReturnValue(11);
    mocks.deepFamilyContract.versionExists.mockReset();
    mocks.deepFamilyContract.metadataArchive.mockReset();
    mocks.readerContract.DEEP_FAMILY.mockReset();
    mocks.readerContract.METADATA_ARCHIVE.mockReset();
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
    mocks.deepFamilyContract.metadataArchive.mockResolvedValue(archiveAddress);
    mocks.readerContract.DEEP_FAMILY.mockResolvedValue(contractAddress);
    mocks.readerContract.METADATA_ARCHIVE.mockResolvedValue(archiveAddress);
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
      { pointer, payloadHash, payloadLength: 20n },
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
    // A malformed/legacy provider result must never resurrect the removed
    // public event tag in the success UI.
    Object.assign(flowResult.events.PersonVersionAdded!, { tag: "legacy-public-tag" });
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
    expect(screen.queryByText(/legacy-public-tag/)).toBeNull();
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
      { pointer, payloadHash, payloadLength: 19n },
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
    expect(screen.getByText("20 / 16,384")).toBeTruthy();
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

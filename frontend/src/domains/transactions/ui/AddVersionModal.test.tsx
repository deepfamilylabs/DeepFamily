// @vitest-environment jsdom
import React, { forwardRef, useEffect, useImperativeHandle } from "react";
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
  invalidateByTx: vi.fn(),
  cacheValidatedPersonVersion: vi.fn(),
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
  }),
}));

vi.mock("./add-version/hooks/useAddVersionFlow", () => ({
  useAddVersionFlow: () => ({
    status: "idle",
    reset: mocks.addVersionReset,
    runOrThrow: mocks.addVersionRunOrThrow,
  }),
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
  createDeepFamilyReaderContract: (...args: any[]) =>
    mocks.createDeepFamilyReaderContract(...args),
}));

vi.mock("../../../shared/crypto/identityCommitment", () => ({
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
      getSecretInputs: () => ({ passphrase: "identity-passphrase" }),
      getPublicFormData: () => publicFormData,
      passphrasesMatch: () => true,
      clearSecretInputs: mocks.clearSecretInputs,
    }));

    useEffect(() => {
      props.onPublicFormChange?.(publicFormData);
    }, []);

    return <div data-testid="person-hash-calculator" />;
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
    mocks.cacheValidatedPersonVersion.mockReset();
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
          publicSignals: [
            "11",
            "0",
            "0",
            packedSubmitterAndSelfSuiteId.toString(),
            "99",
          ],
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

  it("submits through the add-version flow, invalidates tree state, and reports success", async () => {
    const flowResult = successfulFlowResult();
    mocks.addVersionRunOrThrow.mockResolvedValue(flowResult);

    renderAddVersionModal();

    await waitFor(() => expect(screen.getAllByTestId("person-hash-calculator").length).toBe(3));
    await fillRequiredFields();
    expect((screen.getByRole("button", { name: /Add Version/i }) as HTMLButtonElement).disabled).toBe(false);

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
      "encryptPersonVersionEnvelopeV1",
      "roundTripPersonVersionEnvelopeV1",
    ]);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Person version added successfully");
    expect(mocks.invalidateByTx).toHaveBeenCalledWith({
      events: { PersonVersionAdded: flowResult.events.PersonVersionAdded },
      hints: { personHash, versionIndex: 3 },
    });
    expect(mocks.onSuccess).toHaveBeenCalledWith(flowResult);
    expect(await screen.findByText("Version Added Successfully")).toBeTruthy();
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

    expect(cryptoMethodsAfterFirstSend).toEqual([
      "deriveIdentityMaterialV1",
      "preparePersonVersionContentV1",
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
    expect(mocks.zkWorkerCall.mock.calls.map(([method]) => method)).toEqual(zkMethodsAfterFirstSend);
    expect(mocks.signer.getAddress).toHaveBeenCalledTimes(1);
    expect(mocks.deepFamilyContract.versionExists).toHaveBeenCalledTimes(1);
    expect(mocks.clearSecretInputs).toHaveBeenCalledTimes(3);
    expect(mocks.terminateCryptoWorkerIfIdle).toHaveBeenCalledTimes(1);
    expect(mocks.terminateZkWorkerIfIdle).toHaveBeenCalledTimes(1);
    expect(mocks.cacheValidatedPersonVersion).toHaveBeenCalledTimes(1);
    expect(mocks.onSuccess).toHaveBeenCalledWith(flowResult);
  });

  it("shows a friendly error when the add-version flow fails", async () => {
    mocks.addVersionRunOrThrow.mockRejectedValue(new Error("add version reverted"));

    renderAddVersionModal();

    await waitFor(() => expect(screen.getAllByTestId("person-hash-calculator").length).toBe(3));
    await fillRequiredFields();
    expect((screen.getByRole("button", { name: /Add Version/i }) as HTMLButtonElement).disabled).toBe(false);

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

  it("prevents native form submission when submitting add version", async () => {
    mocks.addVersionRunOrThrow.mockRejectedValue(new Error("add version reverted"));

    renderAddVersionModal();

    await waitFor(() => expect(screen.getAllByTestId("person-hash-calculator").length).toBe(3));
    await fillRequiredFields();
    expect((screen.getByRole("button", { name: /Add Version/i }) as HTMLButtonElement).disabled).toBe(false);

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

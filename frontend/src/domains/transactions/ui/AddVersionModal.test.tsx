// @vitest-environment jsdom
import React, { forwardRef, useEffect, useImperativeHandle } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AddVersionModal from "./AddVersionModal";

const personHash = `0x${"ab".repeat(32)}`;
const submitter = "0x00000000000000000000000000000000000000aa";

const mocks = vi.hoisted(() => ({
  signer: {
    getAddress: vi.fn(),
  },
  addVersionRunOrThrow: vi.fn(),
  addVersionReset: vi.fn(),
  invalidateByTx: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  onClose: vi.fn(),
  onSuccess: vi.fn(),
  onEndorse: vi.fn(),
  zkWorkerCall: vi.fn(),
  cryptoWorkerCall: vi.fn(),
  computeIdentityHashMaterial: vi.fn(),
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
  }),
}));

vi.mock("./add-version/hooks/useAddVersionFlow", () => ({
  useAddVersionFlow: () => ({
    status: "idle",
    reset: mocks.addVersionReset,
    runOrThrow: mocks.addVersionRunOrThrow,
  }),
}));

vi.mock("../../../shared/crypto/metadataCrypto", () => ({
  sha256Hex: () => "plainhash",
}));

vi.mock("../../../shared/workers/cryptoWorkerClient", () => ({
  cryptoWorkerCall: (...args: any[]) => mocks.cryptoWorkerCall(...args),
}));

vi.mock("../../../shared/workers/zkWorkerClient", () => ({
  zkWorkerCall: (...args: any[]) => mocks.zkWorkerCall(...args),
}));

vi.mock("../../../shared/zk/zk", () => ({
  formatGroth16ProofForContract: () => ({
    proofSystemId: 1,
    proofEncodingId: 1,
    proofData: "0x",
  }),
}));

vi.mock("../../../shared/crypto/identityCommitment", () => ({
  safeCanonicalizeFullName: (value: string) => value.trim(),
}));

vi.mock("../../../shared/crypto/identityHash", () => ({
  computeIdentityHashMaterial: (...args: any[]) => mocks.computeIdentityHashMaterial(...args),
  generateRandomIdentitySaltHex: () => "0xrandomsalt",
  normalizeIdentitySaltHex: (value: string) => value,
}));

vi.mock("../../../shared/crypto/passphraseStrength", () => ({
  normalizePassphraseForHash: (value: string) => value.trim(),
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
    useImperativeHandle(ref, () => ({
      getSecretInputs: () => ({ passphrase: "" }),
      getPublicFormData: () => ({
        fullName: "Ada Lovelace",
        gender: 2,
        birthYear: 1815,
        birthMonth: 12,
        birthDay: 10,
        isBirthBC: false,
      }),
      hasPassphrase: () => false,
    }));

    useEffect(() => {
      props.onPublicFormChange?.({
        fullName: "Ada Lovelace",
        gender: 2,
        birthYear: 1815,
        birthMonth: 12,
        birthDay: 10,
        isBirthBC: false,
        hasPassphrase: false,
      });
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
  for (const checkbox of checkboxes.slice(-3)) {
    await act(async () => {
      fireEvent.click(checkbox);
    });
  }
}

async function fillRequiredFields() {
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText("Optional tag (e.g. 'Standard Version')"), {
      target: { value: "verified" },
    });
    fireEvent.change(screen.getByPlaceholderText("Password (min 8 chars)"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("Confirm password"), {
      target: { value: "password123" },
    });
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
    mocks.computeIdentityHashMaterial.mockReset();

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
    mocks.cryptoWorkerCall.mockImplementation((method: string) => {
      if (method === "passwordFingerprint") {
        return Promise.resolve({ passwordFingerprint: "fingerprint" });
      }
      if (method === "encryptMetadataBundleV2") {
        return Promise.resolve({
          encryptedJson: '{"encrypted":true}',
          cid: "cid://encrypted",
          plainHash: "plainhash",
          passwordFingerprint: "fingerprint",
        });
      }
      return Promise.reject(new Error(`unexpected crypto method ${method}`));
    });
    mocks.zkWorkerCall.mockImplementation((method: string) => {
      if (method === "generatePersonCommitmentProof") {
        return Promise.resolve({
          proof: { pi_a: [], pi_b: [], pi_c: [] },
          publicSignals: ["1", "0", "0", "2", "1", "1", "1"],
        });
      }
      if (method === "verifyPersonCommitmentProof") {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error(`unexpected zk method ${method}`));
    });
    mocks.computeIdentityHashMaterial.mockResolvedValue({
      personData: {
        fullName: "Ada Lovelace",
        derivedSecretField: 1n,
        birthYear: 1815,
        birthMonth: 12,
        birthDay: 10,
        isBirthBC: false,
        gender: 2,
      },
      personHash,
      identityMode: "deterministic",
      identitySaltHex: null,
      derivedSecretField: 1n,
      canonicalFullName: "Ada Lovelace",
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("submits through the add-version flow, invalidates tree state, and reports success", async () => {
    const flowResult = {
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
          tag: "verified",
        },
        TokenRewardDistributed: null,
      },
    };
    mocks.addVersionRunOrThrow.mockResolvedValue(flowResult);

    renderAddVersionModal();

    await waitFor(() => expect(screen.getAllByTestId("person-hash-calculator").length).toBe(3));
    await fillRequiredFields();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Version/i }));
    });

    await waitFor(() => expect(mocks.addVersionRunOrThrow).toHaveBeenCalledTimes(1));
    expect(mocks.addVersionRunOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        fatherVersionIndex: 0,
        motherVersionIndex: 0,
        tag: "verified",
        metadataCID: "cid://encrypted",
        proof: expect.any(Object),
        publicSignals: expect.objectContaining({
          identityCommitment: 1n,
          submitter: 2n,
        }),
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Person version added successfully");
    expect(mocks.invalidateByTx).toHaveBeenCalledWith({
      events: { PersonVersionAdded: flowResult.events.PersonVersionAdded },
      hints: { personHash, versionIndex: 3 },
    });
    expect(mocks.onSuccess).toHaveBeenCalledWith(flowResult);
    expect(await screen.findByText("Version Added Successfully")).toBeTruthy();
  });

  it("shows a friendly error when the add-version flow fails", async () => {
    mocks.addVersionRunOrThrow.mockRejectedValue(new Error("add version reverted"));

    renderAddVersionModal();

    await waitFor(() => expect(screen.getAllByTestId("person-hash-calculator").length).toBe(3));
    await fillRequiredFields();

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

// @vitest-environment jsdom
import React, { forwardRef, useEffect, useImperativeHandle } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ethers } from "ethers";
import MintNFTModal from "./MintNFTModal";

const personHash = `0x${"12".repeat(32)}`;
const ownerAddress = "0x00000000000000000000000000000000000000aa";

const mocks = vi.hoisted(() => ({
  address: "0x00000000000000000000000000000000000000aa",
  getVersionDetails: vi.fn(),
  endorsedVersionIndex: vi.fn(),
  contract: {} as any,
  mintRunOrThrow: vi.fn(),
  markVersionMinted: vi.fn(),
  onClose: vi.fn(),
  onSuccess: vi.fn(),
  onGoEndorse: vi.fn(),
  zkWorkerCall: vi.fn(),
  computeIdentityHashMaterial: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("../../wallet/context", () => ({
  useWallet: () => ({
    address: mocks.address,
  }),
}));

vi.mock("../hooks/useContractClient", () => ({
  useContractClient: () => ({
    getVersionDetails: mocks.getVersionDetails,
    contract: mocks.contract,
  }),
}));

vi.mock("../../tree/context", () => ({
  useTreeMutations: () => ({
    markVersionMinted: mocks.markVersionMinted,
  }),
}));

vi.mock("../flows", () => ({
  useMintNftFlow: () => ({
    runOrThrow: mocks.mintRunOrThrow,
  }),
}));

vi.mock("../../../shared/workers/zkWorkerClient", () => ({
  zkWorkerCall: (...args: any[]) => mocks.zkWorkerCall(...args),
}));

vi.mock("../../../shared/zk/zk", () => ({
  computeDisclosureBinding: () => 99n,
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

vi.mock("../../person/ui", () => ({
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
      // The real calculator reports this from user-controlled form state; the
      // mock injects it once to avoid parent state update loops.
    }, []);

    return <div data-testid="person-hash-calculator" />;
  }),
}));

function renderMintModal(overrides: Partial<React.ComponentProps<typeof MintNFTModal>> = {}) {
  return render(
    <MintNFTModal
      isOpen
      initialPersonHash={personHash}
      initialVersionIndex={2}
      onClose={mocks.onClose}
      onSuccess={mocks.onSuccess}
      onGoEndorse={mocks.onGoEndorse}
      {...overrides}
    />,
  );
}

async function checkAllConsents() {
  for (const checkbox of screen.getAllByRole("checkbox")) {
    await act(async () => {
      fireEvent.click(checkbox);
    });
  }
}

describe("MintNFTModal", () => {
  beforeEach(() => {
    mocks.address = ownerAddress;
    mocks.getVersionDetails.mockReset();
    mocks.endorsedVersionIndex.mockReset();
    mocks.contract = {
      endorsedVersionIndex: mocks.endorsedVersionIndex,
    };
    mocks.mintRunOrThrow.mockReset();
    mocks.markVersionMinted.mockReset();
    mocks.onClose.mockReset();
    mocks.onSuccess.mockReset();
    mocks.onGoEndorse.mockReset();
    mocks.zkWorkerCall.mockReset();
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
    vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.getVersionDetails.mockResolvedValue({
      tokenId: "0",
      endorsementCount: 1,
      version: {
        fatherHash: `0x${"34".repeat(32)}`,
        motherHash: `0x${"56".repeat(32)}`,
      },
    });
    mocks.endorsedVersionIndex.mockResolvedValue(2);
    mocks.zkWorkerCall.mockImplementation((method: string) => {
      if (method === "generateDisclosureBindingProof") {
        return Promise.resolve({
          proof: { pi_a: [], pi_b: [], pi_c: [] },
          publicSignals: ["1", "99", "2", "1", "1", "1"],
        });
      }
      if (method === "verifyDisclosureBindingProof") {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error(`unexpected zk method ${method}`));
    });
    mocks.computeIdentityHashMaterial.mockResolvedValue({
      canonicalFullName: "Ada Lovelace",
      derivedSecretField: 1n,
      identityCommitment: 1n,
      personHash,
      nameField: 2n,
      suiteCommitment: 3n,
      packedBirthGenderField: 4n,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("mints through the transaction flow and patches tree state on success", async () => {
    mocks.mintRunOrThrow.mockResolvedValue({
      tokenId: 77,
      transactionHash: "0xmint",
      blockNumber: 123,
      event: {
        personHash,
        tokenId: 77,
        owner: ownerAddress,
        versionIndex: 2,
        tokenURI: "ipfs://token",
        timestamp: 456,
      },
      receipt: { hash: "0xmint" },
    });

    renderMintModal();

    await waitFor(() => expect(screen.getByText("Endorsed")).toBeTruthy());
    await checkAllConsents();

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Enter birth place"), {
        target: { value: "London" },
      });
      fireEvent.change(screen.getByPlaceholderText("https://... or ipfs://..."), {
        target: { value: "ipfs://token" },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Mint NFT/i }));
    });

    await waitFor(() => expect(mocks.mintRunOrThrow).toHaveBeenCalledTimes(1));
    expect(mocks.mintRunOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        personHash,
        versionIndex: 2,
        tokenURI: "ipfs://token",
        coreInfo: expect.objectContaining({
          supplementInfo: expect.objectContaining({
            fullName: "Ada Lovelace",
            birthPlace: "London",
          }),
        }),
      }),
    );
    expect(mocks.markVersionMinted).toHaveBeenCalledTimes(1);
    expect(mocks.markVersionMinted).toHaveBeenCalledWith({
      personHash,
      versionIndex: 2,
      tokenId: "77",
      tokenURI: "ipfs://token",
      receipt: { hash: "0xmint" },
    });
    expect(mocks.onSuccess).toHaveBeenCalledWith(77);
    expect(await screen.findByText("NFT Minted Successfully")).toBeTruthy();
  });

  it("shows a friendly error when the mint flow fails", async () => {
    mocks.mintRunOrThrow.mockRejectedValue(new Error("mint reverted"));

    renderMintModal();

    await waitFor(() => expect(screen.getByText("Endorsed")).toBeTruthy());
    await checkAllConsents();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Mint NFT/i }));
    });

    await waitFor(() => expect(mocks.mintRunOrThrow).toHaveBeenCalledTimes(1));
    expect(mocks.onSuccess).not.toHaveBeenCalled();
    expect(mocks.markVersionMinted).not.toHaveBeenCalled();
    expect(await screen.findByText("NFT Minting Failed")).toBeTruthy();
    expect(screen.getAllByText("mint reverted").length).toBeGreaterThan(0);
  });
});

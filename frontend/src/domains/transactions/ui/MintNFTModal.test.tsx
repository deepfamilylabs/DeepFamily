// @vitest-environment jsdom
import React, { forwardRef, useEffect, useImperativeHandle } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ethers } from "ethers";
import MintNFTModal from "./MintNFTModal";

const personHash = `0x${"12".repeat(32)}`;
const ownerAddress = "0x00000000000000000000000000000000000000aa";
const metadataEnvelope = `0x44464d3101${"00".repeat(11)}00000001`;

const mocks = vi.hoisted(() => ({
  address: "0x00000000000000000000000000000000000000aa",
  getVersionDetails: vi.fn(),
  getMetadataCode: vi.fn(),
  endorsedVersionIndex: vi.fn(),
  contract: {} as any,
  mintRunOrThrow: vi.fn(),
  mintReset: vi.fn(),
  markVersionMinted: vi.fn(),
  onClose: vi.fn(),
  onSuccess: vi.fn(),
  onGoEndorse: vi.fn(),
  zkWorkerCall: vi.fn(),
  cryptoWorkerCall: vi.fn(),
  nodesData: {} as Record<string, any>,
}));

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("../../wallet", () => ({
  useWallet: () => ({
    address: mocks.address,
  }),
}));

vi.mock("../hooks/useContractClient", () => ({
  useContractClient: () => ({
    getVersionDetails: mocks.getVersionDetails,
    getMetadataCode: mocks.getMetadataCode,
    contract: mocks.contract,
  }),
}));

vi.mock("../../tree", () => ({
  useTreeMutations: () => ({
    markVersionMinted: mocks.markVersionMinted,
  }),
  useTreeGraphData: () => ({ nodesData: mocks.nodesData }),
}));

vi.mock("./mint-nft/hooks/useMintNftFlow", () => ({
  useMintNftFlow: () => ({
    status: "idle",
    reset: mocks.mintReset,
    runOrThrow: mocks.mintRunOrThrow,
  }),
}));

vi.mock("../../../shared/workers/zkWorkerClient", () => ({
  zkWorkerCall: (...args: any[]) => mocks.zkWorkerCall(...args),
}));

vi.mock("../../../shared/workers/cryptoWorkerClient", () => ({
  cryptoWorkerCall: (...args: any[]) => mocks.cryptoWorkerCall(...args),
}));

vi.mock("../../../shared/zk/zk", () => ({
  computeDisclosureBinding: () => 99n,
  formatGroth16ProofForContract: () => ({
    circuitId: 1,
    proofEncodingId: 1,
    proofData: "0x",
  }),
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
    mocks.getMetadataCode.mockReset();
    mocks.endorsedVersionIndex.mockReset();
    mocks.contract = {
      endorsedVersionIndex: mocks.endorsedVersionIndex,
    };
    mocks.mintRunOrThrow.mockReset();
    mocks.mintReset.mockReset();
    mocks.markVersionMinted.mockReset();
    mocks.onClose.mockReset();
    mocks.onSuccess.mockReset();
    mocks.onGoEndorse.mockReset();
    mocks.zkWorkerCall.mockReset();
    mocks.cryptoWorkerCall.mockReset();
    mocks.nodesData = {};

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
      metadata: {
        pointer: "0x0000000000000000000000000000000000000fed",
        payloadHash: ethers.keccak256(metadataEnvelope),
        payloadLength: ethers.getBytes(metadataEnvelope).length,
      },
    });
    mocks.getMetadataCode.mockResolvedValue(`0x00${metadataEnvelope.slice(2)}`);
    mocks.endorsedVersionIndex.mockResolvedValue(2);
    mocks.zkWorkerCall.mockImplementation((method: string) => {
      if (method === "generateDisclosureBindingProof") {
        return Promise.resolve({
          proof: { pi_a: [], pi_b: [], pi_c: [] },
          publicSignals: ["1", "99", "2", "3"],
        });
      }
      if (method === "verifyDisclosureBindingProof") {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error(`unexpected zk method ${method}`));
    });
    mocks.cryptoWorkerCall.mockResolvedValue({
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
      identityCommitment: "1",
      personHash,
      nameField: "2",
      suiteCommitment: "3",
      packedBirthGenderField: "4",
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
        selfSuiteId: 1,
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

  it("copies only a validated unlocked biography after an explicit public disclosure confirmation", async () => {
    mocks.nodesData = {
      [`${personHash}-v-2`]: {
        id: `${personHash}-v-2`,
        personHash,
        versionIndex: 2,
        metadataUnlockValidated: true,
        biography: "Validated private biography",
      },
    };

    renderMintModal();

    const copyButton = await screen.findByRole("button", {
      name: "Copy biography into public story",
    });
    expect((copyButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(
      screen.getByLabelText(
        "I understand this copies decrypted private biography text into a public, immutable NFT field.",
      ),
    );
    expect((copyButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(copyButton);

    const story = screen.getByPlaceholderText("Enter a brief life story summary...");
    expect((story as HTMLTextAreaElement).value).toBe("Validated private biography");
  });

  it("never offers cached biography text without the validated unlock marker", async () => {
    mocks.nodesData = {
      [`${personHash}-v-2`]: {
        id: `${personHash}-v-2`,
        personHash,
        versionIndex: 2,
        biography: "Untrusted cached text",
      },
    };

    renderMintModal();
    await waitFor(() => expect(screen.getByText("Endorsed")).toBeTruthy());

    expect(screen.queryByRole("button", { name: "Copy biography into public story" })).toBeNull();
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

  it("opens the endorsement handoff when the target version is not endorsed", async () => {
    mocks.endorsedVersionIndex.mockResolvedValue(1);

    renderMintModal();

    await waitFor(() => expect(screen.getByText("Not Endorsed")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Go Endorse" }));
    });

    expect(screen.getByText("Endorsement Required")).toBeTruthy();

    await act(async () => {
      const endorseButtons = screen.getAllByRole("button", { name: "Go Endorse" });
      fireEvent.click(endorseButtons[endorseButtons.length - 1]);
    });

    expect(mocks.onGoEndorse).toHaveBeenCalledWith(personHash, 2);
    expect(mocks.mintRunOrThrow).not.toHaveBeenCalled();
  });
});

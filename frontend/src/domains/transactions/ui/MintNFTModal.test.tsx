// @vitest-environment jsdom
import React, { forwardRef, useEffect, useImperativeHandle } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ethers } from "ethers";
import MintNFTModal from "./MintNFTModal";
import { formSectionsHidden, precedesFormSections } from "./transactionPhaseContract";

const personHash = `0x${"12".repeat(32)}`;
const ownerAddress = "0x00000000000000000000000000000000000000aa";
const metadataEnvelope = `0x44464d3101${"00".repeat(11)}00000001`;

const mocks = vi.hoisted(() => ({
  address: "0x00000000000000000000000000000000000000aa",
  getVersionDetails: vi.fn(),
  getMetadataCode: vi.fn(),
  endorsedVersionIndex: vi.fn(),
  contract: {} as any,
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
  mintRunOrThrow: vi.fn(),
  mintReset: vi.fn(),
  mintFlow: { status: "idle" } as { status: string },
  confirmTransactionPreview: null as null | ((preview: any) => Promise<boolean> | boolean),
  markVersionMinted: vi.fn(),
  onClose: vi.fn(),
  onSuccess: vi.fn(),
  onGoEndorse: vi.fn(),
  zkWorkerCall: vi.fn(),
  cryptoWorkerCall: vi.fn(),
  nodesData: {} as Record<string, any>,
  personPassphrase: "",
  passphrasesMatch: true,
  clearSecretInputs: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
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
  useMintNftFlow: (options?: any) => {
    mocks.confirmTransactionPreview = options?.confirmTransactionPreview ?? null;
    return {
      status: mocks.mintFlow.status,
      reset: mocks.mintReset,
      runOrThrow: mocks.mintRunOrThrow,
    };
  },
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
  usePersonGateway: () => mocks.personGateway,
  PersonHashCalculator: forwardRef((props: any, ref) => {
    useImperativeHandle(ref, () => ({
      getSecretInputs: () => ({ passphrase: mocks.personPassphrase }),
      getPublicFormData: () => ({
        fullName: "Ada Lovelace",
        gender: 2,
        birthYear: 1815,
        birthMonth: 12,
        birthDay: 10,
        isBirthBC: false,
      }),
      hasPassphrase: () => mocks.personPassphrase.length > 0,
      passphrasesMatch: () => mocks.passphrasesMatch,
      clearSecretInputs: () => mocks.clearSecretInputs(),
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

    return (
      <div data-testid="person-hash-calculator">
        <input
          aria-label="mint identity passphrase test input"
          onChange={(event) => {
            mocks.personPassphrase = event.currentTarget.value;
            const risk =
              mocks.personPassphrase.length === 0
                ? "empty"
                : /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/u.test(
                      mocks.personPassphrase,
                    )
                  ? "unicode-whitespace"
                  : "ordinary";
            props.onPassphraseChange?.(risk);
          }}
        />
      </div>
    );
  }),
}));

function mintModalElement(overrides: Partial<React.ComponentProps<typeof MintNFTModal>> = {}) {
  return (
    <MintNFTModal
      isOpen
      initialPersonHash={personHash}
      initialVersionIndex={2}
      onClose={mocks.onClose}
      onSuccess={mocks.onSuccess}
      onGoEndorse={mocks.onGoEndorse}
      {...overrides}
    />
  );
}

function renderMintModal(overrides: Partial<React.ComponentProps<typeof MintNFTModal>> = {}) {
  const result = render(mintModalElement(overrides));
  /** Re-renders with the current mock state, for phases the flow enters later. */
  return { ...result, refresh: () => result.rerender(mintModalElement(overrides)) };
}

async function checkAllConsents() {
  for (const checkbox of screen.getAllByRole("checkbox")) {
    await act(async () => {
      fireEvent.click(checkbox);
    });
  }
}

/** The mint button replaces "Go Endorse" only once the target checks out. */
async function waitForMintableTarget() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Mint NFT" })).toBeTruthy());
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
    mocks.mintFlow = { status: "idle" };
    mocks.confirmTransactionPreview = null;
    mocks.markVersionMinted.mockReset();
    mocks.onClose.mockReset();
    mocks.onSuccess.mockReset();
    mocks.onGoEndorse.mockReset();
    mocks.zkWorkerCall.mockReset();
    mocks.cryptoWorkerCall.mockReset();
    mocks.nodesData = {};
    mocks.personPassphrase = "";
    mocks.passphrasesMatch = true;
    mocks.clearSecretInputs.mockReset();

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
        segmentCount: 1,
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

    await waitForMintableTarget();
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
    // The passphrase must be gone before the wallet wait, not merely by the end.
    expect(mocks.clearSecretInputs).toHaveBeenCalledTimes(1);
    expect(mocks.clearSecretInputs.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.mintRunOrThrow.mock.invocationCallOrder[0],
    );
    expect(await screen.findByText("NFT Minted Successfully")).toBeTruthy();
    expect(formSectionsHidden()).toBe(true);
  });

  it("keeps minting disabled until every consent is checked, whatever the passphrase", async () => {
    renderMintModal();

    await waitForMintableTarget();
    const mintButton = () => screen.getByRole("button", { name: /Mint NFT/i }) as HTMLButtonElement;
    expect(mintButton().disabled).toBe(true);

    // A risky passphrase adds no extra confirmation: the mint publishes the
    // identity fields in plaintext anyway, which consentPublic already covers.
    fireEvent.change(screen.getByLabelText("mint identity passphrase test input"), {
      target: { value: "\u0085\u3000" },
    });
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);

    await checkAllConsents();
    expect(mintButton().disabled).toBe(false);
    expect(mocks.mintRunOrThrow).not.toHaveBeenCalled();
  });

  it("copies only a validated unlocked biography after an explicit public disclosure confirmation", async () => {
    mocks.nodesData = {
      [`${personHash}-v-2`]: {
        id: `${personHash}-v-2`,
        personHash,
        versionIndex: 2,
        versionCommitment: "99",
        metadataPointer: `0x${"34".repeat(20)}`,
        metadataPayloadHash: `0x${"56".repeat(32)}`,
        metadataSegmentCount: 1,
        metadataPayloadLength: 256,
        metadataUnlockValidated: true,
        metadataProtocolGeneration: "df-onchain-biography-v1",
        metadataFormatVersion: 1,
        identitySuiteId: 1,
        metadataPerson: {
          fullName: "Ada Lovelace",
          gender: 2,
          birthYear: 1815,
          birthMonth: 12,
          birthDay: 10,
          isBirthBC: false,
          personHash,
        },
        metadataParents: { father: null, mother: null },
        tag: "",
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
    await waitForMintableTarget();

    expect(screen.queryByRole("button", { name: "Copy biography into public story" })).toBeNull();
  });

  it("never offers marker-only cached biography missing format and suite evidence", async () => {
    mocks.nodesData = {
      [`${personHash}-v-2`]: {
        id: `${personHash}-v-2`,
        personHash,
        versionIndex: 2,
        metadataUnlockValidated: true,
        biography: "Marker-only cached text",
      },
    };

    renderMintModal();
    await waitForMintableTarget();

    expect(screen.queryByRole("button", { name: "Copy biography into public story" })).toBeNull();
  });

  it("shows a friendly error when the mint flow fails", async () => {
    mocks.mintRunOrThrow.mockRejectedValue(new Error("mint reverted"));

    renderMintModal();

    await waitForMintableTarget();
    await checkAllConsents();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Mint NFT/i }));
    });

    await waitFor(() => expect(mocks.mintRunOrThrow).toHaveBeenCalledTimes(1));
    expect(mocks.onSuccess).not.toHaveBeenCalled();
    expect(mocks.markVersionMinted).not.toHaveBeenCalled();
    const alert = await screen.findByRole("alert");
    expect(screen.getAllByText("mint reverted").length).toBeGreaterThan(0);
    // The form stays up to be corrected, so the alert has to come to the user.
    expect(formSectionsHidden()).toBe(false);
    expect(document.activeElement).toBe(alert);
    expect(precedesFormSections(alert)).toBe(true);
  });

  it("drops the chosen version when the hash is cleared", async () => {
    renderMintModal();
    await waitForMintableTarget();

    await act(async () => {
      // The placeholder here carries no fallback, so the mocked t() yields the key.
      fireEvent.change(screen.getByPlaceholderText("search.versionsQuery.placeholder"), {
        target: { value: "" },
      });
    });

    // A version decided for the previous hash must not linger as a bare choice.
    const picker = await screen.findByRole("button", { name: /Select a version/ });
    expect(picker.hasAttribute("disabled")).toBe(true);
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
    };

    it("shares its spine with adding a version, minus what minting does not do", async () => {
      renderMintModal();
      await waitForMintableTarget();
      await act(async () => {
        void mocks.confirmTransactionPreview?.(preview);
      });

      const labels = Array.from(document.querySelectorAll("ol li")).map(
        (li) => li.querySelector("div")?.nextElementSibling?.firstElementChild?.textContent ?? "",
      );
      // Minting publishes plain text, so it has no envelope to encrypt; every
      // other step is work both flows do and must present the same way.
      expect(labels).toEqual([
        "Derive identity material",
        "Generate zero-knowledge proof",
        "Confirm the transaction",
        "Waiting for on-chain confirmation",
      ]);
    });

    it("waits on the user at the confirm step rather than looking busy", async () => {
      renderMintModal();
      await waitForMintableTarget();
      await act(async () => {
        void mocks.confirmTransactionPreview?.(preview);
      });
      // A spinner here would claim the flow is working when it is the user's
      // turn, which reads as a step already under way.
      const marks = Array.from(document.querySelectorAll("ol li")).map(
        (li) => li.querySelector("svg")?.getAttribute("class")?.match(/lucide-([a-z-]+)/)?.[1] ?? "dot",
      );
      const confirmIndex = marks.length - 2;
      expect(marks[confirmIndex]).toBe("arrow-right");
      expect(marks.slice(0, confirmIndex).every((mark) => mark === "check")).toBe(true);
      expect(marks[marks.length - 1]).toBe("dot");
    });

    it("keeps the form on screen while it is the user's turn", async () => {
      renderMintModal();
      await waitForMintableTarget();

      expect(formSectionsHidden()).toBe(false);
    });

    it("hides the form and shows progress while the flow is busy", async () => {
      mocks.mintFlow.status = "submitting";

      renderMintModal();
      // Submitting with no proof step under way means the gas estimate that
      // produces the preview: the confirm row, not yet the user's turn.
      const progress = await screen.findByRole("status", {
        name: "Transactions: Confirm the transaction",
      });
      expect(screen.getByText("Estimating the transaction fee…")).toBeTruthy();

      expect(formSectionsHidden()).toBe(true);
      expect(precedesFormSections(progress)).toBe(true);
    });

    it("hides the form and focuses the frozen package while it awaits a decision", async () => {
      renderMintModal();
      await waitForMintableTarget();

      // The flow asks the controller to confirm; that is what raises the panel,
      // mid-submission and long after the dialog took focus on open.
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

  it("opens the endorsement handoff when the target version is not endorsed", async () => {
    mocks.endorsedVersionIndex.mockResolvedValue(1);

    renderMintModal();

    await waitFor(() => expect(screen.getByRole("button", { name: "Go Endorse" })).toBeTruthy());

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

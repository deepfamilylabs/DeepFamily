// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EndorseModal from "./EndorseModal";

const personHash = `0x${"cd".repeat(32)}`;
const address = "0x00000000000000000000000000000000000000aa";
const recipient = "0x00000000000000000000000000000000000000bb";
const deepTokenAddress = "0x00000000000000000000000000000000000000dd";

const mocks = vi.hoisted(() => ({
  contract: {} as any,
  tokenContract: {} as any,
  getVersionDetails: vi.fn(),
  getNFTDetails: vi.fn(),
  getOwnerOf: vi.fn(),
  bumpEndorsementCount: vi.fn(),
  invalidateByTx: vi.fn(),
  endorseRun: vi.fn(),
  flowState: {
    status: "idle",
    result: null as any,
    error: null as any,
  },
  onClose: vi.fn(),
  onSuccess: vi.fn(),
  onMintNFT: vi.fn(),
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
}));

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

vi.mock("../../person", () => ({
  usePersonGateway: () => mocks.personGateway,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, vars?: Record<string, unknown>) =>
      (fallback ?? key).replace(/{{(\w+)}}/g, (match, name) =>
        vars && name in vars ? String(vars[name]) : match,
      ),
  }),
}));

vi.mock("../../wallet", () => ({
  useWallet: () => ({
    address,
    signer: {},
  }),
}));

vi.mock("../hooks/useContractClient", () => ({
  useContractClient: () => ({
    getVersionDetails: mocks.getVersionDetails,
    getNFTDetails: mocks.getNFTDetails,
    contract: mocks.contract,
  }),
}));

vi.mock("../../../shared/clients/contractFactory", () => ({
  createDeepTokenContract: () => mocks.tokenContract,
}));

vi.mock("../../tree", () => ({
  useTreeMutations: () => ({
    bumpEndorsementCount: mocks.bumpEndorsementCount,
    invalidateByTx: mocks.invalidateByTx,
  }),
  useTreeNodeAccess: () => ({
    getOwnerOf: mocks.getOwnerOf,
  }),
}));

vi.mock("./endorse/hooks/useEndorseFlow", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    useEndorseFlow: () => {
      const [, rerender] = React.useState(0);
      const reset = React.useCallback(() => {
        mocks.flowState.status = "idle";
        mocks.flowState.result = null;
        mocks.flowState.error = null;
        rerender((value) => value + 1);
      }, [rerender]);
      const run = React.useCallback(
        (args: any) => {
          mocks.endorseRun(args);
          rerender((value) => value + 1);
        },
        [rerender],
      );
      return {
        status: mocks.flowState.status,
        result: mocks.flowState.result,
        error: mocks.flowState.error,
        reset,
        run,
      };
    },
  };
});

vi.mock("../../../shared/lib/errors", () => ({
  getFriendlyError: (error: any) => ({
    type: error?.type || "UNKNOWN_ERROR",
    reason: error?.reason || error?.code,
    message: error?.message || "Operation failed",
    details: error?.details || error?.message || "Operation failed",
  }),
}));

function renderEndorseModal() {
  return render(
    <EndorseModal
      isOpen
      initialPersonHash={personHash}
      initialVersionIndex={2}
      onClose={mocks.onClose}
      onSuccess={mocks.onSuccess}
      onMintNFT={mocks.onMintNFT}
    />,
  );
}

function renderConfigurableEndorseModal(props: {
  isOpen: boolean;
  initialPersonHash?: string;
  initialVersionIndex?: number;
}) {
  return (
    <EndorseModal
      isOpen={props.isOpen}
      initialPersonHash={props.initialPersonHash}
      initialVersionIndex={props.initialVersionIndex}
      onClose={mocks.onClose}
      onSuccess={mocks.onSuccess}
      onMintNFT={mocks.onMintNFT}
    />
  );
}

/** The submit button unlocks only once the target resolves on chain. */
async function waitForResolvedTarget() {
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /^Endorse$/i }).hasAttribute("disabled"),
    ).toBe(false),
  );
}

describe("EndorseModal", () => {
  beforeEach(() => {
    mocks.getVersionDetails.mockReset();
    mocks.getNFTDetails.mockReset();
    mocks.getOwnerOf.mockReset();
    mocks.bumpEndorsementCount.mockReset();
    mocks.invalidateByTx.mockReset();
    mocks.endorseRun.mockReset();
    mocks.onClose.mockReset();
    mocks.onSuccess.mockReset();
    mocks.onMintNFT.mockReset();
    mocks.flowState.status = "idle";
    mocks.flowState.result = null;
    mocks.flowState.error = null;

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

    mocks.contract = {
      runner: {},
      DEEP_FAMILY_TOKEN_CONTRACT: vi.fn().mockResolvedValue(deepTokenAddress),
      protocolEndorsementFeeBps: vi.fn().mockResolvedValue(500),
      endorsedVersionIndex: vi.fn().mockResolvedValue(0),
      ownerOf: vi.fn().mockResolvedValue(recipient),
    };
    mocks.tokenContract = {
      recentReward: vi.fn().mockResolvedValue(1_000_000_000_000_000_000n),
      decimals: vi.fn().mockResolvedValue(18),
      symbol: vi.fn().mockResolvedValue("DEEP"),
      balanceOf: vi.fn().mockResolvedValue(10_000_000_000_000_000_000n),
    };
    mocks.getVersionDetails.mockResolvedValue({
      tokenId: "0",
      endorsementCount: 4,
      version: {
        addedBy: recipient,
        fullName: "Ada Lovelace",
      },
    });
    mocks.getOwnerOf.mockResolvedValue(null);
    mocks.personGateway.listVersionEndorsements.mockReset();
    mocks.personGateway.listPersonVersionsPage.mockReset();
    mocks.personGateway.listVersionEndorsements.mockResolvedValue({
      versionIndices: [],
      endorsementCounts: [],
      tokenIds: [],
      totalVersions: 0,
      hasMore: false,
      nextOffset: 0,
    });
    mocks.personGateway.listPersonVersionsPage.mockResolvedValue({
      versions: [],
      totalVersions: 0,
      hasMore: false,
      nextOffset: 0,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("offers no version until a hash resolves to one", async () => {
    render(renderConfigurableEndorseModal({ isOpen: true }));

    const picker = screen.getByRole("button", { name: /Select a version/ });
    expect(picker.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText(/Version 1/)).toBeNull();
  });

  it("preselects the most endorsed version for a hash the caller did not pin", async () => {
    mocks.personGateway.listVersionEndorsements.mockResolvedValueOnce({
      versionIndices: [1, 2],
      endorsementCounts: [1, 6],
      tokenIds: [0, 0],
      totalVersions: 2,
      hasMore: false,
      nextOffset: 0,
    });
    mocks.personGateway.listPersonVersionsPage.mockResolvedValueOnce({
      versions: [
        { versionIndex: 1, addedBy: recipient, timestamp: 1_700_000_000 },
        { versionIndex: 2, addedBy: recipient, timestamp: 1_700_000_000 },
      ],
      totalVersions: 2,
      hasMore: false,
      nextOffset: 0,
    });

    render(renderConfigurableEndorseModal({ isOpen: true, initialPersonHash: personHash }));

    expect(
      await screen.findByRole("button", { name: /Version 2 · 6 endorsements/ }),
    ).toBeTruthy();
  });

  it("drops the chosen version when the hash is cleared", async () => {
    mocks.personGateway.listVersionEndorsements.mockResolvedValue({
      versionIndices: [1],
      endorsementCounts: [3],
      tokenIds: [0],
      totalVersions: 1,
      hasMore: false,
      nextOffset: 0,
    });
    mocks.personGateway.listPersonVersionsPage.mockResolvedValue({
      versions: [{ versionIndex: 1, addedBy: recipient, timestamp: 1_700_000_000 }],
      totalVersions: 1,
      hasMore: false,
      nextOffset: 0,
    });

    render(renderConfigurableEndorseModal({ isOpen: true, initialPersonHash: personHash }));
    await screen.findByRole("button", { name: /Version 1 · 3 endorsements/ });

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Search by person hash"), {
        target: { value: "" },
      });
    });

    const picker = await screen.findByRole("button", { name: /Select a version/ });
    expect(picker.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText(/Version 1/)).toBeNull();
  });

  it("carries each version's submitter and date inside the picker", async () => {
    mocks.personGateway.listVersionEndorsements.mockResolvedValueOnce({
      versionIndices: [1],
      endorsementCounts: [4],
      tokenIds: [0],
      totalVersions: 1,
      hasMore: false,
      nextOffset: 0,
    });
    mocks.personGateway.listPersonVersionsPage.mockResolvedValueOnce({
      versions: [{ versionIndex: 1, addedBy: recipient, timestamp: 1_700_000_000 }],
      totalVersions: 1,
      hasMore: false,
      nextOffset: 0,
    });

    render(renderConfigurableEndorseModal({ isOpen: true, initialPersonHash: personHash }));

    const picker = await screen.findByRole("button", { name: /Version 1 · 4 endorsements/ });
    await act(async () => {
      fireEvent.click(picker);
    });

    const expectedDate = new Date(1_700_000_000 * 1000).toLocaleDateString();
    expect(screen.getByText(`0x00000000...000000bb · ${expectedDate}`)).toBeTruthy();
  });

  it("runs the endorse flow and applies success side effects", async () => {
    const result = {
      feeFormatted: "1.0",
      fee: 1_000_000_000_000_000_000n,
      decimals: 18,
      symbol: "DEEP",
      balanceBefore: 10_000_000_000_000_000_000n,
      transactionHash: "0xendorse",
      blockNumber: 321,
      receipt: { hash: "0xendorse" },
      event: {
        personHash,
        endorser: address,
        versionIndex: 2,
        recipient,
        recipientShare: 950_000_000_000_000_000n,
        protocolRecipient: "0x00000000000000000000000000000000000000cc",
        protocolShare: 50_000_000_000_000_000n,
        endorsementFee: 1_000_000_000_000_000_000n,
        timestamp: 777,
      },
    };
    mocks.endorseRun.mockImplementation((args: any) => {
      args.onStageChange?.("submitting");
      mocks.flowState.status = "success";
      mocks.flowState.result = result;
      mocks.flowState.error = null;
    });

    renderEndorseModal();

    await waitForResolvedTarget();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Endorse$/i }));
    });

    await waitFor(() => expect(mocks.bumpEndorsementCount).toHaveBeenCalledWith(personHash, 2, 1));
    expect(mocks.endorseRun).toHaveBeenCalledWith(
      expect.objectContaining({
        personHash,
        versionIndex: 2,
        deepTokenAddress,
        suppressToasts: false,
      }),
    );
    expect(mocks.invalidateByTx).toHaveBeenCalledWith({
      receipt: { hash: "0xendorse" },
      hints: { personHash, versionIndex: 2 },
    });
    expect(mocks.onSuccess).toHaveBeenCalledWith({
      hash: "0xendorse",
      endorsementCount: 5,
    });
    expect(await screen.findByText("Endorsement Successful")).toBeTruthy();
  });

  it("shows a friendly error when the endorse flow fails", async () => {
    mocks.endorseRun.mockImplementation((args: any) => {
      args.onStageChange?.("submitting");
      mocks.flowState.status = "error";
      mocks.flowState.error = new Error("endorse reverted");
      mocks.flowState.result = null;
    });

    renderEndorseModal();

    await waitForResolvedTarget();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Endorse$/i }));
    });

    await waitFor(() => expect(screen.getByText("Endorsement Failed")).toBeTruthy());
    expect(mocks.bumpEndorsementCount).not.toHaveBeenCalled();
    expect(mocks.invalidateByTx).not.toHaveBeenCalled();
    expect(mocks.onSuccess).not.toHaveBeenCalled();
    expect(screen.getAllByText("endorse reverted").length).toBeGreaterThan(0);
  });

  it("does not reuse a previous success result when reopened for another version", async () => {
    const firstResult = {
      feeFormatted: "1.0",
      fee: 1_000_000_000_000_000_000n,
      decimals: 18,
      symbol: "DEEP",
      balanceBefore: 10_000_000_000_000_000_000n,
      transactionHash: "0xendorse-v2",
      blockNumber: 321,
      receipt: { hash: "0xendorse-v2" },
      event: {
        personHash,
        endorser: address,
        versionIndex: 2,
        recipient,
        recipientShare: 950_000_000_000_000_000n,
        protocolRecipient: "0x00000000000000000000000000000000000000cc",
        protocolShare: 50_000_000_000_000_000n,
        endorsementFee: 1_000_000_000_000_000_000n,
        timestamp: 777,
      },
    };
    mocks.getVersionDetails.mockImplementation((_hash: string, index: number) =>
      Promise.resolve({
        tokenId: "0",
        endorsementCount: index === 3 ? 8 : 4,
        version: {
          addedBy: recipient,
          fullName: index === 3 ? "Grace Hopper" : "Ada Lovelace",
        },
      }),
    );
    mocks.endorseRun.mockImplementation((args: any) => {
      args.onStageChange?.("submitting");
      mocks.flowState.status = "success";
      mocks.flowState.result = firstResult;
      mocks.flowState.error = null;
    });

    const { rerender } = render(
      renderConfigurableEndorseModal({
        isOpen: true,
        initialPersonHash: personHash,
        initialVersionIndex: 2,
      }),
    );

    await waitForResolvedTarget();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Endorse$/i }));
    });

    await waitFor(() => expect(screen.getByText("Endorsement Successful")).toBeTruthy());
    expect(screen.getByText("0xendorse-v2")).toBeTruthy();

    rerender(
      renderConfigurableEndorseModal({
        isOpen: false,
        initialPersonHash: personHash,
        initialVersionIndex: 2,
      }),
    );

    rerender(
      renderConfigurableEndorseModal({
        isOpen: true,
        initialPersonHash: personHash,
        initialVersionIndex: 3,
      }),
    );

    await waitFor(() => expect(screen.getByRole("button", { name: /Version 3/ })).toBeTruthy());
    await waitForResolvedTarget();
    expect(screen.queryByText("Endorsement Successful")).toBeNull();
    expect(screen.queryByText("0xendorse-v2")).toBeNull();
  });
});

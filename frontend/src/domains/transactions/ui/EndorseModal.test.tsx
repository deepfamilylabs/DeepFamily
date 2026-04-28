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
      return {
        status: mocks.flowState.status,
        result: mocks.flowState.result,
        error: mocks.flowState.error,
        reset: () => {
          mocks.flowState.status = "idle";
          mocks.flowState.result = null;
          mocks.flowState.error = null;
          rerender((value) => value + 1);
        },
        run: (args: any) => {
          mocks.endorseRun(args);
          rerender((value) => value + 1);
        },
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
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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

    await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeTruthy());

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

    await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Endorse$/i }));
    });

    await waitFor(() => expect(screen.getByText("Endorsement Failed")).toBeTruthy());
    expect(mocks.bumpEndorsementCount).not.toHaveBeenCalled();
    expect(mocks.invalidateByTx).not.toHaveBeenCalled();
    expect(mocks.onSuccess).not.toHaveBeenCalled();
    expect(screen.getAllByText("endorse reverted").length).toBeGreaterThan(0);
  });
});

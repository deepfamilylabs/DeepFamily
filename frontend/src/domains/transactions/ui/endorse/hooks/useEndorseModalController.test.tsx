// @vitest-environment jsdom
import React, { useState } from "react";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEndorseModalController } from "./useEndorseModalController";
import {
  TransactionCenterProvider,
  useTransactionCenter,
} from "../../../context/TransactionCenterContext";
const mocks = vi.hoisted(() => ({
  wallet: {
    address: "0x00000000000000000000000000000000000000aa",
    signer: { id: "old signer" } as any,
    provider: {},
  },
  config: {
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 31337,
    contractAddress: "0x0000000000000000000000000000000000000abc",
    readerAddress: "0x0000000000000000000000000000000000000def",
  },
  contracts: new Map<string, any>(),
  tokens: new Map<string, any>(),
  factory: vi.fn(),
  tokenFactory: vi.fn(),
  onSuccess: vi.fn(),
  reader: { getVersionDetails: vi.fn() },
  gateway: { listVersionEndorsements: vi.fn(), listPersonVersionsPage: vi.fn() },
  tree: { bumpEndorsementCount: vi.fn(), invalidateByTx: vi.fn(), getOwnerOf: vi.fn() },
}));
vi.mock("../../../../wallet", () => ({ useWallet: () => mocks.wallet }));
vi.mock("../../../../config", () => ({ useConfig: () => mocks.config }));
vi.mock("../../../../person", () => ({ usePersonGateway: () => mocks.gateway }));
vi.mock("../../../../tree", () => ({
  useTreeMutations: () => mocks.tree,
  useTreeNodeAccess: () => mocks.tree,
}));
vi.mock("../../../../../shared/clients/contractFactory", async () => ({
  ...(await vi.importActual<any>("../../../../../shared/clients/contractFactory")),
  createDeepFamilyContract: (...args: any[]) => mocks.factory(...args),
  createDeepTokenContract: (...args: any[]) => mocks.tokenFactory(...args),
  createDeepFamilyReaderContract: () => mocks.reader,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));
const hash = `0x${"cd".repeat(32)}`;
const oldToken = "0x0000000000000000000000000000000000000011";
const oldProxy = "0x0000000000000000000000000000000000000abc";
const walletAddress = "0x00000000000000000000000000000000000000aa";
function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
function fixture(proxy = oldProxy, tokenAddress = oldToken) {
  const receipt = { status: 1, hash: `0x${"fe".repeat(32)}`, blockNumber: 20, logs: [] };
  const send = Object.assign(
    vi.fn(async () => ({ hash: receipt.hash, wait: vi.fn(async () => receipt) })),
    { estimateGas: vi.fn(async () => 100n) },
  );
  const contract = {
    runner: mocks.wallet.signer,
    endorseVersion: send,
    DEEP_FAMILY_TOKEN_CONTRACT: vi.fn(async () => tokenAddress),
    getAddress: vi.fn(async () => proxy),
    endorsedVersionIndex: vi.fn(async () => 0),
    protocolEndorsementFeeBps: vi.fn(async () => 500),
  };
  const token = {
    recentReward: vi.fn(async () => 1n),
    balanceOf: vi.fn(async () => 100n),
    allowance: vi.fn(async () => 100n),
    approve: vi.fn(async () => ({ hash: "0xapprove", wait: vi.fn(async () => ({ status: 1 })) })),
    decimals: vi.fn(async () => 18),
    symbol: vi.fn(async () => "DEEP"),
  };
  mocks.contracts.set(proxy, contract);
  mocks.tokens.set(tokenAddress, token);
  return { contract, token, receipt, send };
}
function controller() {
  const [isOpen, setIsOpen] = useState(true);
  const result = useEndorseModalController({
    isOpen,
    onClose: () => setIsOpen(false),
    initialPersonHash: hash,
    initialVersionIndex: 2,
    onSuccess: mocks.onSuccess,
  });
  const centre = useTransactionCenter();
  return { ...result, isOpen, setIsOpen, centre };
}
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <TransactionCenterProvider>{children}</TransactionCenterProvider>
);
describe("endorsement cancellation and public receipt settlement", () => {
  beforeEach(() => {
    mocks.config.contractAddress = oldProxy;
    mocks.config.readerAddress = "0x0000000000000000000000000000000000000def";
    mocks.wallet.address = walletAddress;
    mocks.wallet.signer = { id: "old signer" };
    mocks.contracts.clear();
    mocks.tokens.clear();
    vi.clearAllMocks();
    mocks.factory.mockImplementation((address: string) => mocks.contracts.get(address));
    mocks.tokenFactory.mockImplementation((address: string) => mocks.tokens.get(address));
    mocks.reader.getVersionDetails.mockResolvedValue({
      tokenId: 0,
      endorsementCount: 2,
      version: { addedBy: walletAddress },
    });
    mocks.gateway.listVersionEndorsements.mockResolvedValue({
      versionIndices: [2],
      endorsementCounts: [2],
      tokenIds: [0],
      totalVersions: 1,
      hasMore: false,
      nextOffset: 0,
    });
    mocks.gateway.listPersonVersionsPage.mockResolvedValue({
      versions: [{ versionIndex: 2, addedBy: walletAddress, timestamp: 1 }],
      totalVersions: 1,
      hasMore: false,
      nextOffset: 0,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it("cancels a pending gas estimate before requesting endorsement", async () => {
    const f = fixture();
    const gate = defer<bigint>();
    f.send.estimateGas.mockReturnValue(gate.promise);
    const h = renderHook(controller, { wrapper });
    await vi.waitFor(() => expect(h.result.current.footer.isTargetValidOnChain).toBe(true));
    act(() => h.result.current.footer.onEndorse());
    await vi.waitFor(() => expect(f.send.estimateGas).toHaveBeenCalledTimes(1));
    act(() => h.result.current.frame.onClose());
    expect(h.result.current.isOpen).toBe(false);
    await act(async () => {
      gate.resolve(100n);
    });
    expect(f.send).not.toHaveBeenCalled();
  });
  it("cancels a pending allowance read before requesting approval", async () => {
    const f = fixture();
    const gate = defer<bigint>();
    f.token.allowance.mockReturnValue(gate.promise);
    const h = renderHook(controller, { wrapper });
    await vi.waitFor(() => expect(h.result.current.footer.isTargetValidOnChain).toBe(true));
    act(() => h.result.current.footer.onEndorse());
    await vi.waitFor(() => expect(f.token.allowance).toHaveBeenCalledTimes(1));
    act(() => h.result.current.frame.onClose());
    expect(h.result.current.isOpen).toBe(false);
    await act(async () => {
      gate.resolve(0n);
    });
    expect(f.token.approve).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("settles the original public record after unmount without updating another scope", async () => {
    const f = fixture();
    const gate = defer<any>();
    const waitForReceipt = vi.fn(() => gate.promise);
    f.send.mockResolvedValue({ hash: f.receipt.hash, wait: waitForReceipt });
    let latest!: ReturnType<typeof controller>;
    function Modal() {
      latest = controller();
      return null;
    }
    function Records() {
      return <output data-testid="records">{JSON.stringify(useTransactionCenter()?.records)}</output>;
    }
    const view = render(
      <TransactionCenterProvider><Modal /><Records /></TransactionCenterProvider>,
    );
    await vi.waitFor(() => expect(latest.footer.isTargetValidOnChain).toBe(true));
    act(() => latest.footer.onEndorse());
    await vi.waitFor(() => expect(waitForReceipt).toHaveBeenCalledOnce());
    const original = latest.centre!.records[0].id;
    act(() => latest.frame.onClose());
    expect(latest.isOpen).toBe(false);
    view.rerender(<TransactionCenterProvider><Records /></TransactionCenterProvider>);
    mocks.config.contractAddress = "0x0000000000000000000000000000000000000ddd";
    mocks.wallet.address = "0x00000000000000000000000000000000000000bb";
    await act(async () => {
      gate.resolve(f.receipt);
    });
    expect(JSON.parse(screen.getByTestId("records").textContent!)).toMatchObject([
      { id: original, phase: "done", transactionHash: f.receipt.hash },
    ]);
    expect(mocks.tree.bumpEndorsementCount).not.toHaveBeenCalled();
    expect(mocks.tree.invalidateByTx).not.toHaveBeenCalled();
    expect(mocks.onSuccess).not.toHaveBeenCalled();
  });

  it("ordinary close tracks the receipt without local completion, even after reopening", async () => {
    const f = fixture();
    const gate = defer<any>();
    const waitForReceipt = vi.fn(() => gate.promise);
    f.send.mockResolvedValue({ hash: f.receipt.hash, wait: waitForReceipt });
    const h = renderHook(controller, { wrapper });
    await vi.waitFor(() => expect(h.result.current.footer.isTargetValidOnChain).toBe(true));
    act(() => h.result.current.footer.onEndorse());
    await vi.waitFor(() => expect(waitForReceipt).toHaveBeenCalledOnce());
    const original = h.result.current.centre!.records[0].id;
    act(() => h.result.current.frame.onClose());
    act(() => h.result.current.setIsOpen(true));
    await act(async () => {
      gate.resolve(f.receipt);
    });
    expect(h.result.current.centre!.records.find((r) => r.id === original)).toMatchObject({
      phase: "done",
      transactionHash: f.receipt.hash,
    });
    expect(mocks.tree.invalidateByTx).not.toHaveBeenCalled();
    expect(mocks.onSuccess).not.toHaveBeenCalled();
    expect(mocks.tree.bumpEndorsementCount).not.toHaveBeenCalled();
    expect(h.result.current.statusPanel.successResult).toBeNull();
    expect(h.result.current.statusPanel.errorResult).toBeNull();
  });

  it("an old receipt settles its own record while a new attempt is still busy", async () => {
    const f = fixture();
    const oldReceipt = defer<any>();
    const nextEstimate = defer<bigint>();
    const waitForReceipt = vi.fn(() => oldReceipt.promise);
    f.send.mockResolvedValue({ hash: f.receipt.hash, wait: waitForReceipt });
    const h = renderHook(controller, { wrapper });
    await vi.waitFor(() => expect(h.result.current.footer.isTargetValidOnChain).toBe(true));
    act(() => h.result.current.footer.onEndorse());
    await vi.waitFor(() => expect(waitForReceipt).toHaveBeenCalledOnce());
    const original = h.result.current.centre!.records[0].id;
    act(() => h.result.current.frame.onClose());
    act(() => h.result.current.setIsOpen(true));
    await vi.waitFor(() => expect(h.result.current.footer.isTargetValidOnChain).toBe(true));
    f.send.estimateGas.mockReturnValue(nextEstimate.promise);
    act(() => h.result.current.footer.onEndorse());
    await vi.waitFor(() => expect(f.send.estimateGas).toHaveBeenCalledTimes(2));
    const second = h.result.current.centre!.records.find((r) => r.id !== original)!.id;
    await act(async () => {
      oldReceipt.resolve(f.receipt);
    });
    expect(h.result.current.centre!.records.find((r) => r.id === original)?.phase).toBe("done");
    expect(h.result.current.centre!.records.find((r) => r.id === second)?.phase).toBe("busy");
    expect(mocks.tree.invalidateByTx).not.toHaveBeenCalled();
    expect(mocks.onSuccess).not.toHaveBeenCalled();
    expect(h.result.current.statusPanel.successResult).toBeNull();
    act(() => h.result.current.frame.onClose());
    await act(async () => {
      nextEstimate.resolve(100n);
    });
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("cancels browser-back dismissal before a pending estimate can request the wallet", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    const f = fixture();
    const gate = defer<bigint>();
    f.send.estimateGas.mockReturnValue(gate.promise);
    const h = renderHook(controller, { wrapper });
    await vi.waitFor(() => expect(h.result.current.footer.isTargetValidOnChain).toBe(true));
    act(() => h.result.current.footer.onEndorse());
    await vi.waitFor(() => expect(f.send.estimateGas).toHaveBeenCalledTimes(1));
    act(() => {
      window.history.replaceState(null, "");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(h.result.current.isOpen).toBe(false);
    await act(async () => {
      gate.resolve(100n);
    });
    expect(f.send).not.toHaveBeenCalled();
  });
});

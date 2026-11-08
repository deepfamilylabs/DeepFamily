// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEndorseFlow } from "./useEndorseFlow";

const mocks = vi.hoisted(() => ({
  config: { chainId: 31337, contractAddress: "0x0000000000000000000000000000000000000abc" },
  wallet: { signer: null as any, address: "0x00000000000000000000000000000000000000aa" },
  generation: 0,
  contract: null as any,
  token: null as any,
}));
vi.mock("../../../../wallet", () => ({
  useWallet: () => mocks.wallet,
  getWalletConnectionGeneration: () => mocks.generation,
}));
vi.mock("../../../../config", () => ({ useConfig: () => mocks.config }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }) }));
vi.mock("../../../../../shared/clients/contractFactory", async (original) => ({
  ...await original<typeof import("../../../../../shared/clients/contractFactory")>(),
  createDeepFamilyContract: () => mocks.contract,
  createDeepTokenContract: () => mocks.token,
}));

const account = "0x00000000000000000000000000000000000000aa";
const nextAccount = "0x00000000000000000000000000000000000000bb";
const args = { personHash: `0x${"11".repeat(32)}`, versionIndex: 1 };

function fixture() {
  let actualChain = 31337n;
  let actualAccount = account;
  const provider = {
    getNetwork: vi.fn(async () => ({ chainId: actualChain })),
    getBlockNumber: vi.fn(async () => 12),
  };
  const signer = { provider, getAddress: vi.fn(async () => actualAccount) };
  const receipt = { hash: `0x${"22".repeat(32)}`, status: 1, blockNumber: 13, logs: [] };
  const approvalReceipt = { hash: `0x${"33".repeat(32)}`, status: 1, blockNumber: 12 };
  const endorse = Object.assign(vi.fn(async () => ({
    hash: receipt.hash, wait: vi.fn(async () => receipt), replaceableTransaction() { return this; },
  })), { estimateGas: vi.fn(async () => 100n) });
  const approve = vi.fn(async () => ({
    hash: approvalReceipt.hash, wait: vi.fn(async () => approvalReceipt), replaceableTransaction() { return this; },
  }));
  mocks.wallet.signer = signer;
  mocks.contract = {
    endorsedVersionIndex: vi.fn(async () => 0),
    DEEP_FAMILY_TOKEN_CONTRACT: async () => "0x0000000000000000000000000000000000000def",
    getAddress: async () => mocks.config.contractAddress,
    endorseVersion: endorse,
  };
  mocks.token = {
    recentReward: async () => 10n,
    balanceOf: async () => 100n,
    decimals: async () => 18,
    symbol: async () => "DEEP",
    allowance: vi.fn(async () => 0n),
    approve,
  };
  return {
    provider, signer, endorse, approve, receipt, approvalReceipt,
    setChain: (chain: bigint) => { actualChain = chain; },
    setAccount: (value: string) => { actualAccount = value; },
  };
}

beforeEach(() => {
  mocks.config.chainId = 31337;
  mocks.wallet.address = account;
  mocks.generation = 0;
});
afterEach(cleanup);

describe("endorsement actual wallet scope", () => {
  it("rejects a wallet already on the wrong chain before authorizing or endorsing", async () => {
    const f = fixture();
    f.setChain(1n);
    const hook = renderHook(() => useEndorseFlow());
    await act(async () => {
      await expect(hook.result.current.runOrThrow(args)).rejects.toMatchObject({ code: "CHAIN_WALLET_SCOPE_CHANGED" });
    });
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.endorse).not.toHaveBeenCalled();
    expect(mocks.contract.endorsedVersionIndex).not.toHaveBeenCalled();
  });

  it("validates the raw wallet chain instead of a cached provider network", async () => {
    const f = fixture();
    const send = vi.fn(async () => "0x1");
    Object.assign(f.provider, { send });
    const hook = renderHook(() => useEndorseFlow());
    await act(async () => {
      await expect(hook.result.current.runOrThrow(args)).rejects.toMatchObject({ code: "CHAIN_WALLET_SCOPE_CHANGED" });
    });
    expect(send).toHaveBeenCalledWith("eth_chainId", []);
    expect(f.provider.getNetwork).not.toHaveBeenCalled();
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.endorse).not.toHaveBeenCalled();
  });

  it.each(["chain", "account", "connection"])("stops approval after the %s changes during the allowance read", async (change) => {
    const f = fixture();
    mocks.token.allowance.mockImplementationOnce(async () => {
      if (change === "chain") f.setChain(1n);
      else if (change === "account") f.setAccount(nextAccount);
      else mocks.generation++;
      return 0n;
    });
    const hook = renderHook(() => useEndorseFlow());
    await act(async () => {
      await expect(hook.result.current.runOrThrow(args)).rejects.toMatchObject({ code: "CHAIN_WALLET_SCOPE_CHANGED" });
    });
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.endorse).not.toHaveBeenCalled();
  });

  it.each(["configuration", "signer"])("does not reuse an old %s after the view rerenders", async (change) => {
    const f = fixture();
    let finishAllowance!: (value: bigint) => void;
    mocks.token.allowance.mockImplementationOnce(() => new Promise<bigint>((resolve) => { finishAllowance = resolve; }));
    const hook = renderHook(() => useEndorseFlow());
    let pending!: ReturnType<typeof hook.result.current.runOrThrow>;
    act(() => { pending = hook.result.current.runOrThrow(args); });
    await vi.waitFor(() => expect(mocks.token.allowance).toHaveBeenCalledOnce());
    if (change === "configuration") mocks.config.chainId = 1;
    else mocks.wallet.signer = { ...f.signer };
    hook.rerender();
    const rejected = expect(pending).rejects.toMatchObject({ code: "CHAIN_WALLET_SCOPE_CHANGED" });
    await act(async () => {
      finishAllowance(0n);
      await rejected;
    });
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.endorse).not.toHaveBeenCalled();
  });

  it("does not endorse on another chain after an approval confirmed", async () => {
    const f = fixture();
    f.approve.mockImplementationOnce(async () => ({
      hash: f.approvalReceipt.hash,
      wait: vi.fn(async () => { f.setChain(1n); return f.approvalReceipt; }),
      replaceableTransaction() { return this; },
    }));
    const hook = renderHook(() => useEndorseFlow());
    await act(async () => {
      await expect(hook.result.current.runOrThrow(args)).rejects.toMatchObject({ code: "CHAIN_WALLET_SCOPE_CHANGED" });
    });
    expect(f.approve).toHaveBeenCalledOnce();
    expect(f.endorse).not.toHaveBeenCalled();
    expect(hook.result.current.tracking).toMatchObject({ state: "confirmed", transactionHash: f.approvalReceipt.hash });
  });

  it.each(["chain", "account"])("rechecks the %s after capturing the endorsement scan anchor", async (change) => {
    const f = fixture();
    mocks.token.allowance.mockResolvedValue(10n);
    f.provider.getBlockNumber.mockImplementationOnce(async () => {
      if (change === "chain") f.setChain(1n);
      else f.setAccount(nextAccount);
      return 12;
    });
    const hook = renderHook(() => useEndorseFlow());
    await act(async () => {
      await expect(hook.result.current.runOrThrow(args)).rejects.toMatchObject({ code: "CHAIN_WALLET_SCOPE_CHANGED" });
    });
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.endorse).not.toHaveBeenCalled();
  });

  it("completes the original approval and endorsement on the configured chain", async () => {
    const f = fixture();
    const hook = renderHook(() => useEndorseFlow());
    await act(async () => { await hook.result.current.runOrThrow(args); });
    expect(f.approve).toHaveBeenCalledOnce();
    expect(f.endorse).toHaveBeenCalledOnce();
    expect(hook.result.current.status).toBe("success");
    expect(hook.result.current.tracking).toMatchObject({ state: "confirmed", transactionHash: f.receipt.hash });
  });
});

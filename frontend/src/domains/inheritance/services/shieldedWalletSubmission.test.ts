import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContractTransactionResponse, TransactionResponse, Interface, type Contract, type Signer } from "ethers";
import { submitShieldedApproval, submitShieldedAuthorization } from "./shieldedWalletSubmission";

const mocks = vi.hoisted(() => ({ authorization: vi.fn() }));
vi.mock("../../../shared/clients/shieldedIdentityAuthorizationChain", () => ({ createIdentityAuthorizationContract: mocks.authorization }));
const account = "0x1111111111111111111111111111111111111111";
const target = "0x2222222222222222222222222222222222222222";
const spender = "0x3333333333333333333333333333333333333333";
const hash = `0x${"ab".repeat(32)}`;
function fixture() {
  const receipt = { hash, status: 1, blockNumber: 12 };
  const wait = vi.fn(async () => receipt);
  const replaceableTransaction = vi.fn(() => ({ hash, wait }));
  const approve = vi.fn(async () => ({ hash, wait, replaceableTransaction }));
  const incrementCounter = vi.fn(async () => ({ hash, wait, replaceableTransaction }));
  const provider = {
    getNetwork: vi.fn(async () => ({ chainId: 31337n })),
    getTransactionCount: vi.fn(async () => 4), getBlockNumber: vi.fn(async () => 10),
  };
  const signer = { provider, getAddress: vi.fn(async () => account) } as unknown as Signer;
  const contract = {
    interface: new Interface(["function approve(address,uint256)", "function incrementCounter(uint256,uint256,uint64,uint64,bytes)"]),
    getAddress: vi.fn(async () => target), balanceOf: vi.fn(async () => 100n),
    approve, incrementCounter, connect: vi.fn(),
  };
  contract.connect.mockReturnValue(contract);
  mocks.authorization.mockReturnValue(contract);
  return { contract, provider, signer, approve, incrementCounter, receipt, wait, replaceableTransaction };
}
beforeEach(() => vi.clearAllMocks());

describe("shielded wallet submission services", () => {
  it("freezes an exact approval nonce and publishes its hash before receipt tracking", async () => {
    const f = fixture();
    const onBroadcast = vi.fn();
    f.wait.mockImplementationOnce(async () => { expect(onBroadcast).toHaveBeenCalledWith(hash); return f.receipt; });
    const onSubmitting = vi.fn();
    await expect(submitShieldedApproval({
      signer: f.signer, chainId: 31337n, account,
      token: f.contract as unknown as Contract, spender, amount: 9n, onSubmitting, onBroadcast,
    })).resolves.toMatchObject({ transactionHash: hash, receipt: f.receipt });
    expect(onSubmitting).toHaveBeenCalledWith({ nonce: 4, fromBlock: 10, signerAddress: account });
    expect(f.approve).toHaveBeenCalledWith(spender, 9n, { nonce: 4, chainId: 31337n });
    expect(f.replaceableTransaction).toHaveBeenCalledWith(10);
  });

  it("checks cancellation after the pending nonce RPC before opening the wallet", async () => {
    const f = fixture();
    let current = true;
    f.provider.getTransactionCount.mockImplementationOnce(async () => { current = false; return 4; });
    const onWalletRequest = vi.fn();
    await expect(submitShieldedApproval({
      signer: f.signer, chainId: 31337n, account, token: f.contract as unknown as Contract,
      spender, amount: 9n, assertCurrent: () => { if (!current) throw new Error("cancelled"); }, onWalletRequest,
    })).rejects.toThrow("cancelled");
    expect(f.approve).not.toHaveBeenCalled();
    expect(onWalletRequest).not.toHaveBeenCalled();
  });

  it("returns a reverted receipt for explicit public reconciliation", async () => {
    const f = fixture();
    f.receipt.status = 0;
    f.wait.mockRejectedValueOnce(Object.assign(new Error("reverted"), {code: "CALL_EXCEPTION", receipt: f.receipt}));
    await expect(submitShieldedApproval({
      signer: f.signer, chainId: 31337n, account, token: f.contract as unknown as Contract, spender, amount: 9n,
    })).resolves.toMatchObject({ transactionHash: hash, receipt: { status: 0 } });
  });

  it("uses the same public tracking lifecycle for counter revocation", async () => {
    const f = fixture();
    const onSubmitting = vi.fn();
    const endWalletRequest = vi.fn();
    const args = ["1", "2", "0", "1", "0x1234"] as const;
    await submitShieldedAuthorization({
      signer: f.signer, chainId: 31337n, account, address: target, args, onSubmitting,
      onWalletRequest: () => endWalletRequest,
    });
    expect(f.incrementCounter).toHaveBeenCalledWith(...args, { nonce: 4, chainId: 31337n });
    expect(onSubmitting).toHaveBeenCalledOnce();
    expect(endWalletRequest).toHaveBeenCalledOnce();
  });

  it("preserves the public hash when waiting for the approval receipt fails", async () => {
    const f = fixture();
    f.wait.mockRejectedValueOnce(new Error("RPC unavailable"));
    await expect(submitShieldedApproval({
      signer: f.signer, chainId: 31337n, account, token: f.contract as unknown as Contract, spender, amount: 9n,
    })).rejects.toMatchObject({ transactionHash: hash, message: "RPC unavailable" });
  });
});


it("follows a fee replacement through the real ethers contract response", async () => {
  const f = fixture();
  const nextHash = `0x${"cd".repeat(32)}`;
  const receipt = { hash: nextHash, status: 1, blockNumber: 10 };
  const parameters = {
    hash, chainId: 31337n, from: account, to: target, value: 0n, nonce: 4,
    data: f.contract.interface.encodeFunctionData("approve", [spender, 9n]),
    gasLimit: 100_000n, gasPrice: 1n, type: 0, index: 0,
  };
  const provider = {
    ...f.provider,
    getTransactionCount: async (_account: string, blockTag?: string) => blockTag === "pending" ? 4 : 5,
    getTransactionReceipt: async (transactionHash: string) => transactionHash === hash ? null : receipt,
    getTransaction: async () => null,
    getBlock: async () => ({
      length: 1,
      *[Symbol.iterator]() { yield nextHash; },
      getTransaction: async () => new TransactionResponse({ ...parameters, hash: nextHash, gasPrice: 2n, blockNumber: 10 } as never, provider as never),
    }),
  };
  const signer = { provider, getAddress: async () => account } as unknown as Signer;
  f.approve.mockResolvedValueOnce(new ContractTransactionResponse(f.contract.interface, provider as never, parameters as never) as never);
  const onBroadcast = vi.fn();
  await expect(submitShieldedApproval({
    signer, chainId: 31337n, account, token: f.contract as unknown as Contract, spender, amount: 9n, onBroadcast,
  })).resolves.toMatchObject({ transactionHash: nextHash, receipt });
  expect(onBroadcast.mock.calls).toEqual([[hash], [nextHash]]);
  expect(f.approve).toHaveBeenCalledOnce();
});

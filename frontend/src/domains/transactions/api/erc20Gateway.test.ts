import { describe, expect, it, vi } from "vitest";
import { ensureAllowance } from "./erc20Gateway";
import { Interface } from "ethers";
import { contractFeeReplacement } from "../test-helpers/contractReplacement";

const owner = "0x1111111111111111111111111111111111111111";
const tokenAddress = "0x2222222222222222222222222222222222222222";
const spender = "0x3333333333333333333333333333333333333333";

describe("ensureAllowance", () => {
  it("discovers an approval fee replacement through the real ethers contract response", async () => {
    const eventInterface = new Interface(["function approve(address spender,uint256 value) returns (bool)"]);
    const tracked = contractFeeReplacement({eventInterface, receipt: {status: 1}, from: owner,
      to: tokenAddress, data: eventInterface.encodeFunctionData("approve", [spender, 5n])});
    const tokenContract = {
      allowance: vi.fn().mockResolvedValue(0n),
      approve: vi.fn().mockResolvedValue(tracked.transaction),
    };
    const result = await ensureAllowance({tokenContract,
      provider: {getBlockNumber: async () => 12}, owner, spender, required: 5n});
    expect(tracked.wasScanned()).toBe(true);
    expect(result.approvalTxHash).toBe(tracked.transactionHash);
  }, 1500);
  it("does not approve after cancellation during the allowance read", async () => {
    let finishAllowance!: (value: bigint) => void;
    let cancelled = false;
    const tokenContract = {
      allowance: vi.fn(
        () =>
          new Promise<bigint>((resolve) => {
            finishAllowance = resolve;
          }),
      ),
      approve: vi.fn(),
    };
    const pending = ensureAllowance({
      tokenContract,
      provider: { getBlockNumber: async () => 12 },
      owner,
      spender,
      required: 5n,
      assertActive: () => {
        if (cancelled) throw new Error("cancelled");
      },
    });
    cancelled = true;
    finishAllowance(0n);
    await expect(pending).rejects.toThrow("cancelled");
    expect(tokenContract.approve).not.toHaveBeenCalled();
  });

  it("accepts an exact fee replacement of the approval and reports its confirmed hash", async () => {
    const receipt = { status: 1, hash: "0xreplacement" };
    const original = { replaceableTransaction() { return this; },
      hash: "0xoriginal",
      from: owner,
      to: tokenAddress,
      data: "0x1234",
      value: 0n,
      chainId: 31337n,
      nonce: 1,
      wait: vi.fn(),
    };
    const replacement = {
      ...original,
      hash: receipt.hash,
      wait: vi.fn().mockResolvedValue(receipt),
    };
    original.wait.mockRejectedValue({
      code: "TRANSACTION_REPLACED",
      reason: "repriced",
      cancelled: false,
      replacement,
      receipt,
    });
    const tokenContract = {
      allowance: vi.fn().mockResolvedValue(0n),
      approve: vi.fn().mockResolvedValue(original),
    };
    const onConfirmed = vi.fn();
    await expect(
      ensureAllowance({ tokenContract, provider: { getBlockNumber: async () => 12 }, owner, spender, required: 5n, onConfirmed }),
    ).resolves.toMatchObject({
      approved: true,
      approvalTxHash: receipt.hash,
    });
    expect(tokenContract.approve).toHaveBeenCalledExactlyOnceWith(spender, 5n);
    expect(onConfirmed).toHaveBeenCalledExactlyOnceWith(receipt.hash, receipt);
  });
});

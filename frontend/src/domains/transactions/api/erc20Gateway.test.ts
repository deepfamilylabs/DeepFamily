import { describe, expect, it, vi } from "vitest";
import { ensureAllowance } from "./erc20Gateway";

const owner = "0x1111111111111111111111111111111111111111";
const tokenAddress = "0x2222222222222222222222222222222222222222";
const spender = "0x3333333333333333333333333333333333333333";

describe("ensureAllowance", () => {
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
    const original = {
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
    await expect(
      ensureAllowance({ tokenContract, owner, spender, required: 5n }),
    ).resolves.toMatchObject({
      approved: true,
      approvalTxHash: receipt.hash,
    });
    expect(tokenContract.approve).toHaveBeenCalledExactlyOnceWith(spender, 5n);
  });
});

import { waitForExactTransactionReceipt } from "./exactTransactionReceipt";

export type EnsureAllowanceOptions = {
  tokenContract: {
    allowance: (owner: string, spender: string) => Promise<bigint>;
    approve: (
      spender: string,
      amount: bigint,
    ) => Promise<{ wait: () => Promise<any>; hash?: string }>;
  };
  owner: string;
  spender: string;
  required: bigint;
  /** Cancels a pending allowance read before it can open the wallet. */
  assertActive?: () => void;
};

export type EnsureAllowanceResult = {
  approved: boolean;
  currentAllowance: bigint;
  required: bigint;
  approvalTxHash?: string;
};

export async function ensureAllowance({
  tokenContract,
  owner,
  spender,
  required,
  assertActive,
}: EnsureAllowanceOptions): Promise<EnsureAllowanceResult> {
  const currentAllowance = await tokenContract.allowance(owner, spender);
  assertActive?.();
  if (currentAllowance >= required) {
    return {
      approved: false,
      currentAllowance,
      required,
    };
  }

  const tx = await tokenContract.approve(spender, required);
  const { transactionHash } = await waitForExactTransactionReceipt({ transaction: tx });

  return {
    approved: true,
    currentAllowance,
    required,
    approvalTxHash: transactionHash,
  };
}

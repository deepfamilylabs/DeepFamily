export type EnsureAllowanceOptions = {
  tokenContract: {
    allowance: (owner: string, spender: string) => Promise<bigint>;
    approve: (spender: string, amount: bigint) => Promise<{ wait: () => Promise<any>; hash?: string }>;
    increaseAllowance?: (
      spender: string,
      amount: bigint,
    ) => Promise<{ wait: () => Promise<any>; hash?: string }>;
  };
  owner: string;
  spender: string;
  required: bigint;
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
}: EnsureAllowanceOptions): Promise<EnsureAllowanceResult> {
  const currentAllowance = await tokenContract.allowance(owner, spender);
  if (currentAllowance >= required) {
    return {
      approved: false,
      currentAllowance,
      required,
    };
  }

  let tx;
  try {
    tx = await tokenContract.approve(spender, required);
  } catch (approveError) {
    const delta = required - currentAllowance;
    if (delta <= 0n || typeof tokenContract.increaseAllowance !== "function") {
      throw approveError;
    }
    tx = await tokenContract.increaseAllowance(spender, delta);
  }

  await tx.wait();

  return {
    approved: true,
    currentAllowance,
    required,
    approvalTxHash: tx.hash,
  };
}

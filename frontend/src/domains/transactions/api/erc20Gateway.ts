import {
  executeChainTransaction,
  runChainRead,
  type TransactionReceiptLike,
  type TransactionResponseLike,
} from "@deepfamily/chain-client";
import type { Provider } from "ethers";

export type AllowanceTransactionResponse = TransactionResponseLike & {
  replaceableTransaction: (fromBlock: number) => TransactionResponseLike;
};

export type EnsureAllowanceOptions = {
  tokenContract: {
    allowance: (owner: string, spender: string) => Promise<bigint>;
    approve: (
      spender: string,
      amount: bigint,
    ) => Promise<AllowanceTransactionResponse>;
  };
  provider: Pick<Provider, "getBlockNumber">;
  owner: string;
  spender: string;
  required: bigint;
  /** Cancels a pending allowance read before it can open the wallet. */
  assertActive?: () => void;
  /** Revalidate asynchronous wallet scope after the scan anchor and before approval. */
  beforeSend?: () => void | Promise<void>;
  onSubmitted?: (transactionHash: string) => void;
  onConfirmed?: (transactionHash: string, receipt: TransactionReceiptLike) => void;
};

export type EnsureAllowanceResult = {
  approved: boolean;
  currentAllowance: bigint;
  required: bigint;
  approvalTxHash?: string;
};

export async function ensureAllowance({
  tokenContract,
  provider,
  owner,
  spender,
  required,
  assertActive,
  beforeSend,
  onSubmitted,
  onConfirmed,
}: EnsureAllowanceOptions): Promise<EnsureAllowanceResult> {
  const currentAllowance = await runChainRead({ read: () => tokenContract.allowance(owner, spender) });
  assertActive?.();
  if (currentAllowance >= required) {
    return {
      approved: false,
      currentAllowance,
      required,
    };
  }

  const { transactionHash } = await executeChainTransaction({
    provider,
    send: () => tokenContract.approve(spender, required),
    assertActive,
    beforeSend,
    onSubmitted,
    onConfirmed,
  });

  return {
    approved: true,
    currentAllowance,
    required,
    approvalTxHash: transactionHash,
  };
}

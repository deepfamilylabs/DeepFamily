import { isError, type ContractTransactionResponse, type TransactionReceipt } from "ethers";

/** A fee-only replacement has the same effect; cancellations and changed calls must be reconciled. */
export async function waitForShieldedTransaction(
  transaction: Pick<ContractTransactionResponse, "hash" | "wait">,
  onRepriced?: (hash: string) => void,
): Promise<{ transactionHash: string; receipt: TransactionReceipt }> {
  try {
    const receipt = await transaction.wait();
    if (!receipt) throw new Error("Shielded pool transaction has no receipt");
    return { transactionHash: transaction.hash, receipt };
  } catch (error) {
    if (!isError(error, "TRANSACTION_REPLACED") || error.cancelled || error.reason !== "repriced") {
      throw error;
    }
    const transactionHash = error.replacement.hash;
    onRepriced?.(transactionHash);
    return { transactionHash, receipt: error.receipt };
  }
}

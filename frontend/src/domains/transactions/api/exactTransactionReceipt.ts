import { waitForTransactionReceipt } from "./txGateway";

type TransactionScope = {
  chainId?: number | bigint | string | null;
  from?: string | null;
  to?: string | null;
  data?: string | null;
  value?: number | bigint | string | null;
  nonce?: number | bigint | string | null;
};

const sameHex = (left: unknown, right: unknown) =>
  typeof left === "string" &&
  typeof right === "string" &&
  left.toLowerCase() === right.toLowerCase();

function receiptError(message: string, code: string) {
  return Object.assign(new Error(message), { code, reason: code });
}

/** Keep only public tracking context when a send or its verification fails. */
export function withTransactionHash(error: unknown, transactionHash: string): Error {
  const normalized = error instanceof Error ? error : new Error(String(error));
  return Object.assign(normalized, { transactionHash });
}

function matchesFrozenScope(replacement: any, expected: TransactionScope): boolean {
  try {
    return (
      expected.chainId != null &&
      replacement?.chainId != null &&
      BigInt(replacement.chainId) === BigInt(expected.chainId) &&
      sameHex(replacement?.from, expected.from) &&
      sameHex(replacement?.to, expected.to) &&
      sameHex(replacement?.data, expected.data) &&
      expected.value != null &&
      replacement?.value != null &&
      BigInt(replacement.value) === BigInt(expected.value) &&
      (expected.nonce == null ||
        (replacement?.nonce != null && BigInt(replacement.nonce) === BigInt(expected.nonce)))
    );
  } catch {
    return false;
  }
}

/** Follow fee-only replacements; a cancellation or changed call never counts as success. */
export async function waitForExactTransactionReceipt(input: {
  transaction: any;
  expected?: TransactionScope;
  onSubmitted?: (transactionHash: string) => void;
}): Promise<{ receipt: any; transactionHash: string }> {
  let transaction = input.transaction;
  let transactionHash = transaction?.hash;
  const expected: TransactionScope = {
    chainId: input.expected?.chainId ?? transaction?.chainId,
    from: input.expected?.from ?? transaction?.from,
    to: input.expected?.to ?? transaction?.to,
    data: input.expected?.data ?? transaction?.data,
    value: input.expected?.value ?? transaction?.value,
    nonce: input.expected?.nonce ?? transaction?.nonce,
  };
  const seen = new Set<string>();

  try {
    while (true) {
      if (typeof transactionHash !== "string" || !transactionHash || seen.has(transactionHash.toLowerCase())) {
        throw receiptError("Transaction replacement tracking is invalid", "TRANSACTION_REPLACEMENT_MISMATCH");
      }
      seen.add(transactionHash.toLowerCase());
      input.onSubmitted?.(transactionHash);

      let receipt: any;
      try {
        receipt = await waitForTransactionReceipt(transaction);
      } catch (error: any) {
        if (error?.code !== "TRANSACTION_REPLACED") throw error;
        if (error.cancelled === true || error.reason !== "repriced") {
          throw receiptError("The transaction was cancelled or replaced by another call", "TRANSACTION_REPLACEMENT_CANCELLED");
        }
        const replacement = error.replacement;
        if (!replacement?.hash || !matchesFrozenScope(replacement, expected)) {
          throw receiptError("The replacement transaction does not match the submitted call", "TRANSACTION_REPLACEMENT_MISMATCH");
        }
        transaction = replacement;
        transactionHash = replacement.hash;
        if (!error.receipt) continue;
        input.onSubmitted?.(transactionHash);
        receipt = error.receipt;
      }

      if (
        Number(receipt?.status) !== 1 ||
        !sameHex(receipt?.hash ?? receipt?.transactionHash, transactionHash)
      ) {
        throw receiptError("The transaction receipt does not match a successful submission", "TRANSACTION_RECEIPT_MISMATCH");
      }
      return { receipt, transactionHash };
    }
  } catch (error) {
    throw withTransactionHash(error, transactionHash);
  }
}

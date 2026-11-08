import { sameHex } from "./internal.js";
import { chainTrackingError, normalizeChainError, withTransactionHash } from "./errors.js";

function matchesFrozenScope(replacement, expected) {
  try {
    return (
      expected.chainId != null &&
      replacement?.chainId != null &&
      BigInt(replacement.chainId) === BigInt(expected.chainId) &&
      sameHex(replacement.from, expected.from) &&
      sameHex(replacement.to, expected.to) &&
      sameHex(replacement.data, expected.data) &&
      expected.value != null &&
      replacement.value != null &&
      BigInt(replacement.value) === BigInt(expected.value) &&
      expected.nonce != null &&
      replacement.nonce != null &&
      BigInt(replacement.nonce) === BigInt(expected.nonce)
    );
  } catch {
    return false;
  }
}

/** Tracks one submitted call, follows only fee replacements and never broadcasts a retry. */
export async function waitForExactTransactionReceipt(input) {
  let transaction = input.transaction;
  let transactionHash = transaction?.hash;
  const requireSuccess = input.requireSuccess !== false;
  const expected = Object.fromEntries(
    ["chainId", "from", "to", "data", "value", "nonce"].map((field) => [
      field,
      input.expected?.[field] ?? transaction?.[field],
    ]),
  );
  const seen = new Set();
  try {
    while (true) {
      if (
        typeof transactionHash !== "string" ||
        !transactionHash ||
        seen.has(transactionHash.toLowerCase())
      ) {
        throw chainTrackingError(
          "Transaction replacement tracking is invalid",
          "TRANSACTION_REPLACEMENT_MISMATCH",
        );
      }
      seen.add(transactionHash.toLowerCase());
      await input.onSubmitted?.(transactionHash);
      let receipt;
      try {
        receipt = await transaction.wait(input.confirmations, input.timeoutMs);
      } catch (error) {
        if (error?.code === "TRANSACTION_REPLACED") {
          if (input.replacementPolicy === "reject" || error.cancelled === true || error.reason !== "repriced") {
            throw chainTrackingError(
              "The transaction was cancelled or replaced by another call",
              "TRANSACTION_REPLACEMENT_CANCELLED",
            );
          }
          if (
            typeof error.replacement?.hash !== "string" ||
            !error.replacement.hash ||
            seen.has(error.replacement.hash.toLowerCase()) ||
            !matchesFrozenScope(error.replacement, expected)
          ) {
            throw chainTrackingError(
              "The replacement transaction does not match the submitted call",
              "TRANSACTION_REPLACEMENT_MISMATCH",
            );
          }
          transaction = error.replacement;
          transactionHash = transaction.hash;
          if (!error.receipt) continue;
          await input.onSubmitted?.(transactionHash);
          receipt = error.receipt;
        } else if (
          !requireSuccess &&
          error?.code === "CALL_EXCEPTION" &&
          Number(error.receipt?.status) === 0
        ) {
          receipt = error.receipt;
        } else throw error;
      }
      const rawStatus = receipt?.status;
      const status =
        !["number", "bigint", "string"].includes(typeof rawStatus) ||
        (typeof rawStatus === "string" && !rawStatus.trim())
          ? NaN
          : Number(rawStatus);
      if (
        !sameHex(receipt?.hash ?? receipt?.transactionHash, transactionHash) ||
        (requireSuccess ? status !== 1 : status !== 0 && status !== 1)
      ) {
        const error = chainTrackingError(
          "The transaction receipt does not match the submitted transaction or status policy",
          "TRANSACTION_RECEIPT_MISMATCH",
        );
        if (sameHex(receipt?.hash ?? receipt?.transactionHash, transactionHash) && status === 0) {
          Object.assign(error, { receipt });
          throw normalizeChainError(error, { operation: "confirm", category: "reverted" });
        }
        throw error;
      }
      return { receipt, transactionHash };
    }
  } catch (error) {
    throw normalizeChainError(withTransactionHash(error, transactionHash), { operation: "confirm" });
  }
}


import { withTransactionHash } from "../api/exactTransactionReceipt";

export type ConfirmationFailure = "read" | "mismatch";

/** Call only after the successful receipt and the submitted call's events match. */
export function withConfirmedTransaction(
  error: unknown,
  transactionHash: string,
  verificationFailure: ConfirmationFailure,
): Error {
  return Object.assign(withTransactionHash(error, transactionHash), {
    transactionConfirmed: true,
    verificationFailure,
  });
}

export async function readConfirmedDetails<T>(
  transactionHash: string,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw withConfirmedTransaction(error, transactionHash, "read");
  }
}

/** Read failures and invalid returned data need different guidance, even after confirmation. */
export async function verifyConfirmedDetails<T>(
  transactionHash: string,
  verify: () => Promise<T>,
): Promise<T> {
  try {
    return await verify();
  } catch (error) {
    throw withConfirmedTransaction(
      error,
      transactionHash,
      (error as any)?.verificationFailure === "read" ? "read" : "mismatch",
    );
  }
}

import { normalizeChainError } from "@deepfamily/chain-client";

/** Amounts are public native-currency values, never private witnesses. */
export class ShieldedGasBalanceError extends Error {
  readonly code = "SHIELDED_GAS_BALANCE";
  constructor(readonly required: bigint, readonly balance: bigint, readonly deposit: bigint) {
    super("Transaction wallet balance is insufficient for the required native currency");
    this.name = "ShieldedGasBalanceError";
    normalizeChainError(this, { category: "validation", operation: "submit" });
  }
}

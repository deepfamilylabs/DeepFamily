import type { IntegerLike } from "./types.js";
export interface ArchiveChainProfile {
  readonly maxTransactionGas: bigint | null;
  readonly calldataGasPerByte: bigint;
  readonly nativeSymbol: string;
}
export const ARCHIVE_CHAIN_PROFILES: Readonly<Record<string, ArchiveChainProfile>>;
export interface ArchiveGasInput {
  estimatedGas: IntegerLike;
  chainId: IntegerLike;
  blockGasLimit: IntegerLike | null | undefined;
  calldata: string | Uint8Array;
}
export interface ArchiveGasResult {
  estimatedGas: bigint;
  gasLimit: bigint;
  nativeSymbol: string;
}
export function validateArchiveGas(input: ArchiveGasInput): ArchiveGasResult;

import type { Result } from "ethers";
import type { TransactionReceiptLike } from "@deepfamily/chain-client";

/** The public receipt fields consumed by gateways, event parsers and cache invalidation. */
export interface ContractReceiptLog {
  address?: string;
  topics?: readonly string[];
  data?: string;
  fragment?: { name?: string };
  args?: Result;
}

export type ContractReceipt = TransactionReceiptLike & {
  logs?: readonly ContractReceiptLog[];
};

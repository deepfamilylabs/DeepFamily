import { ethers } from "ethers";
import {
  buildTreeTxInvalidation,
  type TreeTxInvalidationInput,
  type TreeTxInvalidationResult,
} from "../../tree/services/treeInvalidation";
import { QueryCache } from "../../../shared/cache/QueryCache";
import { queryClient } from "../../../shared/cache/queryClient";

export type { TreeTxInvalidationInput, TreeTxInvalidationResult };

export interface InvalidationOptions {
  eventInterface?: ethers.Interface | null;
  contractAddress?: string | null;
  queryCache?: QueryCache;
}

/**
 * Computes which cache keys need invalidation after a tree-modifying
 * transaction and clears them from the shared QueryCache.
 *
 * This is the single entry-point that flow hooks / modals should call
 * after a successful tx. It replaces the older scattered tree invalidation
 * logic that used to live inside the legacy tree context implementation.
 */
export function invalidateCacheAfterTx(
  input: TreeTxInvalidationInput | null | undefined,
  options?: InvalidationOptions,
): TreeTxInvalidationResult | null {
  if (!input) return null;

  const result = buildTreeTxInvalidation(input, {
    eventInterface: options?.eventInterface ?? null,
    contractAddress: options?.contractAddress ?? null,
  });
  const cache = options?.queryCache ?? queryClient;

  for (const key of result.totalVersionsKeys) {
    cache.clear(key);
  }
  for (const key of result.versionDetailKeys) {
    cache.clear(key);
  }
  for (const key of result.nftKeys) {
    cache.clear(key);
  }

  return result;
}

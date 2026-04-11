/**
 * Singleton QueryCache facade.
 *
 * All read queries should go through this shared instance, but always via a
 * chain/RPC/contract scoped view to avoid cache bleed across environments.
 */
import { QueryCache } from "./QueryCache";

export const queryClient = new QueryCache();

export interface QueryCacheScopeInput {
  rpcUrl?: string | null;
  contractAddress?: string | null;
  chainId?: string | number | null;
}

export function buildQueryCacheScope(input: QueryCacheScopeInput): string {
  const rpc = input.rpcUrl || "no-rpc";
  const contract = input.contractAddress || "no-contract";
  const chain =
    input.chainId === undefined || input.chainId === null || input.chainId === ""
      ? "no-chain"
      : String(input.chainId);
  return `chain:${chain}::rpc:${rpc}::contract:${contract.toLowerCase()}`;
}

export function getScopedQueryClient(input: QueryCacheScopeInput): QueryCache {
  return queryClient.scoped(buildQueryCacheScope(input));
}

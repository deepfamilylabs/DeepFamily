import { METADATA_CACHE_PROTOCOL_GENERATION } from "../../../shared/model/metadataUnlock";

export interface TreeStorageScopeInput {
  chainId?: number | null;
  contractAddress?: string | null;
  protocolGeneration?: string;
}

export function buildTreeStorageNamespace(input: TreeStorageScopeInput): string {
  const generation = input.protocolGeneration ?? METADATA_CACHE_PROTOCOL_GENERATION;
  const chain = input.chainId ? String(input.chainId) : "no-chain";
  const proxy = input.contractAddress?.toLowerCase() || "no-contract";
  return `df.cache::${generation}::${chain}::${proxy}`;
}

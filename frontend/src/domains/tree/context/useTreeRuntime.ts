import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfig } from "../../config";
import { makeNodeId, type NodeId } from "../../../shared/model";
import {
  createDeepFamilyContract,
  createDeepFamilyInterface,
} from "../../../shared/clients/contractFactory";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";
import { createPersonReadGateway } from "../../../shared/clients/personReadGateway";
import { getScopedQueryClient } from "../../../shared/cache/queryClient";
import { createTreeReadGateway } from "../api/treeReadGateway";

export function useTreeRuntime() {
  const { rpcUrl, contractAddress, rootHash, rootVersionIndex, chainId } = useConfig();
  const [refreshTick, setRefreshTick] = useState(1);
  const refresh = useCallback(() => setRefreshTick((tick) => tick + 1), []);

  const provider = useMemo(() => {
    if (!rpcUrl) return null;
    try {
      return getReadonlyProvider(rpcUrl, chainId);
    } catch {
      return null;
    }
  }, [rpcUrl, chainId]);

  const contract = useMemo(() => {
    if (!provider || !contractAddress) return null;
    try {
      return createDeepFamilyContract(contractAddress, provider);
    } catch {
      return null;
    }
  }, [provider, contractAddress]);

  const scopedQueryCache = useMemo(
    () => getScopedQueryClient({ rpcUrl, contractAddress, chainId }),
    [rpcUrl, contractAddress, chainId],
  );
  const queryCacheRef = useRef(scopedQueryCache);
  useEffect(() => {
    queryCacheRef.current = scopedQueryCache;
  }, [scopedQueryCache]);

  const storyRevalidateRef = useRef(new Set<string>());
  const eventInterfaceRef = useRef(createDeepFamilyInterface());
  const api = useMemo(
    () =>
      contract
        ? {
            ...createTreeReadGateway(contract, queryCacheRef.current),
            ...createPersonReadGateway(contract, queryCacheRef.current),
          }
        : null,
    [contract],
  );

  const storageNS = useMemo(() => {
    const rpc = rpcUrl || "no-rpc";
    const addr = contractAddress || "no-contract";
    const chain = chainId ? String(chainId) : "no-chain";
    return `df.cache.v1::${chain}::${rpc}::${addr}`;
  }, [rpcUrl, contractAddress, chainId]);

  const edgesUnionKey = useMemo(() => `${storageNS}::edges.union.v1`, [storageNS]);
  const edgesStrictKey = useMemo(() => `${storageNS}::edges.strict.v1`, [storageNS]);

  const rootId = useMemo<NodeId | null>(() => {
    const isValidHash = typeof rootHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(rootHash);
    const version = Number(rootVersionIndex);
    const isValidVersion = Number.isFinite(version) && version >= 1;
    if (!isValidHash || !isValidVersion) return null;
    return makeNodeId(rootHash, version);
  }, [rootHash, rootVersionIndex]);

  return {
    rpcUrl,
    contractAddress,
    rootHash,
    rootVersionIndex,
    chainId,
    refreshTick,
    refresh,
    provider,
    contract,
    queryCacheRef,
    storyRevalidateRef,
    eventInterfaceRef,
    api,
    storageNS,
    edgesUnionKey,
    edgesStrictKey,
    rootId,
  };
}

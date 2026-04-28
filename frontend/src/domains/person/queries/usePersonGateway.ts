import { useMemo } from "react";
import { useConfig } from "../../config";
import { createDeepFamilyContract } from "../../../shared/clients/contractFactory";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";
import { getScopedQueryClient } from "../../../shared/cache/queryClient";
import { createPersonReadGateway, type PersonReadGateway } from "../api/personReadGateway";

/**
 * Shared hook that builds a PersonReadGateway backed by the shared query cache,
 * scoped to the active chain/RPC/contract tuple.
 */
export function usePersonGateway(): PersonReadGateway | null {
  const { rpcUrl, contractAddress, chainId } = useConfig();

  return useMemo(() => {
    if (!rpcUrl || !contractAddress) return null;
    const provider = getReadonlyProvider(rpcUrl, chainId);
    const contract = createDeepFamilyContract(contractAddress, provider);
    return createPersonReadGateway(
      contract,
      getScopedQueryClient({ rpcUrl, contractAddress, chainId }),
    );
  }, [rpcUrl, contractAddress, chainId]);
}

import { useMemo } from "react";
import { useConfig } from "../../config";
import { getScopedQueryClient } from "../../../shared/cache/queryClient";
import { createDeepFamilyContract } from "../../../shared/clients/contractFactory";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";
import { createTreeReadGateway, type TreeReadGateway } from "../api/treeReadGateway";

export function useTreeGateway(): TreeReadGateway | null {
  const { rpcUrl, contractAddress, chainId } = useConfig();

  return useMemo(() => {
    if (!rpcUrl || !contractAddress) return null;
    const provider = getReadonlyProvider(rpcUrl, chainId);
    const contract = createDeepFamilyContract(contractAddress, provider);
    return createTreeReadGateway(
      contract,
      getScopedQueryClient({ rpcUrl, contractAddress, chainId }),
    );
  }, [rpcUrl, contractAddress, chainId]);
}

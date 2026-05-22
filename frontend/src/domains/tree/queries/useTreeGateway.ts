import { useMemo } from "react";
import { useConfig } from "../../config";
import { getScopedQueryClient } from "../../../shared/cache/queryClient";
import { createDeepFamilyReaderContract } from "../../../shared/clients/contractFactory";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";
import { createTreeReadGateway, type TreeReadGateway } from "../api/treeReadGateway";

export function useTreeGateway(): TreeReadGateway | null {
  const { rpcUrl, contractAddress, readerAddress, chainId } = useConfig();

  return useMemo(() => {
    if (!rpcUrl || !readerAddress) return null;
    const provider = getReadonlyProvider(rpcUrl, chainId);
    const contract = createDeepFamilyReaderContract(readerAddress, provider);
    return createTreeReadGateway(
      contract,
      getScopedQueryClient({ rpcUrl, contractAddress, chainId }),
    );
  }, [rpcUrl, contractAddress, readerAddress, chainId]);
}

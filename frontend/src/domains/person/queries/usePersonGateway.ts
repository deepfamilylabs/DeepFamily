import { useMemo } from "react";
import { useConfig } from "../../config";
import { createDeepFamilyReaderContract } from "../../../shared/clients/contractFactory";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";
import { getScopedQueryClient } from "../../../shared/cache/queryClient";
import { createPersonReadGateway, type PersonReadGateway } from "../api/personReadGateway";

/**
 * Shared hook that builds a PersonReadGateway backed by the shared query cache,
 * scoped to the active chain/RPC/contract tuple.
 */
export function usePersonGateway(): PersonReadGateway | null {
  const { rpcUrl, contractAddress, readerAddress, chainId } = useConfig();

  return useMemo(() => {
    if (!rpcUrl || !readerAddress) return null;
    const provider = getReadonlyProvider(rpcUrl, chainId);
    const contract = createDeepFamilyReaderContract(readerAddress, provider);
    return createPersonReadGateway(
      contract,
      getScopedQueryClient({ rpcUrl, contractAddress, chainId }),
    );
  }, [rpcUrl, contractAddress, readerAddress, chainId]);
}

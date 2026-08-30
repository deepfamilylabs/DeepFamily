import { useMemo } from "react";
import { useConfig } from "../../config";
import {
  createDeepFamilyContract,
  createDeepFamilyReaderContract,
} from "../../../shared/clients/contractFactory";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";
import { getScopedQueryClient } from "../../../shared/cache/queryClient";
import { createAccountReadGateway, type AccountReadGateway } from "../api/accountReadGateway";

/**
 * Account-scoped gateway. Unlike `usePersonGateway` this binds the MAIN
 * DeepFamily contract: endorsement-by-account, NFT ownership and the
 * `PersonVersionAdded` event are not part of DeepFamilyReader's ABI.
 */
export function useAccountGateway(): AccountReadGateway | null {
  const { rpcUrl, contractAddress, readerAddress, chainId } = useConfig();

  return useMemo(() => {
    if (!rpcUrl || !contractAddress) return null;
    const provider = getReadonlyProvider(rpcUrl, chainId);
    const contract = createDeepFamilyContract(contractAddress, provider);
    const reader = readerAddress ? createDeepFamilyReaderContract(readerAddress, provider) : null;
    return createAccountReadGateway(
      contract,
      reader,
      getScopedQueryClient({ rpcUrl, contractAddress, chainId }),
    );
  }, [rpcUrl, contractAddress, readerAddress, chainId]);
}

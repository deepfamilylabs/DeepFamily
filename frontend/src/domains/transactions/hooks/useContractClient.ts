/**
 * Minimal hook for accessing read-only and signer-backed contract instances.
 *
 * This replaces the read-side of the old `useContract` hook. Write operations
 * should go through feature-local transaction hooks and transaction services.
 */
import { useMemo } from "react";
import { useConfig } from "../../config";
import { useWallet } from "../../wallet";
import { createDeepFamilyContract } from "../../../shared/clients/contractFactory";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";

export function useContractClient() {
  const { signer, provider } = useWallet();
  const { rpcUrl, chainId, contractAddress } = useConfig();

  const readonlyProvider = useMemo(() => {
    if (!rpcUrl) return null;
    return getReadonlyProvider(rpcUrl, chainId);
  }, [rpcUrl, chainId]);

  /** Signer-backed contract (for writes and user-context reads). */
  const contract = useMemo(() => {
    if (!contractAddress) return null;
    const runner = signer ?? provider;
    if (!runner) return null;
    return createDeepFamilyContract(contractAddress, runner);
  }, [contractAddress, signer, provider]);

  /** Read-only contract backed by a dedicated provider (no wallet dependency). */
  const readContract = useMemo(() => {
    if (!contractAddress || !readonlyProvider) return null;
    return createDeepFamilyContract(contractAddress, readonlyProvider);
  }, [contractAddress, readonlyProvider]);

  const bestReadContract = readContract ?? contract;

  const isContractReady = !!contract && !!signer;

  const getVersionDetails = useMemo(() => {
    if (!bestReadContract) return null;
    return async (personHash: string, versionIndex: number) => {
      return await bestReadContract.getVersionDetails(personHash, versionIndex);
    };
  }, [bestReadContract]);

  const getNFTDetails = useMemo(() => {
    if (!bestReadContract) return null;
    return async (tokenId: number) => {
      return await bestReadContract.getNFTDetails(tokenId);
    };
  }, [bestReadContract]);

  return {
    contract,
    readContract: bestReadContract,
    isContractReady,
    getVersionDetails,
    getNFTDetails,
  };
}

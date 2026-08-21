/**
 * Minimal hook for accessing read-only and signer-backed contract instances.
 *
 * This replaces the read-side of the old `useContract` hook. Write operations
 * should go through feature-local transaction hooks and transaction services.
 */
import { useMemo } from "react";
import { useConfig } from "../../config";
import { useWallet } from "../../wallet";
import {
  createDeepFamilyContract,
  createDeepFamilyReaderContract,
} from "../../../shared/clients/contractFactory";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";

export function useContractClient() {
  const { signer, provider } = useWallet();
  const { rpcUrl, chainId, contractAddress, readerAddress } = useConfig();

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
    if (!readerAddress || !readonlyProvider) return null;
    return createDeepFamilyReaderContract(readerAddress, readonlyProvider);
  }, [readerAddress, readonlyProvider]);

  const isContractReady = !!contract && !!signer;

  const getVersionDetails = useMemo(() => {
    if (!readContract) return null;
    return async (personHash: string, versionIndex: number) => {
      return await readContract.getVersionDetails(personHash, versionIndex);
    };
  }, [readContract]);

  const getNFTDetails = useMemo(() => {
    if (!readContract) return null;
    return async (tokenId: number) => {
      return await readContract.getNFTDetails(tokenId);
    };
  }, [readContract]);

  const getMetadataCode = useMemo(() => {
    if (!readonlyProvider) return null;
    return async (pointer: string, blockTag: "latest") => {
      return await readonlyProvider.getCode(pointer, blockTag);
    };
  }, [readonlyProvider]);

  return {
    contract,
    readContract,
    isContractReady,
    getVersionDetails,
    getNFTDetails,
    getMetadataCode,
  };
}

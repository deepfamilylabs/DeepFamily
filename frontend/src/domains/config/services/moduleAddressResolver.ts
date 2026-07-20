import { ethers } from "ethers";
import {
  createDeepFamilyContract,
  createDeepFamilyReaderContract,
} from "../../../shared/clients/contractFactory";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";

export type ResolvedModuleAddresses = {
  readerAddress: string;
  contractAddress: string;
  tokenAddress: string;
};

export type ResolveModuleAddressesInput = {
  rpcUrl: string;
  chainId?: number | null;
  readerAddress: string;
};

function normalizeAddress(address: string, label: string): string {
  if (!ethers.isAddress(address) || ethers.getAddress(address) === ethers.ZeroAddress) {
    throw new Error(`Invalid ${label} address`);
  }
  return ethers.getAddress(address);
}

export async function resolveModuleAddresses({
  rpcUrl,
  chainId,
  readerAddress,
}: ResolveModuleAddressesInput): Promise<ResolvedModuleAddresses> {
  const normalizedReader = normalizeAddress(readerAddress, "reader");
  if (!rpcUrl.trim()) throw new Error("RPC URL is required to resolve module addresses");

  const provider = getReadonlyProvider(rpcUrl, chainId);
  const reader = createDeepFamilyReaderContract(normalizedReader, provider);

  const contractAddress = normalizeAddress(await reader.DEEP_FAMILY(), "DeepFamily");
  const deepFamily = createDeepFamilyContract(contractAddress, provider);
  const tokenAddress = normalizeAddress(
    await deepFamily.DEEP_FAMILY_TOKEN_CONTRACT(),
    "DeepFamily token",
  );

  return {
    readerAddress: normalizedReader,
    contractAddress,
    tokenAddress,
  };
}

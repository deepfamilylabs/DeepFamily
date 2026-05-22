import { ethers } from "ethers";
import {
  createDeepFamilyAttestationRegistryContract,
  createDeepFamilyContract,
  createDeepFamilyReaderContract,
} from "../../../shared/clients/contractFactory";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";

export type ResolvedModuleAddresses = {
  readerAddress: string;
  contractAddress: string;
  attestationRegistryAddress: string;
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

function sameAddress(a: string, b: string): boolean {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
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
  const attestationRegistryAddress = normalizeAddress(
    await deepFamily.ATTESTATION_REGISTRY(),
    "attestation registry",
  );
  const tokenAddress = normalizeAddress(
    await deepFamily.DEEP_FAMILY_TOKEN_CONTRACT(),
    "DeepFamily token",
  );

  const registry = createDeepFamilyAttestationRegistryContract(attestationRegistryAddress, provider);
  const boundDeepFamily = normalizeAddress(await registry.deepFamily(), "bound DeepFamily");
  if (!sameAddress(boundDeepFamily, contractAddress)) {
    throw new Error(
      `Module wiring mismatch: registry is bound to ${boundDeepFamily}, expected ${contractAddress}`,
    );
  }

  return {
    readerAddress: normalizedReader,
    contractAddress,
    attestationRegistryAddress,
    tokenAddress,
  };
}

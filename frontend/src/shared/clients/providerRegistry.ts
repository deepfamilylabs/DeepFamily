import { ethers } from "ethers";
import { makeProvider } from "./providerFactory";

const readonlyProviderCache = new Map<string, ethers.JsonRpcProvider>();

function getProviderKey(rpcUrl: string, chainId?: number | null): string {
  const normalizedUrl = String(rpcUrl || "").trim();
  const normalizedChainId =
    typeof chainId === "number" && Number.isFinite(chainId) && chainId > 0 ? chainId : "auto";
  return `${normalizedUrl}::${normalizedChainId}`;
}

export function getReadonlyProvider(
  rpcUrl: string,
  chainId?: number | null,
): ethers.JsonRpcProvider {
  const key = getProviderKey(rpcUrl, chainId);
  const cached = readonlyProviderCache.get(key);
  if (cached) return cached;

  const provider = makeProvider(rpcUrl, chainId ?? undefined);
  readonlyProviderCache.set(key, provider);
  return provider;
}

export function clearReadonlyProviderCache() {
  readonlyProviderCache.clear();
}

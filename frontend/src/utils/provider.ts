import { ethers } from 'ethers'

// Create a JsonRpcProvider using a static network when possible
// This avoids the initial eth_chainId probe which can be rate-limited
export function makeProvider(rpcUrl: string, chainId?: number): ethers.JsonRpcProvider {
  const staticChainId = typeof chainId === 'number' && Number.isFinite(chainId) && chainId > 0
    ? chainId
    : undefined

  try {
    if (staticChainId) {
      return new ethers.JsonRpcProvider(rpcUrl, { chainId: staticChainId, name: String(staticChainId) })
    }
  } catch {
    // fall through to default provider below
  }
  return new ethers.JsonRpcProvider(rpcUrl)
}

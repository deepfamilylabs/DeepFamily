// Supported networks configuration for DeepFamily
// Only Conflux eSpace networks are officially supported

export interface NetworkConfig {
  chainId: number
  name: string
  rpcUrl: string
  blockExplorer?: string
  nativeCurrency: {
    name: string
    symbol: string
    decimals: number
  }
}

export const SUPPORTED_NETWORKS: Record<number, NetworkConfig> = {
  // Conflux eSpace Mainnet
  1030: {
    chainId: 1030,
    name: 'Conflux eSpace',
    rpcUrl: 'https://evm.confluxrpc.com',
    blockExplorer: 'https://evm.confluxscan.io',
    nativeCurrency: {
      name: 'CFX',
      symbol: 'CFX',
      decimals: 18
    }
  },
  // Conflux eSpace Testnet
  71: {
    chainId: 71,
    name: 'Conflux eSpace Testnet',
    rpcUrl: 'https://evmtestnet.confluxrpc.com',
    blockExplorer: 'https://evmtestnet.confluxscan.io',
    nativeCurrency: {
      name: 'CFX',
      symbol: 'CFX',
      decimals: 18
    }
  },
  // Localhost/Hardhat (for development)
  31337: {
    chainId: 31337,
    name: 'Localhost',
    rpcUrl: 'http://127.0.0.1:8545',
    nativeCurrency: {
      name: 'ETH',
      symbol: 'ETH',
      decimals: 18
    }
  }
}

// Build params for wallet_addEthereumChain
export function getAddChainParams(chainId: number): object | null {
  const network = SUPPORTED_NETWORKS[chainId]
  if (!network) return null
  
  return {
    chainId: `0x${chainId.toString(16)}`,
    chainName: network.name,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: [network.rpcUrl],
    blockExplorerUrls: network.blockExplorer ? [network.blockExplorer] : undefined
  }
}

// List of supported chain IDs
export const SUPPORTED_CHAIN_IDS = Object.keys(SUPPORTED_NETWORKS).map(Number)

// Check if a chain ID is supported
export function isSupportedChain(chainId: number | null | undefined): boolean {
  if (!chainId) return false
  return SUPPORTED_CHAIN_IDS.includes(chainId)
}

// Get network config by chain ID
export function getNetworkConfig(chainId: number): NetworkConfig | undefined {
  return SUPPORTED_NETWORKS[chainId]
}

// Get network name by chain ID
export function getNetworkName(chainId: number | null | undefined): string {
  if (!chainId) return 'Unknown'
  return SUPPORTED_NETWORKS[chainId]?.name || `Chain ${chainId}`
}

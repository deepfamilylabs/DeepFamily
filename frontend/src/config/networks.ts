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

export interface NetworkPreset {
  chainId: number
  nameKey: string
  defaultName: string
  rpcUrl: string
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

export const NETWORK_PRESETS: NetworkPreset[] = [
  {
    chainId: 1030,
    nameKey: 'wallet.networks.confluxEspace',
    defaultName: 'Conflux eSpace',
    rpcUrl: 'https://evm.confluxrpc.com'
  },
  {
    chainId: 71,
    nameKey: 'wallet.networks.confluxEspaceTestnet',
    defaultName: 'Conflux eSpace Testnet',
    rpcUrl: 'https://evmtestnet.confluxrpc.com'
  },
  {
    chainId: 31337,
    nameKey: 'wallet.networks.localDev',
    defaultName: 'Localhost',
    rpcUrl: 'http://127.0.0.1:8545'
  },
  {
    chainId: 1,
    nameKey: 'wallet.networks.ethereum',
    defaultName: 'Ethereum Mainnet',
    rpcUrl: 'https://mainnet.infura.io/v3/'
  },
  {
    chainId: 11155111,
    nameKey: 'wallet.networks.sepolia',
    defaultName: 'Ethereum Sepolia',
    rpcUrl: 'https://sepolia.infura.io/v3/'
  },
  {
    chainId: 17000,
    nameKey: 'wallet.networks.holesky',
    defaultName: 'Ethereum Holesky',
    rpcUrl: 'https://holesky.infura.io/v3/'
  },
  {
    chainId: 137,
    nameKey: 'wallet.networks.polygon',
    defaultName: 'Polygon Mainnet',
    rpcUrl: 'https://polygon-mainnet.infura.io/v3/'
  },
  {
    chainId: 80002,
    nameKey: 'wallet.networks.polygonAmoy',
    defaultName: 'Polygon Amoy',
    rpcUrl: 'https://polygon-amoy.infura.io/v3/'
  },
  {
    chainId: 56,
    nameKey: 'wallet.networks.bsc',
    defaultName: 'BSC Mainnet',
    rpcUrl: 'https://bsc-dataseed1.binance.org'
  },
  {
    chainId: 97,
    nameKey: 'wallet.networks.bscTestnet',
    defaultName: 'BSC Testnet',
    rpcUrl: 'https://data-seed-prebsc-1-s1.binance.org:8545/'
  },
  {
    chainId: 42161,
    nameKey: 'wallet.networks.arbitrum',
    defaultName: 'Arbitrum One',
    rpcUrl: 'https://arbitrum-mainnet.infura.io/v3/'
  },
  {
    chainId: 421614,
    nameKey: 'wallet.networks.arbitrumSepolia',
    defaultName: 'Arbitrum Sepolia',
    rpcUrl: 'https://arbitrum-sepolia.infura.io/v3/'
  },
  {
    chainId: 10,
    nameKey: 'wallet.networks.optimism',
    defaultName: 'Optimism',
    rpcUrl: 'https://optimism-mainnet.infura.io/v3/'
  },
  {
    chainId: 11155420,
    nameKey: 'wallet.networks.optimismSepolia',
    defaultName: 'Optimism Sepolia',
    rpcUrl: 'https://optimism-sepolia.infura.io/v3/'
  }
]

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

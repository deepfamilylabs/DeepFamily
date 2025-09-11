/**
 * Wallet detection and conflict resolution utilities
 */

export interface WalletProvider {
  isMetaMask?: boolean
  isConflux?: boolean
  isConfluxPortal?: boolean
  request: (args: { method: string; params?: any[] }) => Promise<any>
  on?: (eventName: string, handler: (...args: any[]) => void) => void
  removeListener?: (eventName: string, handler: (...args: any[]) => void) => void
}

export interface WalletDetectionResult {
  hasWallet: boolean
  hasMultipleWallets: boolean
  preferredWallet: WalletProvider | null
  availableWallets: WalletProvider[]
  confluxWallet?: WalletProvider
  metaMaskWallet?: WalletProvider
}

/**
 * Detect available wallets and resolve conflicts
 */
export function detectWallets(): WalletDetectionResult {
  const result: WalletDetectionResult = {
    hasWallet: false,
    hasMultipleWallets: false,
    preferredWallet: null,
    availableWallets: []
  }

  if (typeof window === 'undefined' || !window.ethereum) {
    return result
  }

  result.hasWallet = true

  // Handle multiple wallet providers
  if (window.ethereum.providers && Array.isArray(window.ethereum.providers)) {
    result.availableWallets = window.ethereum.providers
    result.hasMultipleWallets = window.ethereum.providers.length > 1

    // Find specific wallets
    result.metaMaskWallet = window.ethereum.providers.find((provider: WalletProvider) => provider.isMetaMask)
    result.confluxWallet = window.ethereum.providers.find((provider: WalletProvider) => 
      provider.isConflux || provider.isConfluxPortal
    )

    // Prefer MetaMask if available, otherwise use the first provider
    result.preferredWallet = result.metaMaskWallet || window.ethereum.providers[0]
  } else {
    // Single wallet provider
    result.availableWallets = [window.ethereum]
    result.preferredWallet = window.ethereum

    if (window.ethereum.isMetaMask) {
      result.metaMaskWallet = window.ethereum
    } else if (window.ethereum.isConflux || window.ethereum.isConfluxPortal) {
      result.confluxWallet = window.ethereum
    }
  }

  return result
}

/**
 * Get the best available wallet provider
 */
export function getWalletProvider(): WalletProvider | null {
  const detection = detectWallets()
  return detection.preferredWallet
}

/**
 * Check if wallet connection is safe (no conflicts)
 */
export function isWalletConnectionSafe(): boolean {
  try {
    const detection = detectWallets()
    if (!detection.hasWallet) return false

    // Check if we can safely access the ethereum object
    const provider = detection.preferredWallet
    return !!(provider && typeof provider.request === 'function')
  } catch (error) {
    console.warn('Wallet safety check failed:', error)
    return false
  }
}

/**
 * Safely add event listener to wallet
 */
export function safeAddWalletListener(
  eventName: string, 
  handler: (...args: any[]) => void
): () => void {
  try {
    const provider = getWalletProvider()
    if (provider && typeof provider.on === 'function') {
      provider.on(eventName, handler)
      
      // Return cleanup function
      return () => {
        try {
          if (provider && typeof provider.removeListener === 'function') {
            provider.removeListener(eventName, handler)
          }
        } catch (error) {
          console.warn('Failed to remove wallet listener:', error)
        }
      }
    }
  } catch (error) {
    console.warn('Failed to add wallet listener:', error)
  }
  
  // Return no-op cleanup function
  return () => {}
}

/**
 * Get wallet information for debugging
 */
export function getWalletDebugInfo(): any {
  const detection = detectWallets()
  const info = {
    detection,
    ethereum: typeof window !== 'undefined' ? {
      exists: !!window.ethereum,
      isArray: Array.isArray(window.ethereum?.providers),
      providersCount: window.ethereum?.providers?.length || 0,
      hasConflux: !!(window as any).conflux,
      userAgent: navigator.userAgent
    } : null
  }
  
  return info
}

declare global {
  interface Window {
    ethereum?: any
    conflux?: any
  }
}

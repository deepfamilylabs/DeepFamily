/**
 * Wallet conflict resolution script
 * This script should be loaded early to prevent wallet conflicts
 */

// Prevent multiple injection of Conflux provider
function preventConfluxConflict() {
  if (typeof window !== 'undefined' && (window as any).conflux) {
    try {
      // If conflux is already defined, don't allow redefinition
      Object.defineProperty(window, 'conflux', {
        value: (window as any).conflux,
        writable: false,
        enumerable: true,
        configurable: false
      })
    } catch (error) {
      console.warn('Conflux wallet conflict prevention failed:', error)
    }
  }
}

// Enhanced ethereum provider detection and cleanup
function cleanupEthereumProvider() {
  if (typeof window !== 'undefined' && (window as any).ethereum) {
    try {
      const ethereum = (window as any).ethereum
      
      // Store original methods
      const originalOn = ethereum.on
      const originalRemoveListener = ethereum.removeListener

      // Create safer wrapper methods
      ethereum.on = function(eventName: string, handler: (...args: any[]) => void) {
        try {
          if (originalOn && typeof originalOn === 'function') {
            return originalOn.call(this, eventName, handler)
          }
        } catch (error) {
          console.warn(`Failed to add ethereum listener for ${eventName}:`, error)
        }
      }

      ethereum.removeListener = function(eventName: string, handler: (...args: any[]) => void) {
        try {
          if (originalRemoveListener && typeof originalRemoveListener === 'function') {
            return originalRemoveListener.call(this, eventName, handler)
          }
        } catch (error) {
          console.warn(`Failed to remove ethereum listener for ${eventName}:`, error)
        }
      }
    } catch (error) {
      console.warn('Ethereum provider cleanup failed:', error)
    }
  }
}

// Initialize conflict prevention
preventConfluxConflict()
cleanupEthereumProvider()

// Export for debugging
if (typeof window !== 'undefined') {
  (window as any).walletDebug = {
    detectConflicts: () => {
      const conflicts = []
      const ethereum = (window as any).ethereum
      
      if (ethereum?.providers?.length > 1) {
        conflicts.push(`Multiple ethereum providers detected: ${ethereum.providers.length}`)
      }
      
      if ((window as any).conflux && ethereum) {
        conflicts.push('Both Conflux and Ethereum providers detected')
      }
      
      return conflicts
    },
    
    resetWallet: () => {
      try {
        const ethereum = (window as any).ethereum
        
        // Remove all event listeners
        if (ethereum?.removeAllListeners) {
          ethereum.removeAllListeners()
        }
        
        // Clear localStorage wallet data
        Object.keys(localStorage).forEach(key => {
          if (key.includes('wallet') || key.includes('metamask') || key.includes('conflux')) {
            localStorage.removeItem(key)
          }
        })
        
        console.log('Wallet state cleared. Please reload the page.')
        return true
      } catch (error) {
        console.error('Failed to reset wallet:', error)
        return false
      }
    }
  }
}

export {}

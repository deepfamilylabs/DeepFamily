import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { ethers } from 'ethers'
import { useToast } from '../components/ToastProvider'
import { useTranslation } from 'react-i18next'
import { 
  detectWallets, 
  getWalletProvider, 
  isWalletConnectionSafe,
  safeAddWalletListener,
  getWalletDebugInfo
} from '../utils/walletUtils'

interface WalletState {
  address: string | null
  provider: ethers.BrowserProvider | null
  signer: ethers.JsonRpcSigner | null
  isConnecting: boolean
  chainId: number | null
  balance: string | null
}

interface WalletContextValue extends WalletState {
  connect: () => Promise<void>
  disconnect: () => void
  switchChain: (chainId: number) => Promise<void>
  refreshBalance: () => Promise<void>
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function useWallet() {
  const context = useContext(WalletContext)
  if (!context) {
    throw new Error('useWallet must be used within WalletProvider')
  }
  return context
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const toast = useToast()
  
  const [walletState, setWalletState] = useState<WalletState>({
    address: null,
    provider: null,
    signer: null,
    isConnecting: false,
    chainId: null,
    balance: null
  })

  const refreshBalance = useCallback(async () => {
    if (!walletState.provider || !walletState.address) return
    
    try {
      const balance = await walletState.provider.getBalance(walletState.address)
      setWalletState(prev => ({
        ...prev,
        balance: ethers.formatEther(balance)
      }))
    } catch (error) {
      console.error('Failed to fetch balance:', error)
    }
  }, [walletState.provider, walletState.address])

  const connect = useCallback(async () => {
    // Check wallet safety first
    if (!isWalletConnectionSafe()) {
      console.warn('Wallet connection not safe:', getWalletDebugInfo())
      toast.show(t('wallet.noMetaMask', 'Please install MetaMask or Conflux Portal'))
      return
    }

    setWalletState(prev => ({ ...prev, isConnecting: true }))

    try {
      const walletProvider = getWalletProvider()
      if (!walletProvider) {
        throw new Error('No wallet provider available')
      }

      const provider = new ethers.BrowserProvider(walletProvider)
      
      // Request account access
      const accounts = await provider.send('eth_requestAccounts', [])
      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts returned')
      }
      
      const signer = await provider.getSigner()
      const address = await signer.getAddress()
      const network = await provider.getNetwork()
      
      const newState: WalletState = {
        address,
        provider,
        signer,
        isConnecting: false,
        chainId: Number(network.chainId),
        balance: null
      }
      
      setWalletState(newState)
      
      // Refresh balance after connection
      try {
        const balance = await provider.getBalance(address)
        setWalletState(prev => ({
          ...prev,
          balance: ethers.formatEther(balance)
        }))
      } catch (balanceError) {
        console.warn('Failed to fetch balance:', balanceError)
      }
      
      toast.show(t('wallet.connected', 'Wallet connected successfully'))
    } catch (error: any) {
      console.error('Failed to connect wallet:', error)
      console.error('Wallet debug info:', getWalletDebugInfo())
      setWalletState(prev => ({ ...prev, isConnecting: false }))
      
      if (error.code === 4001) {
        toast.show(t('wallet.rejected', 'Connection rejected by user'))
      } else if (error.code === -32002) {
        toast.show(t('wallet.pending', 'Connection request already pending'))
      } else {
        toast.show(t('wallet.connectionFailed', `Failed to connect wallet: ${error.message || 'Unknown error'}`))
      }
    }
  }, [t, toast])

  const disconnect = useCallback(() => {
    setWalletState({
      address: null,
      provider: null,
      signer: null,
      isConnecting: false,
      chainId: null,
      balance: null
    })
    toast.show(t('wallet.disconnected', 'Wallet disconnected'))
  }, [t, toast])

  const switchChain = useCallback(async (targetChainId: number) => {
    if (!isWalletConnectionSafe()) {
      toast.show(t('wallet.noMetaMask', 'Please install MetaMask or Conflux Portal'))
      return
    }

    try {
      const walletProvider = getWalletProvider()
      if (!walletProvider) {
        throw new Error('No wallet provider available')
      }

      await walletProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${targetChainId.toString(16)}` }],
      })
      
      // Update chain ID in state
      setWalletState(prev => ({
        ...prev,
        chainId: targetChainId
      }))
      
      toast.show(t('wallet.chainSwitched', 'Chain switched successfully'))
    } catch (error: any) {
      console.error('Failed to switch chain:', error)
      if (error.code === 4902) {
        toast.show(t('wallet.chainNotAdded', 'Chain not added to wallet'))
      } else {
        toast.show(t('wallet.chainSwitchFailed', 'Failed to switch chain'))
      }
    }
  }, [t, toast])

  // Listen to account and chain changes
  useEffect(() => {
    if (!isWalletConnectionSafe()) return

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        disconnect()
      } else if (accounts[0] !== walletState.address) {
        // Account changed, reconnect
        connect()
      }
    }

    const handleChainChanged = (chainId: string) => {
      setWalletState(prev => ({
        ...prev,
        chainId: parseInt(chainId, 16)
      }))
      // Refresh balance on chain change
      if (walletState.address) {
        refreshBalance()
      }
    }

    const handleDisconnect = () => {
      disconnect()
    }

    // Use safe event listeners
    const cleanupAccountsChanged = safeAddWalletListener('accountsChanged', handleAccountsChanged)
    const cleanupChainChanged = safeAddWalletListener('chainChanged', handleChainChanged)
    const cleanupDisconnect = safeAddWalletListener('disconnect', handleDisconnect)

    return () => {
      cleanupAccountsChanged()
      cleanupChainChanged()
      cleanupDisconnect()
    }
  }, [walletState.address, connect, disconnect, refreshBalance])

  // Auto-connect if previously connected
  const isAutoConnectDone = useRef(false)
  useEffect(() => {
    if (isAutoConnectDone.current) return
    
    const autoConnect = async () => {
      if (!isWalletConnectionSafe()) {
        isAutoConnectDone.current = true
        return
      }
      
      try {
        const walletProvider = getWalletProvider()
        if (!walletProvider) {
          isAutoConnectDone.current = true
          return
        }

        const accounts = await walletProvider.request({ method: 'eth_accounts' })
        if (accounts && accounts.length > 0) {
          await connect()
        }
        isAutoConnectDone.current = true
      } catch (error) {
        console.warn('Auto-connect failed:', error)
        console.warn('Wallet debug info:', getWalletDebugInfo())
        isAutoConnectDone.current = true
      }
    }

    // Add a small delay to ensure the page is fully loaded
    const timer = setTimeout(autoConnect, 100)
    return () => clearTimeout(timer)
  }, [connect])

  const contextValue: WalletContextValue = {
    ...walletState,
    connect,
    disconnect,
    switchChain,
    refreshBalance
  }

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
    </WalletContext.Provider>
  )
}

// Extend Window interface for TypeScript
declare global {
  interface Window {
    ethereum?: any
  }
}
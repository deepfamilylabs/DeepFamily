import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { ethers } from 'ethers'
import { useToast } from '../components/ToastProvider'
import { useTranslation } from 'react-i18next'

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
    if (typeof window.ethereum === 'undefined') {
      toast.show(t('wallet.noMetaMask', 'Please install MetaMask'))
      return
    }

    setWalletState(prev => ({ ...prev, isConnecting: true }))

    try {
      const provider = new ethers.BrowserProvider(window.ethereum)
      await provider.send('eth_requestAccounts', [])
      
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
      const balance = await provider.getBalance(address)
      setWalletState(prev => ({
        ...prev,
        balance: ethers.formatEther(balance)
      }))
      
      toast.show(t('wallet.connected', 'Wallet connected successfully'))
    } catch (error: any) {
      console.error('Failed to connect wallet:', error)
      setWalletState(prev => ({ ...prev, isConnecting: false }))
      
      if (error.code === 4001) {
        toast.show(t('wallet.rejected', 'Connection rejected by user'))
      } else {
        toast.show(t('wallet.connectionFailed', 'Failed to connect wallet'))
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
    if (!window.ethereum) {
      toast.show(t('wallet.noMetaMask', 'Please install MetaMask'))
      return
    }

    try {
      await window.ethereum.request({
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
    if (!window.ethereum) return

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

    window.ethereum.on('accountsChanged', handleAccountsChanged)
    window.ethereum.on('chainChanged', handleChainChanged)
    window.ethereum.on('disconnect', handleDisconnect)

    return () => {
      window.ethereum?.removeListener('accountsChanged', handleAccountsChanged)
      window.ethereum?.removeListener('chainChanged', handleChainChanged)
      window.ethereum?.removeListener('disconnect', handleDisconnect)
    }
  }, [walletState.address, connect, disconnect, refreshBalance])

  // Auto-connect if previously connected
  const isAutoConnectDone = useRef(false)
  useEffect(() => {
    if (isAutoConnectDone.current) return
    
    const autoConnect = async () => {
      if (typeof window.ethereum === 'undefined') return
      
      try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' })
        if (accounts.length > 0) {
          await connect()
        }
        isAutoConnectDone.current = true
      } catch (error) {
        console.error('Auto-connect failed:', error)
        isAutoConnectDone.current = true
      }
    }

    autoConnect()
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
import React from 'react'
import WalletSelectionModal from './modals/WalletSelectionModal'
import { useWallet } from '../context/WalletContext'
import type { WalletOption } from '../context/WalletContext'

export default function WalletSelectionLayer() {
  const {
    showWalletSelection,
    setShowWalletSelection,
    getAvailableWallets,
    connectWithProvider
  } = useWallet()

  const handleSelect = (wallet: WalletOption) => {
    setShowWalletSelection(false)
    // Pass both provider and wallet id for proper tracking
    connectWithProvider(wallet.provider, wallet.id)
  }

  return (
    <WalletSelectionModal
      isOpen={showWalletSelection}
      wallets={getAvailableWallets()}
      onSelect={handleSelect}
      onClose={() => setShowWalletSelection(false)}
    />
  )
}

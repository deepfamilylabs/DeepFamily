import NetworkSelectionModal from './modals/NetworkSelectionModal'
import { useWallet } from '../context/WalletContext'

export default function NetworkSelectionLayer() {
  const {
    showNetworkSelection,
    setShowNetworkSelection,
    switchOrAddChain
  } = useWallet()

  return (
    <NetworkSelectionModal
      isOpen={showNetworkSelection}
      onSelect={switchOrAddChain}
      onClose={() => setShowNetworkSelection(false)}
    />
  )
}

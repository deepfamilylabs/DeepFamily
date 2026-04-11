import NetworkSelectionModal from "./NetworkSelectionModal";
import { useWallet } from "../context";

export default function NetworkSelectionLayer() {
  const { showNetworkSelection, setShowNetworkSelection, switchOrAddChain } = useWallet();

  return (
    <NetworkSelectionModal
      isOpen={showNetworkSelection}
      onSelect={switchOrAddChain}
      onClose={() => setShowNetworkSelection(false)}
    />
  );
}

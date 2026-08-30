import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  RefreshCw,
  Check,
  ChevronRight,
  Zap,
  FlaskConical,
  HardDrive,
  Globe,
} from "lucide-react";
import {
  MODAL_ACCENT_TILE,
  MODAL_CLOSE_BUTTON,
  MODAL_HEADER,
  MODAL_TITLE,
  MODAL_TILE_BASE,
  ModalShell,
} from "../../../shared/ui";

interface NetworkOption {
  chainId: number;
  nameKey: string;
  defaultName: string;
  tagKey: string;
  defaultTag: string;
  type: "mainnet" | "testnet" | "local";
}

const NETWORK_OPTIONS: NetworkOption[] = [
  {
    chainId: 1030,
    nameKey: "wallet.networks.confluxEspace",
    defaultName: "Conflux eSpace",
    tagKey: "wallet.mainnet",
    defaultTag: "Mainnet",
    type: "mainnet",
  },
  {
    chainId: 71,
    nameKey: "wallet.networks.confluxEspaceTestnet",
    defaultName: "Conflux eSpace Testnet",
    tagKey: "wallet.testnet",
    defaultTag: "Testnet",
    type: "testnet",
  },
  {
    chainId: 31337,
    nameKey: "wallet.networks.localDev",
    defaultName: "Localhost",
    tagKey: "wallet.localhost",
    defaultTag: "Local Dev",
    type: "local",
  },
];

interface NetworkSelectionModalProps {
  isOpen: boolean;
  onSelect: (chainId: number) => Promise<boolean>;
  onClose: () => void;
  currentChainId?: number;
}

export default function NetworkSelectionModal({
  isOpen,
  onSelect,
  onClose,
  currentChainId,
}: NetworkSelectionModalProps) {
  const { t } = useTranslation();
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<number | null>(null);

  if (!isOpen) return null;

  const handleSelect = async (chainId: number) => {
    if (chainId === currentChainId) return;

    setIsSwitching(true);
    setSwitchingTo(chainId);
    try {
      const success = await onSelect(chainId);
      if (success) {
        onClose();
      }
    } finally {
      setIsSwitching(false);
      setSwitchingTo(null);
    }
  };

  const getNetworkIcon = (type: NetworkOption["type"]) => {
    switch (type) {
      case "mainnet":
        return <Zap className="w-[19px] h-[19px] text-success" aria-hidden />;
      case "testnet":
        return <FlaskConical className="w-[19px] h-[19px] text-warning" aria-hidden />;
      case "local":
        return <HardDrive className="w-[19px] h-[19px] text-ink-muted" aria-hidden />;
    }
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={t("wallet.switchNetwork", "Switch Network")}
      closeLabel={t("common.close", "Close")}
      bare
    >
      <div className="flex h-full items-center justify-center p-4">
        <div
          className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-hairline bg-surface-body shadow-[0_24px_48px_-24px_rgba(15,23,42,0.28),0_2px_6px_-2px_rgba(15,23,42,0.08)] dark:shadow-[0_24px_48px_-24px_rgba(0,0,0,0.7)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className={MODAL_HEADER}>
            <div className={`${MODAL_TILE_BASE} ${MODAL_ACCENT_TILE.primary}`}>
              <Globe className="w-[18px] h-[18px]" aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className={MODAL_TITLE}>
                {t("wallet.switchNetwork", "Switch Network")}
              </h2>
              <p className="text-xs text-ink-muted">
                {t("wallet.selectNetworkDesc", "Select a network to connect")}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className={MODAL_CLOSE_BUTTON}
              aria-label={t("common.close", "Close")}
            >
              <X className="w-[17px] h-[17px]" />
            </button>
          </div>

          <div className="p-5 space-y-2">
            {NETWORK_OPTIONS.map((network) => {
              const isActive = currentChainId === network.chainId;
              const isLoading = switchingTo === network.chainId;

              return (
                <button
                  key={network.chainId}
                  type="button"
                  onClick={() => handleSelect(network.chainId)}
                  disabled={isSwitching || isActive}
                  className={`w-full flex items-center gap-3.5 p-3.5 text-left rounded-xl bg-surface border transition-colors focus:outline-hidden focus:ring-3 focus:ring-primary/15 disabled:cursor-not-allowed ${
                    isActive
                      ? "border-success/40"
                      : "border-hairline hover:border-primary hover:bg-surface-alt"
                  }`}
                >
                  <div className="w-[38px] h-[38px] shrink-0 rounded-[10px] bg-surface-muted flex items-center justify-center">
                    {getNetworkIcon(network.type)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-ink truncate">
                      {t(network.nameKey, network.defaultName)}
                    </div>
                    <div className="text-xs text-ink-muted">
                      {t(network.tagKey, network.defaultTag)} · <span className="font-mono">chain {network.chainId}</span>
                    </div>
                  </div>

                  <div className="shrink-0">
                    {isLoading ? (
                      <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-primary/30 bg-primary/10 text-xs font-semibold text-orange-700 dark:text-orange-300">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden />
                        {t("wallet.switching", "Confirm in wallet…")}
                      </span>
                    ) : isActive ? (
                      <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-success/25 bg-success/10 text-xs font-semibold text-success">
                        <Check className="w-3.5 h-3.5" aria-hidden />
                        {t("wallet.networkConnected", "Connected")}
                      </span>
                    ) : (
                      <ChevronRight className="w-[17px] h-[17px] text-ink-subtle" aria-hidden />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="px-5 py-3.5 border-t border-hairline bg-surface">
            <p className="text-xs text-ink-subtle text-center">
              {t("wallet.networkWillBeAdded", "Network will be added automatically if not present")}
            </p>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

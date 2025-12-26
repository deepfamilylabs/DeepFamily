import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X, RefreshCw, Check, ChevronRight, Zap, FlaskConical, HardDrive, Globe } from "lucide-react";

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

  const getNetworkIconConfig = (type: NetworkOption["type"]) => {
    switch (type) {
      case "mainnet":
        return {
          icon: <Zap className="w-5 h-5" />,
          gradient: "from-emerald-400 via-teal-500 to-cyan-500",
          shadow: "shadow-emerald-500/30",
        };
      case "testnet":
        return {
          icon: <FlaskConical className="w-5 h-5" />,
          gradient: "from-violet-400 via-purple-500 to-fuchsia-500",
          shadow: "shadow-violet-500/30",
        };
      case "local":
        return {
          icon: <HardDrive className="w-5 h-5" />,
          gradient: "from-slate-400 via-gray-500 to-zinc-500",
          shadow: "shadow-slate-500/30",
        };
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1300] bg-black/60 backdrop-blur-md flex items-center justify-center p-4 transition-none"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md bg-white/95 dark:bg-black/90 backdrop-blur-xl rounded-3xl border border-white/20 dark:border-white/10 shadow-[0_0_50px_-12px_rgba(0,0,0,0.3)] p-8 space-y-8 relative overflow-hidden">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-6 right-6 p-2 text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-white/10"
          aria-label={t("common.close", "Close")}
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Section */}
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shadow-lg shadow-blue-500/30">
            <Globe className="w-8 h-8 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
              {t("wallet.switchNetwork", "Switch Network")}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t("wallet.selectNetworkDesc", "Select a network to connect")}
            </p>
          </div>
        </div>

        {/* Network Options */}
        <div className="space-y-3">
          {NETWORK_OPTIONS.map((network) => {
            const isActive = currentChainId === network.chainId;
            const isLoading = switchingTo === network.chainId;
            const config = getNetworkIconConfig(network.type);

            return (
              <button
                key={network.chainId}
                onClick={() => handleSelect(network.chainId)}
                disabled={isSwitching || isActive}
                className={`
                  w-full flex items-center gap-4 p-4 rounded-2xl
                  bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10
                  hover:border-orange-500 dark:hover:border-orange-400 hover:shadow-md hover:shadow-orange-500/10
                  group transition-none
                  disabled:opacity-70 disabled:cursor-not-allowed
                  ${isActive ? "border-emerald-500 dark:border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/10" : ""}
                `}
              >
                {/* Network Icon */}
                <div className="relative flex-shrink-0">
                  <div
                    className={`
                      w-12 h-12 rounded-xl flex items-center justify-center
                      bg-gradient-to-br ${config.gradient}
                      shadow-sm
                    `}
                  >
                    <span className="text-white">{config.icon}</span>
                  </div>
                  {/* Status dot */}
                  {isActive && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white dark:border-gray-900 flex items-center justify-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    </div>
                  )}
                </div>

                {/* Network Info */}
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 dark:text-white text-lg">
                      {t(network.nameKey, network.defaultName)}
                    </span>
                  </div>
                  {/* Minimal Tag */}
                   <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {t(network.tagKey, network.defaultTag)}
                      </span>
                   </div>
                </div>

                {/* Action Indicator */}
                <div className="flex-shrink-0">
                  {isLoading ? (
                    <RefreshCw className="w-5 h-5 text-orange-500 animate-spin" />
                  ) : isActive ? (
                     <Check className="w-5 h-5 text-emerald-500" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 group-hover:text-orange-500" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="pt-2">
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center flex items-center justify-center gap-2">
            <span className="w-1 h-1 rounded-full bg-blue-500" />
            {t("wallet.networkWillBeAdded", "Network will be added automatically if not present")}
            <span className="w-1 h-1 rounded-full bg-blue-500" />
          </p>
        </div>
      </div>
    </div>
  );
}

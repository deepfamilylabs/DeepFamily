import { useTranslation } from "react-i18next";
import { X, Wallet, ChevronRight, Shield, Download } from "lucide-react";
import type { WalletOption } from "../../context/WalletContext";
import { SUPPORTED_WALLETS } from "../../config/wallets";

interface WalletSelectionModalProps {
  isOpen: boolean;
  wallets: WalletOption[];
  onSelect: (wallet: WalletOption) => void;
  onClose: () => void;
}

const WALLET_COLORS: Record<string, { gradient: string; shadow: string; bg: string }> = {
  metamask: {
    gradient: "from-orange-400 via-amber-500 to-yellow-500",
    shadow: "shadow-orange-500/30",
    bg: "bg-orange-50 dark:bg-orange-900/20",
  },
  fluent: {
    gradient: "from-blue-400 via-cyan-500 to-teal-500",
    shadow: "shadow-cyan-500/30",
    bg: "bg-cyan-50 dark:bg-cyan-900/20",
  },
  default: {
    gradient: "from-indigo-400 via-purple-500 to-pink-500",
    shadow: "shadow-purple-500/30",
    bg: "bg-purple-50 dark:bg-purple-900/20",
  },
};

function getWalletColor(walletId: string) {
  const id = walletId.toLowerCase();
  if (id.includes("metamask")) return WALLET_COLORS.metamask;
  if (id.includes("fluent")) return WALLET_COLORS.fluent;
  return WALLET_COLORS.default;
}

export default function WalletSelectionModal({
  isOpen,
  wallets,
  onSelect,
  onClose,
}: WalletSelectionModalProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[1300] bg-black/60 backdrop-blur-md flex items-center justify-center p-4 transition-all duration-300"
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
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-orange-400 to-red-500 text-white flex items-center justify-center shadow-lg shadow-orange-500/30 transform transition-transform hover:scale-105 duration-300">
            <Wallet className="w-8 h-8 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
              {t("wallet.selectWallet", "Select Wallet")}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t("wallet.connectDescription", "Connect your wallet to continue")}
            </p>
          </div>
        </div>

        {/* Wallet Options */}
        <div className="space-y-3">
          {wallets.length > 0 ? (
            wallets.map((wallet) => {
              const colors = getWalletColor(wallet.id);
              return (
                <button
                  key={wallet.id}
                  onClick={() => onSelect(wallet)}
                  className="w-full flex items-center gap-4 p-4 rounded-2xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:border-orange-500 dark:hover:border-orange-400 hover:shadow-md hover:shadow-orange-500/10 group transition-none"
                >
                  {/* Wallet Icon */}
                  <div className="relative flex-shrink-0">
                    <div
                      className={`
                        w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden
                        ${wallet.icon ? "bg-white dark:bg-gray-800 p-1.5" : `bg-gradient-to-br ${colors.gradient}`}
                        shadow-sm
                      `}
                    >
                      {wallet.icon ? (
                        <img
                          src={wallet.icon}
                          alt={wallet.name}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <Wallet className="w-6 h-6 text-white" />
                      )}
                    </div>
                    {/* Status indicator */}
                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white dark:border-gray-900 flex items-center justify-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    </div>
                  </div>

                  {/* Wallet Info */}
                  <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 dark:text-white text-lg">
                        {wallet.name}
                      </span>
                    </div>
                  </div>

                  {/* Arrow */}
                  <div className="flex-shrink-0">
                    <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 group-hover:text-orange-500" />
                  </div>
                </button>
              );
            })
          ) : (
            /* Empty State */
            <div className="text-center py-6">
              <div className="relative inline-block mb-4">
                <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-white/5 flex items-center justify-center">
                  <Wallet className="w-8 h-8 text-gray-400 dark:text-gray-500" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center">
                  <Download className="w-3 h-3 text-orange-600 dark:text-orange-400" />
                </div>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                {t("wallet.noWalletsFound", "No wallets found")}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs mx-auto mb-6">
                {t(
                  "wallet.installWalletDesc",
                  "Please install a wallet extension like MetaMask or Fluent to continue",
                )}
              </p>

              {/* Install buttons */}
              <div className="flex flex-col gap-3">
                {SUPPORTED_WALLETS.map((wallet) => (
                  <a
                    key={wallet.id}
                    href={wallet.installUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors border border-gray-100 dark:border-white/5"
                  >
                    <div className="w-10 h-10 rounded-lg bg-white p-1.5 shadow-sm flex items-center justify-center">
                      <img src={wallet.icon} alt={wallet.name} className="w-full h-full object-contain" />
                    </div>
                    <div className="flex-1 text-left">
                      <div className="font-medium text-gray-900 dark:text-white">{wallet.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Click to install</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-2">
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center flex items-center justify-center gap-2">
            <Shield className="w-3.5 h-3.5" />
            {t("wallet.securityNote", "Your keys stay in your wallet. We never have access.")}
          </p>
        </div>
      </div>
    </div>
  );
}

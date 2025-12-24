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
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-200/80 dark:border-gray-700/80">
        {/* Header */}
        <div className="relative px-6 pt-6 pb-5 bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-800/50 dark:via-gray-900 dark:to-gray-800/50">
          {/* Decorative elements */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 dark:from-indigo-500/10 dark:to-purple-500/10 rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-gradient-to-tr from-pink-500/5 to-rose-500/5 dark:from-pink-500/10 dark:to-rose-500/10 rounded-full translate-y-1/2 -translate-x-1/2 pointer-events-none" />

          <button
            onClick={onClose}
            className="absolute right-4 top-4 z-10 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
            aria-label={t("common.close", "Close")}
          >
            <X className="w-4 h-4" />
          </button>

          <div className="relative flex items-center gap-4">
            <div className="relative">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
                <Wallet className="w-6 h-6 text-white" />
              </div>
              {/* Pulse effect */}
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 animate-ping opacity-20" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {t("wallet.selectWallet", "Select Wallet")}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {t("wallet.connectDescription", "Connect your wallet to continue")}
              </p>
            </div>
          </div>
        </div>

        {/* Wallet Options */}
        <div className="p-4">
          {wallets.length > 0 ? (
            <div className="space-y-3">
              {wallets.map((wallet) => {
                const colors = getWalletColor(wallet.id);

                return (
                  <button
                    key={wallet.id}
                    onClick={() => onSelect(wallet)}
                    className={`
                      w-full flex items-center gap-4 p-4 rounded-xl
                      border border-gray-200 dark:border-gray-700/50
                      bg-white dark:bg-gray-800/50
                      hover:border-gray-300 dark:hover:border-gray-600
                      hover:shadow-lg transition-all duration-200 group
                    `}
                  >
                    {/* Wallet Icon */}
                    <div className="relative flex-shrink-0">
                      <div
                        className={`
                        w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden
                        ${wallet.icon ? "bg-white dark:bg-gray-800 p-1.5" : `bg-gradient-to-br ${colors.gradient}`}
                        shadow-lg ${colors.shadow}
                        group-hover:scale-105 transition-transform duration-200
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
                        <span className="font-semibold text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                          {wallet.name}
                        </span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400">
                          {t("wallet.detected", "Detected")}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-1.5">
                        <Shield className="w-3 h-3" />
                        {t("wallet.secureConnection", "Secure connection")}
                      </p>
                    </div>

                    {/* Arrow */}
                    <div className="flex-shrink-0">
                      <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 group-hover:text-indigo-500 dark:group-hover:text-indigo-400 group-hover:translate-x-1 transition-all" />
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            /* Empty State */
            <div className="text-center py-10">
              <div className="relative inline-block mb-5">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 flex items-center justify-center">
                  <Wallet className="w-10 h-10 text-gray-400 dark:text-gray-500" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                  <Download className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                </div>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                {t("wallet.noWalletsFound", "No wallets found")}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs mx-auto">
                {t(
                  "wallet.installWalletDesc",
                  "Please install a wallet extension like MetaMask or Fluent to continue",
                )}
              </p>

              {/* Install buttons */}
              <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
                {SUPPORTED_WALLETS.map((wallet) => (
                  <a
                    key={wallet.id}
                    href={wallet.installUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center justify-center gap-2.5 px-5 py-2.5 rounded-xl text-white font-medium text-sm shadow-lg transition-all bg-gradient-to-r ${wallet.colors.gradient} ${wallet.colors.shadow} ${wallet.colors.hoverShadow}`}
                  >
                    <span className="w-6 h-6 rounded-md bg-white/90 flex items-center justify-center">
                      <img src={wallet.icon} alt={wallet.name} className="w-4 h-4" />
                    </span>
                    {wallet.name}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gradient-to-r from-gray-50 via-gray-100/50 to-gray-50 dark:from-gray-800/50 dark:via-gray-800 dark:to-gray-800/50 border-t border-gray-100 dark:border-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center flex items-center justify-center gap-2">
            <Shield className="w-3.5 h-3.5" />
            {t("wallet.securityNote", "Your keys stay in your wallet. We never have access.")}
          </p>
        </div>
      </div>
    </div>
  );
}

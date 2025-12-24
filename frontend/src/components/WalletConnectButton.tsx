import { useWallet } from "../context/WalletContext";
import { useTranslation } from "react-i18next";
import { Wallet, LogOut, AlertCircle, RefreshCw } from "lucide-react";
import { shortAddress } from "../types/graph";
import { isSupportedChain } from "../config/networks";
import { useConfig } from "../context/ConfigContext";

interface WalletConnectButtonProps {
  className?: string;
  showBalance?: boolean;
  variant?: "home" | "normal";
  alwaysShowLabel?: boolean;
}

export default function WalletConnectButton({
  className = "",
  showBalance = true,
  variant = "normal",
  alwaysShowLabel = false,
}: WalletConnectButtonProps) {
  const {
    address,
    balance,
    isConnecting,
    chainId,
    connect,
    disconnect,
    setShowNetworkSelection,
    switchOrAddChain,
  } = useWallet();
  const { chainId: configChainId } = useConfig();

  const { t } = useTranslation();
  const isHomePage = variant === "home";

  const formatAddress = (addr: string) => {
    return shortAddress(addr, 6, 4);
  };

  const formatBalance = (bal: string) => {
    const num = parseFloat(bal);
    if (num < 0.001) return "< 0.001 ETH";
    return `${num.toFixed(3)} ETH`;
  };

  if (!address) {
    return (
      <button
        onClick={connect}
        disabled={isConnecting}
        className={`inline-flex items-center gap-1 lg:gap-2 px-2 py-2 lg:px-3 rounded-xl border text-xs font-medium transition-all duration-200 hover:scale-105 shadow-sm backdrop-blur-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 ${
          isHomePage
            ? "border-white/30 dark:border-white/20 bg-white/20 dark:bg-white/10 text-white dark:text-gray-200 hover:bg-white/30 dark:hover:bg-white/15"
            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/80 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/90 hover:border-gray-300 dark:hover:border-gray-600"
        } ${className}`}
      >
        {isConnecting ? (
          <>
            <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
            <span className={alwaysShowLabel ? "" : "hidden lg:inline"}>
              {t("wallet.connecting", "Connecting...")}
            </span>
          </>
        ) : (
          <>
            <Wallet className="w-4 h-4" />
            <span className={alwaysShowLabel ? "" : "hidden lg:inline"}>
              {t("wallet.connect", "Connect Wallet")}
            </span>
          </>
        )}
      </button>
    );
  }

  const configSupported = isSupportedChain(configChainId);
  const isWrongNetwork = !!chainId && configSupported && chainId !== configChainId;

  return (
    <div className={`inline-flex items-center gap-2 min-w-0 ${className}`}>
      {isWrongNetwork && (
        <button
          onClick={() => {
            if (configSupported && configChainId) {
              switchOrAddChain(configChainId);
            } else {
              setShowNetworkSelection(true);
            }
          }}
          className={`group flex items-center gap-1 px-2 py-1.5 sm:px-2.5 sm:gap-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all hover:scale-105 whitespace-nowrap ${
            isHomePage
              ? "bg-gradient-to-r from-amber-400/20 to-orange-400/20 dark:from-amber-500/20 dark:to-orange-500/20 text-yellow-100 dark:text-yellow-200 border border-yellow-400/40 dark:border-yellow-500/40 hover:from-amber-400/30 hover:to-orange-400/30 shadow-sm shadow-amber-500/10"
              : "bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/30 dark:to-orange-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700/50 hover:from-amber-100 hover:to-orange-100 dark:hover:from-amber-900/40 dark:hover:to-orange-900/40 shadow-sm"
          }`}
          title={t("wallet.clickToSwitch", "Click to switch network")}
        >
          <RefreshCw
            className={`w-3.5 h-3.5 sm:w-3 sm:h-3 flex-shrink-0 group-hover:rotate-180 transition-transform duration-300 ${
              isHomePage ? "text-yellow-200/70" : "text-amber-500 dark:text-amber-400"
            }`}
          />
          <span className="hidden sm:inline">{t("wallet.wrongNetwork", "Wrong Network")}</span>
        </button>
      )}

      <div
        className={`flex items-center gap-1 lg:gap-2 px-2 py-2 lg:px-3 rounded-xl border text-xs font-medium transition-all duration-200 hover:scale-105 shadow-sm backdrop-blur-sm whitespace-nowrap min-w-0 ${
          isHomePage
            ? "border-white/30 dark:border-white/20 bg-white/20 dark:bg-white/10 text-white dark:text-gray-200 hover:bg-white/30 dark:hover:bg-white/15"
            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/80 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/90 hover:border-gray-300 dark:hover:border-gray-600"
        }`}
      >
        <div
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            isHomePage ? "bg-green-300 dark:bg-green-400" : "bg-green-500"
          }`}
        ></div>

        {showBalance && balance ? (
          <div className="flex flex-col items-start gap-0.5 min-w-0">
            <span className="text-xs font-mono max-w-28 lg:max-w-32 whitespace-nowrap overflow-hidden">
              {formatAddress(address)}
            </span>
            <span
              className={`text-xs opacity-75 ${
                isHomePage
                  ? "text-white/80 dark:text-gray-300/80"
                  : "text-gray-600 dark:text-gray-400"
              }`}
            >
              {formatBalance(balance)}
            </span>
          </div>
        ) : (
          <span className="text-xs font-mono whitespace-nowrap overflow-hidden max-w-[130px] sm:max-w-none">
            {formatAddress(address)}
          </span>
        )}

        <button
          onClick={disconnect}
          className="flex-shrink-0 p-0 rounded transition-opacity hover:opacity-70"
          title={t("wallet.disconnect", "Disconnect")}
        >
          <LogOut
            className={`w-3 h-3 ${
              isHomePage
                ? "text-white/70 dark:text-gray-300/70"
                : "text-gray-500 dark:text-gray-400"
            }`}
          />
        </button>
      </div>
    </div>
  );
}

import { useWallet } from "../context";
import { useTranslation } from "react-i18next";
import { Wallet, LogOut, RefreshCw } from "lucide-react";
import { parseEther } from "ethers";
import { shortAddress } from "../../../shared/model";
import { getNetworkConfig, isSupportedChain } from "../../../shared/config";
import { useConfig } from "../../config";

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
  const nativeCurrencySymbol = chainId
    ? (getNetworkConfig(chainId)?.nativeCurrency.symbol ?? "NATIVE")
    : "NATIVE";

  const formatAddress = (addr: string) => {
    return shortAddress(addr, 6, 4);
  };

  const formatBalance = (bal: string) => {
    try {
      const wei = parseEther(bal);
      const milliUnit = 10n ** 15n;

      if (wei > 0n && wei < milliUnit) {
        return `< 0.001 ${nativeCurrencySymbol}`;
      }

      const roundedMilliUnit = (wei + 5n * 10n ** 14n) / milliUnit;
      const whole = roundedMilliUnit / 1000n;
      const fraction = (roundedMilliUnit % 1000n).toString().padStart(3, "0");

      return `${whole}.${fraction} ${nativeCurrencySymbol}`;
    } catch {
      return `${bal} ${nativeCurrencySymbol}`;
    }
  };

  if (!address) {
    return (
      <button
        onClick={connect}
        disabled={isConnecting}
        className={`inline-flex items-center justify-center gap-2 rounded-full border text-sm font-medium transition-colors duration-200 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${
          alwaysShowLabel ? "px-4 py-2" : "h-9 w-9 lg:h-auto lg:w-auto lg:px-4 lg:py-2"
        } ${
          isHomePage
            ? "border-white/30 dark:border-white/20 bg-white/20 dark:bg-white/10 text-white dark:text-gray-200 hover:bg-white/30 dark:hover:bg-white/15 backdrop-blur-sm"
            : "border-hairline bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink"
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
          className={`group flex items-center gap-1 px-2 py-1.5 sm:px-2.5 sm:gap-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors whitespace-nowrap ${
            isHomePage
              ? "bg-linear-to-r from-amber-400/20 to-orange-400/20 dark:from-amber-500/20 dark:to-orange-500/20 text-yellow-100 dark:text-yellow-200 border border-yellow-400/40 dark:border-yellow-500/40 hover:from-amber-400/30 hover:to-orange-400/30 shadow-xs shadow-amber-500/10"
              : "bg-linear-to-r from-amber-50 to-orange-50 dark:from-amber-900/30 dark:to-orange-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700/50 hover:from-amber-100 hover:to-orange-100 dark:hover:from-amber-900/40 dark:hover:to-orange-900/40 shadow-xs"
          }`}
          title={t("wallet.clickToSwitch", "Click to switch network")}
        >
          <RefreshCw
            className={`w-3.5 h-3.5 sm:w-3 sm:h-3 shrink-0 group-hover:rotate-180 transition-transform duration-300 ${
              isHomePage ? "text-yellow-200/70" : "text-amber-500 dark:text-amber-400"
            }`}
          />
          <span className="hidden sm:inline">{t("wallet.wrongNetwork", "Wrong Network")}</span>
        </button>
      )}

      <div
        className={`flex items-center gap-2 rounded-full border py-1.5 pl-3 pr-1.5 text-sm font-medium whitespace-nowrap min-w-0 ${
          isHomePage
            ? "border-white/30 dark:border-white/20 bg-white/20 dark:bg-white/10 text-white dark:text-gray-200 backdrop-blur-sm"
            : "border-hairline bg-surface text-ink"
        }`}
      >
        <div
          className={`w-2 h-2 rounded-full shrink-0 ${
            isHomePage ? "bg-green-300 dark:bg-green-400" : "bg-green-500"
          }`}
        ></div>

        {showBalance && balance ? (
          <div className="flex min-w-0 flex-col items-start leading-tight">
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
          aria-label={t("wallet.disconnect", "Disconnect")}
          title={t("wallet.disconnect", "Disconnect")}
          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${
            isHomePage
              ? "text-white/70 hover:bg-white/20 hover:text-white dark:text-gray-300/70"
              : "text-ink-subtle hover:bg-surface-muted hover:text-ink"
          }`}
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

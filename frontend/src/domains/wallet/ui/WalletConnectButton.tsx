import { useEffect, useRef, useState } from "react";
import { useWallet } from "../context";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ChevronDown, ExternalLink, LogOut, RefreshCw, Wallet } from "lucide-react";
import { parseEther } from "ethers";
import { shortAddress } from "../../../shared/model";
import { getNetworkConfig, isSupportedChain } from "../../../shared/config";
import { CopyIconButton, useToast } from "../../../shared/ui";
import { useConfig } from "../../config";
import { formatTokenAmount } from "./formatTokenAmount";
import { useDeepBalance } from "./useDeepBalance";

interface WalletConnectButtonProps {
  className?: string;
  showBalance?: boolean;
  variant?: "home" | "normal";
  alwaysShowLabel?: boolean;
}

const MENU_ITEM_CLASSES =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 h-9 text-left text-[13px] transition-colors";

/**
 * The wallet control in the header (and wherever a page asks for a connection).
 *
 * Disconnected, it is a connect button. Connected, it is one account button that
 * opens an account menu: the full address with the shared copy button, the
 * native and DEEP balances, the block explorer, a network switch when the wallet
 * is on the wrong chain, and disconnect. Disconnecting is rare and final, so it
 * lives in the menu rather than one mis-tap away in the header.
 *
 * On a phone the button is a round wallet icon the size of the connect button,
 * with the status as a dot on its corner (amber on the wrong network) — no
 * abbreviated address, which there was never room to show usefully. From `sm`
 * it is a pill with the 6+4 address, a warning icon on the wrong network, and a
 * chevron.
 */
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
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const deepBalance = useDeepBalance(address, menuOpen);

  const { t } = useTranslation();
  const isHomePage = variant === "home";
  const connectedNetwork = chainId ? getNetworkConfig(chainId) : undefined;
  const nativeCurrencySymbol = connectedNetwork?.nativeCurrency.symbol ?? "NATIVE";

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const formatNativeAmount = (bal: string) => {
    try {
      return formatTokenAmount(parseEther(bal), 18);
    } catch {
      return bal;
    }
  };

  if (!address) {
    return (
      <button
        onClick={connect}
        disabled={isConnecting}
        // Below lg the label is hidden, so the icon-only button still needs a name.
        aria-label={
          isConnecting
            ? t("wallet.connecting", "Connecting...")
            : t("wallet.connect", "Connect Wallet")
        }
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
  const targetNetworkName = configChainId ? getNetworkConfig(configChainId)?.name : undefined;
  const explorerUrl = connectedNetwork?.blockExplorer
    ? `${connectedNetwork.blockExplorer.replace(/\/$/, "")}/address/${address}`
    : null;
  const accountLabel = t("wallet.account", "Account");
  const statusDotColor = isWrongNetwork
    ? "bg-amber-500"
    : isHomePage
      ? "bg-green-300 dark:bg-green-400"
      : "bg-green-500";

  const switchNetwork = () => {
    setMenuOpen(false);
    if (configSupported && configChainId) {
      switchOrAddChain(configChainId);
    } else {
      setShowNetworkSelection(true);
    }
  };

  const copyAddress = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(address);
      toast.success(t("common.copied", "Copied"));
    } catch {
      toast.error(t("common.copyFailed", "Failed to copy"));
    }
  };

  const deepSymbol = deepBalance.status === "ready" ? deepBalance.symbol : "DEEP";
  const deepAmount =
    deepBalance.status === "ready"
      ? deepBalance.amount
      : deepBalance.status === "unavailable"
        ? "—"
        : "…";

  return (
    <div ref={menuRef} className={`relative inline-flex min-w-0 ${className}`}>
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={accountLabel}
        title={address}
        className={`relative flex h-9 w-9 min-w-0 items-center justify-center gap-2 rounded-full border text-sm font-medium whitespace-nowrap transition-colors sm:h-auto sm:w-auto sm:justify-start sm:py-1.5 sm:pl-3 sm:pr-2.5 ${
          isHomePage
            ? "border-white/30 dark:border-white/20 bg-white/20 dark:bg-white/10 text-white dark:text-gray-200 backdrop-blur-sm hover:bg-white/30"
            : "border-hairline bg-surface text-ink hover:bg-surface-muted"
        }`}
      >
        {/* Phone: the wallet icon carries the status dot on its corner. */}
        <Wallet aria-hidden="true" className="h-4 w-4 sm:hidden" />
        <span
          aria-hidden="true"
          className={`absolute right-1 top-1 h-2 w-2 shrink-0 rounded-full ring-2 ring-surface sm:static sm:ring-0 ${statusDotColor}`}
        />

        {showBalance && balance ? (
          <span className="hidden min-w-0 flex-col items-start leading-tight sm:flex">
            <span className="max-w-full truncate text-xs font-mono">
              {shortAddress(address, 6, 4)}
            </span>
            <span
              className={`text-xs opacity-75 ${
                isHomePage
                  ? "text-white/80 dark:text-gray-300/80"
                  : "text-gray-600 dark:text-gray-400"
              }`}
            >
              {`${formatNativeAmount(balance)} ${nativeCurrencySymbol}`}
            </span>
          </span>
        ) : (
          <span className="hidden min-w-0 truncate text-xs font-mono sm:inline">
            {shortAddress(address, 6, 4)}
          </span>
        )}

        {isWrongNetwork && (
          <AlertTriangle
            className="hidden h-3.5 w-3.5 shrink-0 text-amber-500 sm:block"
            aria-label={t("wallet.wrongNetwork", "Wrong Network")}
          />
        )}
        <ChevronDown
          aria-hidden="true"
          className={`hidden h-3.5 w-3.5 shrink-0 opacity-60 transition-transform sm:block ${menuOpen ? "rotate-180" : ""}`}
        />
      </button>

      {menuOpen && (
        <div
          role="menu"
          aria-label={accountLabel}
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-hairline bg-surface p-1.5 text-ink shadow-xl shadow-ink/10"
        >
          <div className="px-2.5 pt-2 pb-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-subtle">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${isWrongNetwork ? "bg-amber-500" : "bg-green-500"}`}
              />
              <span className="truncate">{connectedNetwork?.name ?? accountLabel}</span>
            </div>
            <div className="mt-1.5 flex items-start gap-1.5">
              <div className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-ink">
                {address}
              </div>
              <CopyIconButton
                label={t("wallet.copyAddress", "Copy address")}
                onClick={() => void copyAddress()}
              />
            </div>

            <dl className="mt-2.5 space-y-1 border-t border-hairline pt-2.5 text-xs">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-muted">{nativeCurrencySymbol}</dt>
                <dd className="tabular-nums text-ink">
                  {balance ? formatNativeAmount(balance) : "—"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-muted">{deepSymbol}</dt>
                <dd className="tabular-nums text-ink" aria-busy={deepBalance.status === "loading"}>
                  {deepAmount}
                </dd>
              </div>
            </dl>
          </div>

          {isWrongNetwork && (
            <button
              type="button"
              role="menuitem"
              onClick={switchNetwork}
              className={`${MENU_ITEM_CLASSES} font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-900/20`}
            >
              <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {targetNetworkName
                  ? t("wallet.switchTo", "Switch to {{network}}", { network: targetNetworkName })
                  : t("wallet.switchNetwork", "Switch Network")}
              </span>
            </button>
          )}

          {explorerUrl ? (
            <a
              role="menuitem"
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
              className={`${MENU_ITEM_CLASSES} text-ink hover:bg-surface-alt`}
            >
              <ExternalLink className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
              <span>{t("wallet.viewOnExplorer", "View on explorer")}</span>
            </a>
          ) : null}

          <div className="my-1 h-px bg-hairline" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              disconnect();
            }}
            className={`${MENU_ITEM_CLASSES} text-ink hover:bg-surface-alt`}
          >
            <LogOut className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <span>{t("wallet.disconnect", "Disconnect")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

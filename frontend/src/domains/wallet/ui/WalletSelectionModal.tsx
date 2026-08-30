import { useTranslation } from "react-i18next";
import { Wallet, ChevronRight, Shield, Download } from "lucide-react";
import type { WalletOption } from "../context";
import { SUPPORTED_WALLETS } from "../config/wallets";
import {
  MODAL_ACCENT_TILE,
  MODAL_CARD,
  MODAL_CLOSE_BUTTON,
  MODAL_HEADER,
  MODAL_TITLE,
  MODAL_TILE_BASE,
  ModalShell,
} from "../../../shared/ui";
import { X } from "lucide-react";

const ROW =
  "w-full flex items-center gap-3.5 p-3.5 text-left rounded-xl bg-surface border border-hairline transition-colors hover:border-primary hover:bg-surface-alt focus:outline-hidden focus:ring-3 focus:ring-primary/15";

interface WalletSelectionModalProps {
  isOpen: boolean;
  wallets: WalletOption[];
  onSelect: (wallet: WalletOption) => void;
  onClose: () => void;
}

/**
 * The `md` shell (560px). Shares its row anatomy — icon tile, two lines,
 * trailing status — with NetworkSelectionModal; the wallet's own brand mark
 * carries the colour so the dialog chrome stays neutral.
 */
export default function WalletSelectionModal({
  isOpen,
  wallets,
  onSelect,
  onClose,
}: WalletSelectionModalProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={t("wallet.selectWallet", "Select Wallet")}
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
              <Wallet className="w-[18px] h-[18px]" aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className={MODAL_TITLE}>
                {t("wallet.selectWallet", "Select Wallet")}
              </h2>
              <p className="text-xs text-ink-muted">
                {t("wallet.connectDescription", "Connect your wallet to continue")}
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
            {wallets.length > 0 ? (
              wallets.map((wallet) => (
                <button key={wallet.id} type="button" onClick={() => onSelect(wallet)} className={ROW}>
                  <div className="w-[38px] h-[38px] shrink-0 rounded-[10px] bg-surface-muted flex items-center justify-center overflow-hidden">
                    {wallet.icon ? (
                      <img
                        src={wallet.icon}
                        alt=""
                        aria-hidden
                        className="w-6 h-6 object-contain"
                      />
                    ) : (
                      <Wallet className="w-[19px] h-[19px] text-ink-muted" aria-hidden />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-ink truncate">{wallet.name}</div>
                    <div className="text-xs text-ink-muted">
                      {t("wallet.extensionDetected", "Browser extension detected")}
                    </div>
                  </div>
                  <span className="w-[7px] h-[7px] shrink-0 rounded-full bg-success" aria-hidden />
                  <ChevronRight className="w-[17px] h-[17px] shrink-0 text-ink-subtle" aria-hidden />
                </button>
              ))
            ) : (
              <div className={`${MODAL_CARD} p-4 space-y-3`}>
                <div className="flex items-center gap-3.5">
                  <div className="w-[38px] h-[38px] shrink-0 rounded-[10px] bg-surface-muted flex items-center justify-center">
                    <Download className="w-[19px] h-[19px] text-ink-subtle" aria-hidden />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-ink">
                      {t("wallet.noWalletsFound", "No wallets found")}
                    </div>
                    <div className="text-xs text-ink-muted">
                      {t(
                        "wallet.installWalletDesc",
                        "Please install a wallet extension like MetaMask or Fluent to continue",
                      )}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  {SUPPORTED_WALLETS.map((wallet) => (
                    <a
                      key={wallet.id}
                      href={wallet.installUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 rounded-[10px] bg-surface-alt border border-hairline transition-colors hover:border-primary"
                    >
                      <img src={wallet.icon} alt="" aria-hidden className="w-6 h-6 object-contain" />
                      <span className="flex-1 text-sm font-medium text-ink">{wallet.name}</span>
                      <ChevronRight className="w-4 h-4 text-ink-subtle" aria-hidden />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-center gap-2 px-5 py-3.5 border-t border-hairline bg-surface">
            <Shield className="w-3.5 h-3.5 text-ink-subtle" aria-hidden />
            <p className="text-xs text-ink-subtle">
              {t("wallet.securityNote", "Your keys stay in your wallet. We never have access.")}
            </p>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

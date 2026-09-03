import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Github } from "lucide-react";
import XIcon from "./XIcon";
import TelegramIcon from "./TelegramIcon";
import { SOCIAL_LINKS } from "../config/socialLinks";
import { NETWORK_PRESETS } from "../../shared/config";
import { useWallet } from "../../domains/wallet";
import { useChainStatus, type ChainLiveness } from "./useChainStatus";

/**
 * StatusBar: the thin strip pinned to the bottom of every desktop page.
 *
 * Two things had no home before it: whether the RPC everything is read from is
 * actually answering, and the legal/social links — which lived in a landing-page
 * footer that this bar replaced. It is desktop-only; below `md` the bottom nav
 * owns that edge and the same links sit in the sidebar drawer.
 *
 * Its height is `--app-statusbar-h` (index.css), which viewport-sized surfaces
 * subtract so the bar never covers them.
 */

const DOT_CLASSES: Record<ChainLiveness, string> = {
  connecting: "bg-warning animate-pulse motion-reduce:animate-none",
  live: "bg-success",
  offline: "bg-danger",
};

const LINK_CLASSES = "transition-colors hover:text-ink focus-visible:text-ink";

export default function StatusBar() {
  const { t } = useTranslation();
  const { liveness, blockNumber, chainId } = useChainStatus();
  const { setShowNetworkSelection } = useWallet();

  const preset = NETWORK_PRESETS.find((entry) => entry.chainId === chainId);
  const networkName = preset
    ? t(preset.nameKey, preset.defaultName)
    : t("statusBar.unknownNetwork", "Unknown network");

  const livenessLabel = {
    connecting: t("statusBar.connecting", "Connecting"),
    live: t("statusBar.live", "Live"),
    offline: t("statusBar.offline", "Offline"),
  }[liveness];

  return (
    <div className="hidden md:flex fixed inset-x-0 bottom-0 z-90 h-[var(--app-statusbar-h)] items-center justify-between gap-4 border-t border-hairline bg-surface/90 pl-16 text-[11px] text-ink-muted backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-3 px-4">
        <button
          type="button"
          onClick={() => setShowNetworkSelection(true)}
          className={`inline-flex items-center gap-2 ${LINK_CLASSES}`}
          title={t("statusBar.changeNetwork", "Change network")}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[liveness]}`}
          />
          <span className="sr-only">{t("statusBar.rpcStatus", "RPC status")}: </span>
          <span>{livenessLabel}</span>
          <span aria-hidden="true" className="text-ink-subtle">
            ·
          </span>
          <span className="truncate">{networkName}</span>
        </button>
        {blockNumber !== null && (
          <span
            className="tabular-nums text-ink-subtle"
            title={t("statusBar.headBlock", "Head block")}
          >
            #{blockNumber}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4 px-4">
        <span className="hidden lg:inline text-ink-subtle">{t("footer.rights")}</span>
        <nav aria-label={t("statusBar.title", "Site status")} className="flex items-center gap-4">
          <Link to="/terms" className={LINK_CLASSES}>
            {t("footer.terms")}
          </Link>
          <Link to="/privacy" className={LINK_CLASSES}>
            {t("footer.privacy")}
          </Link>
          <a
            href={SOCIAL_LINKS.x}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="X"
            className={LINK_CLASSES}
          >
            <XIcon className="h-3.5 w-3.5" />
          </a>
          <a
            href={SOCIAL_LINKS.telegram}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Telegram"
            className={LINK_CLASSES}
          >
            <TelegramIcon className="h-3.5 w-3.5" />
          </a>
          <a
            href={SOCIAL_LINKS.github}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className={LINK_CLASSES}
          >
            <Github className="h-3.5 w-3.5" />
          </a>
        </nav>
      </div>
    </div>
  );
}

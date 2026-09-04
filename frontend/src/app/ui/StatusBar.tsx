import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Github } from "lucide-react";
import XIcon from "./XIcon";
import TelegramIcon from "./TelegramIcon";
import { SOCIAL_LINKS } from "../config/socialLinks";
import {
  DATA_SOURCE_PROBLEM_TEXT,
  RpcNetworkList,
  useDataSourceHealth,
  useNetworkName,
} from "../../domains/config";
import { useChainStatus, type ChainLiveness } from "./useChainStatus";

/**
 * StatusBar: the thin strip pinned to the bottom of every desktop page.
 *
 * Two things had no home before it: whether the RPC everything is read from is
 * actually answering, and the legal/social links — which lived in a landing-page
 * footer that this bar replaced. It is desktop-only; below `md` the bottom nav
 * owns that edge and the sidebar drawer carries the network menu instead.
 *
 * The chip reports the read RPC and switches it: the same endpoint the whole
 * app reads from, so reading it and changing it belong on one control. The
 * connected wallet's own chain is the connect button's business, not this bar's.
 *
 * A live RPC is not the same as a usable data source — the reader or the root
 * can be absent on the chain just switched to — so when the endpoint answers but
 * the data behind it does not, the chip says which, in place of the liveness
 * word, and the menu it opens carries the whole sentence.
 *
 * Its height is `--app-statusbar-h` (index.css), which viewport-sized surfaces
 * subtract so the bar never covers them.
 */

const DOT_CLASSES: Record<ChainLiveness, string> = {
  connecting: "bg-warning animate-pulse motion-reduce:animate-none",
  live: "bg-success",
  offline: "bg-danger",
};

/** The RPC answers, but what it was asked for is not there. */
const DEGRADED_DOT = "bg-warning";

const LINK_CLASSES = "transition-colors hover:text-ink focus-visible:text-ink";

export default function StatusBar() {
  const { t } = useTranslation();
  const { liveness, blockNumber } = useChainStatus();
  const health = useDataSourceHealth();
  const networkName = useNetworkName();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // The menu overlays the page, not just the bar — dismiss it the way any
  // popover is dismissed.
  useEffect(() => {
    if (!isMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  const livenessLabel = {
    connecting: t("statusBar.connecting", "Connecting"),
    live: t("statusBar.live", "Live"),
    offline: t("statusBar.offline", "Offline"),
  }[liveness];

  // An unreachable RPC is its own explanation; only blame the data behind one
  // that is actually answering.
  const problem = liveness === "live" && !health.isChecking ? health.problem : null;
  const problemText = problem ? DATA_SOURCE_PROBLEM_TEXT[problem] : null;
  const stateLabel = problemText
    ? t(problemText.labelKey, problemText.labelFallback)
    : livenessLabel;
  const chipTitle = problemText
    ? t(problemText.detailKey, problemText.detailFallback)
    : t("statusBar.changeNetwork", "Change network");

  return (
    <div className="hidden md:flex fixed inset-x-0 bottom-0 z-90 h-[var(--app-statusbar-h)] items-center justify-between gap-4 border-t border-hairline bg-surface/90 pl-16 text-[11px] text-ink-muted backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-3 px-4">
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setIsMenuOpen((open) => !open)}
            aria-haspopup="dialog"
            aria-expanded={isMenuOpen}
            className={`inline-flex items-center gap-2 ${LINK_CLASSES}`}
            title={chipTitle}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${problemText ? DEGRADED_DOT : DOT_CLASSES[liveness]}`}
            />
            <span className="sr-only">{t("statusBar.rpcStatus", "RPC status")}: </span>
            <span>{stateLabel}</span>
            <span aria-hidden="true" className="text-ink-subtle">
              ·
            </span>
            <span className="truncate">{networkName}</span>
          </button>

          {isMenuOpen ? (
            <div
              role="dialog"
              aria-label={t("statusBar.rpcNetwork", "RPC network")}
              className="absolute bottom-full left-0 mb-2 max-h-[70vh] w-80 overflow-y-auto rounded-xl border border-hairline bg-surface p-1.5 shadow-[0_16px_40px_-16px_rgba(15,23,42,0.35)] dark:shadow-[0_16px_40px_-16px_rgba(0,0,0,0.75)]"
            >
              <RpcNetworkList onPicked={() => setIsMenuOpen(false)} />
            </div>
          ) : null}
        </div>
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

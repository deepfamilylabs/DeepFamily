import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Github, Moon, Sun } from "lucide-react";
import XIcon from "./XIcon";
import TelegramIcon from "./TelegramIcon";
import { SOCIAL_LINKS } from "../config/socialLinks";
import { useTheme } from "../context";
import { RpcNetworkList } from "../../domains/config";
import { TransactionCenterChip } from "../../domains/transactions";
import { useReadSourceStatus } from "./useReadSourceStatus";
import LanguageMenu from "./LanguageMenu";
import Logo from "./Logo";

/**
 * StatusBar: the thin strip pinned to the bottom of every page.
 *
 * Two things had no home before it: whether the RPC everything is read from is
 * actually answering, and the legal/social links — which lived in a landing-page
 * footer that this bar replaced — along with the site-level settings that sit
 * with those links (language, theme) and the logo page. It runs at every
 * breakpoint; below `md` it keeps the network and transactions and leaves the
 * rest to the sidebar drawer, where there is room for them.
 *
 * The chip reports the read RPC and switches it: the same endpoint the whole
 * app reads from, so reading it and changing it belong on one control. The
 * connected wallet's own chain is the connect button's business, not this bar's.
 *
 * What the chip says comes from useReadSourceStatus — including naming the
 * missing data when the RPC answers but the reader or root behind it does not.
 *
 * Its height is `--app-statusbar-h` (index.css), home-indicator inset included,
 * which viewport-sized surfaces subtract so the bar never covers them.
 *
 * Its menus are anchored to the chip on desktop. On a phone they span the bar
 * instead (their wrappers drop `relative`, so the fixed bar is what they
 * position against) — a chip-anchored menu would run off the right edge.
 *
 * It layers just above the floating action button: on a phone a spanning menu
 * reaches under the button, which would otherwise cover its last rows.
 */

// inline-flex + items-center: an icon or a label box centres on the bar's axis
// instead of sitting on a text baseline, where CJK and Latin glyphs disagree.
const LINK_CLASSES =
  "inline-flex items-center transition-colors hover:text-ink focus-visible:text-ink";

export default function StatusBar() {
  const { t } = useTranslation();
  const { isDark, toggleTheme } = useTheme();
  const themeLabel = t("settings.theme", "Theme");
  const {
    networkName,
    blockNumber,
    stateLabel,
    title: chipTitle,
    dotClassName,
  } = useReadSourceStatus();
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

  return (
    <div className="fixed inset-x-0 bottom-0 z-10001 flex h-[var(--app-statusbar-h)] items-center justify-between gap-4 border-t border-hairline bg-surface/90 pb-[env(safe-area-inset-bottom)] text-[11px] text-ink-muted backdrop-blur-xl md:pl-16">
      <div className="flex min-w-0 items-center gap-3 px-4">
        <div className="flex min-w-0 md:relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setIsMenuOpen((open) => !open)}
            aria-haspopup="dialog"
            aria-expanded={isMenuOpen}
            className={`max-w-full gap-2 ${LINK_CLASSES}`}
            title={chipTitle}
          >
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dotClassName}`} />
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
              className="absolute bottom-full inset-x-4 mb-2 max-h-[70vh] overflow-y-auto md:inset-x-auto md:left-0 md:w-80 rounded-xl border border-hairline bg-surface p-1.5 shadow-[0_16px_40px_-16px_rgba(15,23,42,0.35)] dark:shadow-[0_16px_40px_-16px_rgba(0,0,0,0.75)]"
            >
              <RpcNetworkList onPicked={() => setIsMenuOpen(false)} />
            </div>
          ) : null}
        </div>
        <TransactionCenterChip />
        {blockNumber !== null && (
          <span
            className="tabular-nums text-ink-subtle"
            title={t("statusBar.headBlock", "Head block")}
          >
            #{blockNumber}
          </span>
        )}
      </div>

      <div className="hidden md:flex items-center gap-4 px-4">
        <LanguageMenu />
        <button
          type="button"
          role="switch"
          aria-checked={isDark}
          onClick={toggleTheme}
          aria-label={themeLabel}
          title={themeLabel}
          className={LINK_CLASSES}
        >
          {isDark ? (
            <Moon className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Sun className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
        <nav aria-label={t("statusBar.title", "Site status")} className="flex items-center gap-4">
          <Link to="/terms" className={LINK_CLASSES}>
            {t("footer.terms")}
          </Link>
          <Link to="/privacy" className={LINK_CLASSES}>
            {t("footer.privacy")}
          </Link>
          <a
            href="/logo.html"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("logo.label", "Logo")}
            title={t("logo.label", "Logo")}
            className={LINK_CLASSES}
          >
            <Logo monochrome className="h-3.5 w-3.5" />
          </a>
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

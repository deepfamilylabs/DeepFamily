import { memo, useState } from "react";
import type { FormEvent } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search, Menu } from "lucide-react";
import HeaderControls from "./HeaderControls";
import Logo from "./Logo";
import { getBadgeConfig } from "../config/brandBadge";
import { useActivePath, useSidebar } from "../context";

/**
 * SiteHeader: Unified top navigation/header bar used across all pages.
 * Optimized for Visual Polish, UX, and Performance.
 * Theme: Light/Airy
 *
 * The rail owns the brand and the section entries (see GlobalSidebar), so what
 * is left here is the pair that belongs at the top of a page: the search box
 * and the wallet. Full-bleed like the status bar — chrome hugs the viewport,
 * only page content is centred — which keeps the search box beside the rail. Below `md` the rail is off-canvas, so the brand and the
 * drawer trigger come back here and search stays in the bottom nav.
 */

/** The environment badge (TESTNET, DEMO, …) stays visible at every breakpoint. */
function BrandBadge({ className = "" }: { className?: string }) {
  const badgeConfig = getBadgeConfig();
  if (!badgeConfig) return null;

  return (
    <span
      className={`text-[9px] font-bold px-1.5 py-1 rounded-sm ${badgeConfig.className} ${badgeConfig.colorClasses} whitespace-nowrap leading-none tracking-wider pointer-events-none ${className}`}
    >
      {badgeConfig.text}
    </span>
  );
}

const SiteHeader = memo(() => {
  const { t } = useTranslation();
  const location = useLocation();
  const isHomePage = location.pathname === "/";
  const { isMobileOpen, toggleMobileSidebar } = useSidebar();
  const { setActivePath } = useActivePath();
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState("");

  const handleNavClick = (path: string) => {
    setActivePath(path);
  };

  /**
   * The header takes the query and hands it to /search, which owns the facets,
   * the hash calculator and the result scopes. Anything the page accepts —
   * person hash, token id, wallet address — is valid here.
   */
  const handleSearchSubmit = (event: FormEvent) => {
    event.preventDefault();
    const query = searchInput.trim();
    if (!query) return;
    handleNavClick("/search");
    navigate(`/search?q=${encodeURIComponent(query)}`);
  };

  return (
    <header
      className={`sticky top-0 z-100 w-full md:pl-16 transition-all duration-300 ${
        isHomePage
          ? "bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl border-b border-white/20 dark:border-white/10"
          : "bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-slate-200 dark:border-gray-800"
      }`}
    >
      <div className="h-16 flex items-center justify-between gap-4 px-4 sm:px-6">
        {/* Mobile: the drawer trigger and the brand, which the rail owns on desktop */}
        <div className="flex items-center md:hidden">
          <button
            type="button"
            onClick={toggleMobileSidebar}
            className="p-2 -ml-2 mr-0 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            aria-label={t("navigation.openMenu", "Open menu")}
            aria-expanded={isMobileOpen}
            aria-controls="global-sidebar"
          >
            <Menu className="w-6 h-6" />
          </button>
          <NavLink
            to="/"
            className="flex items-center gap-1.5 group focus:outline-hidden"
            onClick={() => handleNavClick("/")}
          >
            <Logo className="w-7 h-7 shrink-0 text-orange-500 transition-transform duration-300 group-hover:-rotate-90" />
            <div className="inline-flex items-baseline gap-1">
              <span className="text-[1.6rem] font-display mt-1 leading-none font-medium bg-linear-to-r from-orange-400 to-red-500 bg-clip-text text-transparent">
                Deepfamily
              </span>
              <BrandBadge className="hidden sm:inline-flex" />
            </div>
          </NavLink>
        </div>

        {/* Desktop: the rail carries the brand, so the slot holds search */}
        <BrandBadge className="hidden md:inline-flex shrink-0" />
        <form
          role="search"
          onSubmit={handleSearchSubmit}
          className="hidden md:flex h-9 min-w-0 flex-1 max-w-xs lg:max-w-sm items-center gap-2 rounded-full border border-hairline bg-surface-alt px-3.5 transition-colors focus-within:border-hairline-strong"
        >
          <Search className="w-4 h-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            aria-label={t("navigation.search")}
            placeholder={t("search.headerPlaceholder", "Hash, token ID or address")}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-ink placeholder:text-ink-subtle focus:ring-0"
          />
        </form>

        {/* Right Side Controls */}
        <div className="flex items-center gap-2">
          <HeaderControls variant="normal" />
        </div>
      </div>
    </header>
  );
});

SiteHeader.displayName = "SiteHeader";
export default SiteHeader;

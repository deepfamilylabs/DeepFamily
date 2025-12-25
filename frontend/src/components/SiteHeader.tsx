import { memo } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Home, Search, Network, Book, Zap, Menu } from "lucide-react";
import HeaderControls from "./HeaderControls";
import Logo from "./Logo";
import PageContainer from "./PageContainer";
import { getBadgeConfig } from "../config/brandBadge";
import { useSidebar } from "../context/SidebarContext";

/**
 * SiteHeader: Unified top navigation/header bar used across all pages.
 * Optimized for Visual Polish, UX, and Performance.
 * Theme: Light/Airy
 */
const SiteHeader = memo(() => {
  const { t } = useTranslation();
  const location = useLocation();
  const isHomePage = location.pathname === "/";
  const badgeConfig = getBadgeConfig();
  const { toggleMobileSidebar } = useSidebar();

  // Base classes for nav links
  const baseNavClasses =
    "inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 relative group whitespace-nowrap";

  const getNavClasses = ({ isActive }: { isActive: boolean }) => {
    // Unified Light Theme Style
    return `${baseNavClasses} ${
      isActive
        ? "bg-slate-900 text-white shadow-md dark:bg-white dark:text-black"
        : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-white/10"
    }`;
  };

  return (
    <header
      className={`sticky top-0 z-[100] w-full transition-all duration-300 ${
        isHomePage
          ? "bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl border-b border-white/20 dark:border-white/10"
          : "bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-slate-200 dark:border-gray-800"
      }`}
    >
      <PageContainer className="h-16 flex items-center justify-between">
        {/* Logo Section */}
        <div className="flex items-center">
          <button
            onClick={toggleMobileSidebar}
            className="md:hidden p-2 -ml-2 mr-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            aria-label="Toggle sidebar"
          >
            <Menu className="w-6 h-6" />
          </button>
          <NavLink to="/" className="flex items-center gap-1.5 group focus:outline-none">
            <Logo className="w-7 h-7 flex-shrink-0 text-orange-500 hover:-rotate-90 transition-transform duration-300" />
            <div className="flex flex-col">
              <span className="text-[1.6rem] font-display mt-1 leading-none font-medium bg-gradient-to-r from-orange-400 to-red-500 bg-clip-text text-transparent">
                Deepfamily
              </span>
              {badgeConfig && (
                <span className="relative hidden sm:inline-block ml-0.5 h-6 align-bottom pointer-events-none">
                  <span
                    className={`absolute bottom-0 text-[9px] font-bold px-1.5 py-1 rounded ${badgeConfig.className} ${badgeConfig.colorClasses} whitespace-nowrap leading-none tracking-wider`}
                  >
                    {badgeConfig.text}
                  </span>
                </span>
              )}
            </div>
          </NavLink>
        </div>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          <NavLink to="/" className={getNavClasses} end>
            <Home className="w-4 h-4" />
            <span className="hidden lg:inline">{t("navigation.home")}</span>
          </NavLink>
          <NavLink to="/familyTree" className={getNavClasses}>
            <Network className="w-4 h-4" />
            <span className="hidden lg:inline">{t("navigation.familyTree")}</span>
          </NavLink>
          <NavLink to="/people" className={getNavClasses}>
            <Book className="w-4 h-4" />
            <span className="hidden lg:inline">{t("navigation.people")}</span>
          </NavLink>
          <NavLink to="/search" className={getNavClasses}>
            <Search className="w-4 h-4" />
            <span className="hidden lg:inline">{t("navigation.search")}</span>
          </NavLink>
          <NavLink to="/actions" className={getNavClasses}>
            <Zap className="w-4 h-4" />
            <span className="hidden lg:inline">{t("navigation.actions", "Actions")}</span>
          </NavLink>
        </nav>

        {/* Right Side Controls */}
        <div className="flex items-center gap-2">
          <HeaderControls variant="normal" />
        </div>
      </PageContainer>
    </header>
  );
});

SiteHeader.displayName = "SiteHeader";
export default SiteHeader;

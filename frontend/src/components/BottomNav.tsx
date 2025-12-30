import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Home, Network, Search, Book } from "lucide-react";
import { useActivePath } from "../context/ActivePathContext";

export default function BottomNav() {
  const { t } = useTranslation();
  const { activePath, setActivePath } = useActivePath();

  const handleNavClick = (path: string) => {
    setActivePath(path);
  };

  const isPathActive = (path: string, end: boolean = false) => {
    if (end) {
      return activePath === path;
    }
    return activePath.startsWith(path);
  };

  const getNavItemClasses = (isActive: boolean) => {
    const baseClasses =
      "flex-1 flex flex-col items-center justify-center py-2 px-1 text-xs font-medium transition-colors duration-200 relative group min-h-[64px]";
    return `${baseClasses} ${
      isActive
        ? "text-orange-600 dark:text-orange-400"
        : "text-gray-500 dark:text-gray-400"
    }`;
  };

  // Helper for icon container styles
  const getIconContainerClass = (isActive: boolean) =>
    `flex items-center justify-center w-10 h-10 rounded-2xl transition-colors duration-200 ${
      isActive
        ? "bg-transparent text-orange-500 dark:text-orange-400"
        : "bg-transparent"
    }`;

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/90 dark:bg-black/90 backdrop-blur-xl border-t border-gray-100 dark:border-white/10 shadow-2xl shadow-orange-500/5 z-[9999] transform-gpu pb-[env(safe-area-inset-bottom)]">
      <div className="flex h-16 w-full px-4 gap-2 justify-between items-stretch max-w-lg mx-auto">
        <NavLink
          to="/"
          className={() => getNavItemClasses(isPathActive("/", true))}
          onClick={() => handleNavClick("/")}
          end
        >
          {() => {
            const isActive = isPathActive("/", true);
            return (
              <>
                <div className={getIconContainerClass(isActive)}>
                  <Home className={`w-6 h-6 ${isActive ? "stroke-[2.5px]" : "stroke-2"}`} />
                </div>
                <span
                  className={`mt-1 text-[10px] font-semibold tracking-wide transition-all duration-300 ${isActive ? "opacity-100" : "opacity-70"}`}
                >
                  {t("navigation.home")}
                </span>
              </>
            );
          }}
        </NavLink>
        <NavLink
          to="/familyTree"
          className={() => getNavItemClasses(isPathActive("/familyTree"))}
          onClick={() => handleNavClick("/familyTree")}
        >
          {() => {
            const isActive = isPathActive("/familyTree");
            return (
              <>
                <div className={getIconContainerClass(isActive)}>
                  <Network className={`w-6 h-6 ${isActive ? "stroke-[2.5px]" : "stroke-2"}`} />
                </div>
                <span
                  className={`mt-1 text-[10px] font-semibold tracking-wide transition-all duration-300 ${isActive ? "opacity-100" : "opacity-70"}`}
                >
                  {t("navigation.familyTree")}
                </span>
              </>
            );
          }}
        </NavLink>
        <NavLink
          to="/people"
          className={() => getNavItemClasses(isPathActive("/people"))}
          onClick={() => handleNavClick("/people")}
        >
          {() => {
            const isActive = isPathActive("/people");
            return (
              <>
                <div className={getIconContainerClass(isActive)}>
                  <Book className={`w-6 h-6 ${isActive ? "stroke-[2.5px]" : "stroke-2"}`} />
                </div>
                <span
                  className={`mt-1 text-[10px] font-semibold tracking-wide transition-all duration-300 ${isActive ? "opacity-100" : "opacity-70"}`}
                >
                  {t("navigation.people")}
                </span>
              </>
            );
          }}
        </NavLink>
        <NavLink
          to="/search"
          className={() => getNavItemClasses(isPathActive("/search"))}
          onClick={() => handleNavClick("/search")}
        >
          {() => {
            const isActive = isPathActive("/search");
            return (
              <>
                <div className={getIconContainerClass(isActive)}>
                  <Search className={`w-6 h-6 ${isActive ? "stroke-[2.5px]" : "stroke-2"}`} />
                </div>
                <span
                  className={`mt-1 text-[10px] font-semibold tracking-wide transition-all duration-300 ${isActive ? "opacity-100" : "opacity-70"}`}
                >
                  {t("navigation.search")}
                </span>
              </>
            );
          }}
        </NavLink>
      </div>
    </nav>
  );
}

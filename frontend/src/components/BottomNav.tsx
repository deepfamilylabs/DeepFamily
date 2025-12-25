import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Home, Network, Search, Book } from "lucide-react";

export default function BottomNav() {
  const { t } = useTranslation();

  const navItemClasses = ({ isActive }: { isActive: boolean }) => {
    const baseClasses =
      "flex-1 flex flex-col items-center justify-center py-2 px-1 text-xs font-medium transition-colors duration-200 relative group min-h-[64px]";
    return `${baseClasses} ${
      isActive
        ? "text-orange-600 dark:text-orange-400"
        : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
    }`;
  };

  // Helper for icon container styles
  const getIconContainerClass = (isActive: boolean) =>
    `flex items-center justify-center w-10 h-10 rounded-2xl transition-colors duration-200 ${
      isActive
        ? "bg-orange-50 dark:bg-orange-500/10 text-orange-500 dark:text-orange-400"
        : "bg-transparent hover:bg-gray-50 dark:hover:bg-white/5"
    }`;

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/90 dark:bg-black/90 backdrop-blur-xl border-t border-gray-100 dark:border-white/10 shadow-2xl shadow-orange-500/5 z-[9999] transform-gpu pb-[env(safe-area-inset-bottom)]">
      <div className="flex h-16 w-full px-4 gap-2 justify-between items-stretch max-w-lg mx-auto">
        <NavLink to="/" className={navItemClasses} end>
          {({ isActive }) => (
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
          )}
        </NavLink>
        <NavLink to="/familyTree" className={navItemClasses}>
          {({ isActive }) => (
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
          )}
        </NavLink>
        <NavLink to="/people" className={navItemClasses}>
          {({ isActive }) => (
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
          )}
        </NavLink>
        <NavLink to="/search" className={navItemClasses}>
          {({ isActive }) => (
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
          )}
        </NavLink>
      </div>
    </nav>
  );
}

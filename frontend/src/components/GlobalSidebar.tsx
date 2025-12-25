import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Settings, Globe, Palette, Lock, ChevronRight, X, Layers, Moon, Sun } from "lucide-react";
import { useSidebar } from "../context/SidebarContext";
import FamilyTreeConfigForm from "./FamilyTreeConfigForm";
import { useVizOptions } from "../context/VizOptionsContext";
import { useTreeData } from "../context/TreeDataContext";
import { languages } from "../config/languages";
import { Link, useNavigate } from "react-router-dom";
import Logo from "./Logo";

const noop = () => {};

export default function GlobalSidebar() {
  const { isMobileOpen, closeMobileSidebar, activeSection, toggleSection } = useSidebar();
  const { t, i18n } = useTranslation();
  const [isDark, setIsDark] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const navigate = useNavigate();

  // Viz Options & Tree Data for FamilyTreeConfigForm
  const {
    traversal,
    setTraversal,
    deduplicateChildren,
    setDeduplicateChildren,
    childrenMode,
    setChildrenMode,
    strictIncludeUnversionedChildren,
    setStrictIncludeUnversionedChildren,
  } = useVizOptions();

  const { loading: loadingContract, progress, contractMessage, refresh } = useTreeData();

  // Theme Toggle Logic
  useEffect(() => {
    const storedTheme = localStorage.getItem("theme") || localStorage.getItem("df-theme");
    const isDarkStored = storedTheme === "dark";
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

    const shouldBeDark = storedTheme ? isDarkStored : systemPrefersDark;

    setIsDark(shouldBeDark);
    if (shouldBeDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const toggleTheme = () => {
    const newDark = !isDark;
    setIsDark(newDark);
    if (newDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
      localStorage.setItem("df-theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
      localStorage.setItem("df-theme", "light");
    }
  };

  const changeLanguage = (code: string) => {
    i18n.changeLanguage(code);
  };

  const menuItems = useMemo(
    () => [
      {
        id: "familyTree",
        icon: Layers,
        label: t("familyTree.title", "Family Tree"),
        panelTitle: t("familyTree.ui.contractModeConfig", "Configuration"),
        content: (
          <div className="p-4">
            <FamilyTreeConfigForm
              editing={true}
              setEditing={noop}
              t={t}
              traversal={traversal}
              setTraversal={setTraversal}
              childrenMode={childrenMode}
              setChildrenMode={setChildrenMode}
              strictIncludeUnversionedChildren={strictIncludeUnversionedChildren}
              setStrictIncludeUnversionedChildren={setStrictIncludeUnversionedChildren}
              deduplicateChildren={deduplicateChildren}
              setDeduplicateChildren={setDeduplicateChildren}
              progress={progress}
              contractMessage={contractMessage}
              loading={loadingContract}
              onRefresh={refresh}
              locale={i18n.language}
              alwaysShowExtras={true}
              hideToggle={true}
              hideHeader={true}
            />
          </div>
        ),
      },
      {
        id: "language",
        icon: Globe,
        label: t("settings.language", "Language"),
        content: (
          <div className="p-4 space-y-2">
            {languages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => changeLanguage(lang.code)}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors flex items-center justify-between ${
                  i18n.language === lang.code
                    ? "bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400 font-medium"
                    : "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                }`}
              >
                <span>{lang.nativeName}</span>
                {i18n.language === lang.code && (
                  <div className="w-2 h-2 rounded-full bg-orange-500" />
                )}
              </button>
            ))}
          </div>
        ),
      },
      {
        id: "theme",
        icon: isDark ? Moon : Sun,
        label: t("settings.theme", "Theme"),
        onClick: toggleTheme,
        isSwitch: true,
        value: isDark,
      },
      {
        id: "decryption",
        icon: Lock,
        label: t("decryptMetadata.title", "Decrypt Metadata"),
        path: "/decrypt",
      },
    ],
    [
      t,
      i18n.language,
      isDark,
      traversal,
      childrenMode,
      strictIncludeUnversionedChildren,
      deduplicateChildren,
      progress,
      contractMessage,
      loadingContract,
      refresh,
      setTraversal,
      setChildrenMode,
      setStrictIncludeUnversionedChildren,
      setDeduplicateChildren,
    ],
  );

  const handleItemClick = (item: any) => {
    if (item.onClick) {
      item.onClick();
      return;
    }
    if (item.path) {
      navigate(item.path);
      closeMobileSidebar();
      if (activeSection) toggleSection(activeSection);
    } else {
      toggleSection(item.id);
    }
  };

  // Calculate width based on state
  // Mobile: full width (drawer) or 0
  // Desktop:
  //   - Collapsed: w-16 (icon strip)
  //   - Expanded: w-96 (icon strip + content panel)

  // Actually, for desktop, we want a "Thumbnail" strip always visible.
  // When an item is active, a panel slides out next to it? Or the strip expands?
  // "Desktop shows sidebar thumbnail, not fully expanded. Click to expand specific settings."
  // Let's implement a "Sidebar + Flyout Panel" for desktop, and "Drawer + Accordion" for mobile.

  // Wait, the requirement says "Drawer contains... default collapsed. Click to expand...".
  // This implies the content is INSIDE the drawer.
  // So for Desktop:
  // 1. Thin strip (Icons).
  // 2. Click Icon -> Sidebar expands to show content (Accordion style or just that section).

  // Let's go with:
  // Desktop: Fixed width strip (w-16).
  // When activeSection is not null, expand to w-96.

  const isExpanded = isHovered;

  return (
    <>
      {/* Sidebar Container */}
      <div
        className={`
          fixed left-0 bottom-0 z-[10002]
          bg-white dark:bg-slate-900 shadow-xl
          transition-all duration-300 ease-in-out
          will-change-transform
          flex flex-col
          
          /* Mobile: Full screen toggle */
          ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
          top-0 w-full

          /* Desktop: Always visible strip, below header */
          md:translate-x-0 md:top-16 md:border-r md:border-gray-100 md:dark:border-slate-800
          ${isExpanded ? "md:w-80" : "md:w-16"}
        `}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
          if (activeSection) toggleSection(activeSection);
        }}
      >
        {/* Mobile Header */}
        <div className="md:hidden p-4 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <Logo className="h-8 w-8 text-orange-500" />
            <span className="font-bold text-xl tracking-tight text-slate-900 dark:text-white">
              DeepFamily
            </span>
          </div>
          <button
            onClick={closeMobileSidebar}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
          >
            <X className="w-6 h-6 text-slate-600 dark:text-slate-300" />
          </button>
        </div>

        {/* Menu Items List */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col">
          {menuItems.map((item) => (
            <div
              key={item.id}
              className="border-b border-gray-50 dark:border-slate-800/50 md:border-none"
            >
              <button
                onClick={() => handleItemClick(item)}
                className={`
                            w-full flex items-center p-4 transition-colors relative
                            ${
                              activeSection === item.id
                                ? "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/10"
                                : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                            }
                            ${!isMobileOpen && !isExpanded ? "justify-center" : "justify-between"}
                        `}
                title={!isExpanded ? item.label : undefined}
              >
                <div
                  className={`flex items-center transition-all duration-200 ${!isMobileOpen && !isExpanded ? "justify-center w-full gap-0" : "gap-3"}`}
                >
                  <item.icon className="w-6 h-6 flex-shrink-0" />
                  <span
                    className={`font-medium whitespace-nowrap overflow-hidden transition-all duration-200 ${
                      isMobileOpen || isExpanded
                        ? "opacity-100 translate-x-0 max-w-[200px]"
                        : "opacity-0 -translate-x-4 max-w-0"
                    }`}
                  >
                    {item.label}
                  </span>
                </div>

                {/* Right Indicators (Chevron/Switch) */}
                {(isMobileOpen || isExpanded) && (
                  <div className="flex-shrink-0 ml-2">
                    {item.isSwitch ? (
                      <div
                        className={`w-10 h-6 rounded-full p-1 transition-colors ${item.value ? "bg-orange-500" : "bg-slate-300 dark:bg-slate-600"}`}
                      >
                        <div
                          className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${item.value ? "translate-x-4" : ""}`}
                        />
                      </div>
                    ) : (
                      !item.path && (
                        <ChevronRight
                          className={`w-4 h-4 transition-transform ${activeSection === item.id ? "rotate-90" : ""}`}
                        />
                      )
                    )}
                  </div>
                )}
              </button>

              {/* Accordion Content */}
              {(isMobileOpen || isExpanded) && !item.path && !item.isSwitch && (
                <div
                  className={`
                          overflow-hidden transition-all duration-300 bg-slate-50/50 dark:bg-black/20
                          ${activeSection === item.id ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"}
                      `}
                >
                  {item.content}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

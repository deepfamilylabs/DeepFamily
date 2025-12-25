import { useState, useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Moon, Sun, Menu, Lock, ChevronDown, Check, Globe } from "lucide-react";
import WalletConnectButton from "./WalletConnectButton";
import { languages } from "../config/languages";

interface HeaderControlsProps {
  variant?: "home" | "normal";
}

export default function HeaderControls({ variant = "home" }: HeaderControlsProps) {
  const { t, i18n } = useTranslation();
  
  // Theme state logic
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof window !== "undefined" && window.localStorage.getItem("df-theme") === "dark"
      ? "dark"
      : "light",
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Apply theme
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    window.localStorage.setItem("df-theme", theme);
  }, [theme]);

  // Click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setIsSettingsOpen(false);
      }
    };
    if (isSettingsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isSettingsOpen]);

  const toggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"));

  const handleLanguageChange = (langCode: string) => {
    i18n.changeLanguage(langCode);
    setIsSettingsOpen(false);
  };

  const isHomePage = variant === "home";

  // Button styles
  const toolsButtonClass = `flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 active:scale-95 ${
    isSettingsOpen 
      ? "bg-gray-100 dark:bg-white/10 text-gray-900 dark:text-white" 
      : isHomePage
        ? "text-slate-600 hover:text-slate-900 hover:bg-white/50 dark:text-gray-300 dark:hover:text-white dark:hover:bg-white/10 hover:shadow-lg hover:shadow-orange-500/10" 
        : "text-slate-600 hover:text-slate-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-white/10 hover:shadow-lg hover:shadow-orange-500/10"
  }`;
  
  // Mobile hamburger style
  const mobileMenuBtnClass = `flex items-center justify-center w-10 h-10 rounded-full border text-xs font-medium transition-all duration-300 active:scale-95 ${
    isHomePage
      ? "border-white/30 dark:border-white/20 bg-white/20 dark:bg-white/10 text-white dark:text-gray-200 backdrop-blur-md"
      : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200"
  }`;

  return (
    <div className="flex items-center gap-2 lg:gap-4 min-w-0">
      <WalletConnectButton showBalance={false} variant={variant} />

      {/* Tools Dropdown */}
      <div className="relative" ref={settingsRef}>
        {/* Desktop Trigger */}
        <button
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
          className={`hidden md:flex ${toolsButtonClass}`}
        >
          <span>{t("navigation.tools", "Tools")}</span>
          <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isSettingsOpen ? "rotate-180" : ""}`} />
        </button>

        {/* Mobile Trigger */}
        <button
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
          className={`md:hidden ${mobileMenuBtnClass}`}
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Dropdown Content */}
        <div
          className={`absolute right-0 z-[9999] mt-4 w-72 origin-top-right rounded-3xl shadow-2xl shadow-orange-500/10 backdrop-blur-2xl transition-all duration-300 ring-1 ring-black/5 focus:outline-none p-2 ${
            isSettingsOpen
              ? "opacity-100 visible transform translate-y-0 scale-100"
              : "opacity-0 invisible transform -translate-y-4 scale-95"
          } ${
             "bg-white/90 dark:bg-black/90 border border-white/20 dark:border-white/10"
          }`}
        >
            {/* Decrypt */}
            <NavLink
              to="/decrypt"
              onClick={() => setIsSettingsOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition-all duration-200 group mb-1 ${
                  isActive
                    ? "bg-gradient-to-r from-orange-400 to-red-500 text-white shadow-lg shadow-orange-500/30"
                    : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Lock size={18} className={isActive ? "text-white" : "text-gray-400 group-hover:text-orange-500 transition-colors"} />
                  <span>{t("decryptMetadata.title", "Decrypt Metadata")}</span>
                </>
              )}
            </NavLink>

            <div className="mx-2 my-1 h-px bg-gray-100 dark:bg-white/5" />

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="w-full flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 transition-all duration-200 group"
            >
              <div className="flex items-center gap-3">
                <div className={`p-1.5 rounded-full transition-colors ${theme === 'dark' ? 'bg-white/10 text-orange-400' : 'bg-gray-100 text-orange-500'}`}>
                    {theme === "dark" ? <Moon size={16} /> : <Sun size={16} />}
                </div>
                <span>{t("settings.theme", "Theme")}</span>
              </div>
              
              {/* Custom Switch */}
              <div className={`w-11 h-6 rounded-full p-1 transition-colors duration-300 ${theme === 'dark' ? 'bg-gray-700' : 'bg-gray-200'}`}>
                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transform transition-transform duration-300 ${theme === 'dark' ? 'translate-x-5' : 'translate-x-0'}`} />
              </div>
            </button>

            <div className="mx-2 my-1 h-px bg-gray-100 dark:bg-white/5" />

            {/* Language Section */}
            <div className="px-4 py-2 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
              {t("settings.language", "Language")}
            </div>
            <div className="grid gap-1">
            {languages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleLanguageChange(lang.code)}
                className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm transition-all duration-200 group ${
                  i18n.language === lang.code
                    ? "bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 font-semibold"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Globe size={16} className={`transition-colors ${i18n.language === lang.code ? "text-orange-500" : "text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300"}`} />
                  <span>{lang.nativeName}</span>
                </div>
                {i18n.language === lang.code && <Check size={16} className="text-orange-500" />}
              </button>
            ))}
            </div>
        </div>
      </div>
    </div>
  );
}

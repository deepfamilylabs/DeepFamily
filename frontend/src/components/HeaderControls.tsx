import { useState, useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Moon, Sun, Menu, Globe, Lock } from "lucide-react";
import LanguageSwitch from "./LanguageSwitch";
import WalletConnectButton from "./WalletConnectButton";
import { languages } from "../config/languages";

interface HeaderControlsProps {
  variant?: "home" | "normal";
}

export default function HeaderControls({ variant = "home" }: HeaderControlsProps) {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof window !== "undefined" && window.localStorage.getItem("df-theme") === "dark"
      ? "dark"
      : "light",
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    window.localStorage.setItem("df-theme", theme);
  }, [theme]);

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
    setIsSettingsOpen(false);
    i18n
      .changeLanguage(langCode)
      .then(() => {
        console.log("Language changed successfully to:", i18n.language);
      })
      .catch((error) => {
        console.error("Error changing language:", error);
      });
  };

  const isHomePage = variant === "home";

  const moreButtonClass = `flex items-center gap-1 px-2 py-2 rounded-xl border text-xs font-medium transition-all duration-200 hover:scale-105 shadow-sm backdrop-blur-sm ${
    isHomePage
      ? "border-white/30 dark:border-white/20 bg-white/20 dark:bg-white/10 text-white dark:text-gray-200 hover:bg-white/30 dark:hover:bg-white/15"
      : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/80 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/90 hover:border-gray-300 dark:hover:border-gray-600"
  }`;

  return (
    <div className="flex items-center gap-2 lg:gap-3 min-w-0">
      {/* Wallet connect button - always show */}
      <WalletConnectButton showBalance={false} variant={variant} />

      {/* Desktop controls: language + theme */}
      <div className="hidden md:flex items-center gap-2 lg:gap-3">
        <LanguageSwitch variant={variant} />
        <button
          onClick={toggleTheme}
          aria-label={
            theme === "dark"
              ? (t("theme.switchToLight", "Switch to Light") as string)
              : (t("theme.switchToDark", "Switch to Dark") as string)
          }
          className={`flex items-center gap-1 lg:gap-2 px-2 py-2 lg:px-3 rounded-xl border text-xs font-medium transition-all duration-200 hover:scale-105 shadow-sm backdrop-blur-sm whitespace-nowrap ${
            isHomePage
              ? "border-white/30 dark:border-white/20 bg-white/20 dark:bg-white/10 text-white dark:text-gray-200 hover:bg-white/30 dark:hover:bg-white/15"
              : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/80 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/90 hover:border-gray-300 dark:hover:border-gray-600"
          }`}
        >
          {theme === "dark" ? (
            <Moon size={16} className={`${isHomePage ? "text-blue-200" : "text-indigo-500"}`} />
          ) : (
            <Sun size={16} className={`${isHomePage ? "text-yellow-200" : "text-amber-500"}`} />
          )}
          <span className="hidden lg:inline">
            {theme === "dark" ? t("theme.dark", "Dark") : t("theme.light", "Light")}
          </span>
        </button>
      </div>

      {/* More button for all screens (holds decrypt; mobile also theme/lang) */}
      <div className="relative" ref={settingsRef}>
        <button
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
          className={`hidden md:flex ${moreButtonClass}`}
        >
          <Menu className="w-4 h-4" />
        </button>
        <button
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
          className={`md:hidden ${moreButtonClass}`}
        >
          <Menu className="w-4 h-4" />
        </button>

        {/* More options dropdown menu */}
        <div
          className={`absolute right-0 z-[9999] mt-2 w-64 origin-top-right rounded-xl shadow-xl backdrop-blur-xl transition-all duration-200 ${
            isSettingsOpen
              ? "opacity-100 visible transform translate-y-0 scale-100"
              : "opacity-0 invisible transform -translate-y-2 scale-95"
          } ${
            isHomePage
              ? "bg-white/95 dark:bg-gray-800/95 border border-white/30 dark:border-gray-700/50"
              : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600"
          }`}
        >
          <div className="py-1">
            {/* Decrypt entry */}
            <NavLink
              to="/decrypt"
              onClick={() => setIsSettingsOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 w-full px-4 py-3 text-xs font-medium rounded-lg transition ${
                  isActive
                    ? "text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30"
                    : isHomePage
                      ? "text-gray-700 dark:text-gray-300 hover:bg-white/70 dark:hover:bg-gray-700/70"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`
              }
            >
              <Lock
                size={18}
                className={`${isHomePage ? "text-blue-500 dark:text-blue-400" : "text-indigo-500 dark:text-indigo-400"}`}
              />
              <span>{t("decryptMetadata.title", "Decrypt Metadata")}</span>
            </NavLink>

            {/* Mobile-only extra items when space is tight */}
            <div className="md:hidden">
              <div
                className={`mx-4 my-2 h-px ${
                  isHomePage ? "bg-gray-200/50 dark:bg-gray-600/50" : "bg-gray-200 dark:bg-gray-600"
                }`}
              ></div>

              <button
                onClick={toggleTheme}
                className={`flex items-center justify-between w-full px-4 py-3 text-xs transition-all duration-200 rounded-lg mx-1 ${
                  isHomePage
                    ? "text-gray-700 dark:text-gray-300 hover:bg-white/70 dark:hover:bg-gray-700/70"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                <div className="flex items-center gap-3">
                  {theme === "dark" ? (
                    <Moon
                      size={18}
                      className={`${isHomePage ? "text-blue-500 dark:text-blue-400" : "text-indigo-500 dark:text-indigo-400"}`}
                    />
                  ) : (
                    <Sun
                      size={18}
                      className={`${isHomePage ? "text-yellow-500 dark:text-yellow-400" : "text-amber-500 dark:text-amber-400"}`}
                    />
                  )}
                  <span className="font-medium">{t("settings.theme", "Theme")}</span>
                </div>
                <span className="text-xs px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                  {theme === "dark" ? t("theme.dark", "Dark") : t("theme.light", "Light")}
                </span>
              </button>

              <div
                className={`mx-4 my-2 h-px ${
                  isHomePage ? "bg-gray-200/50 dark:bg-gray-600/50" : "bg-gray-200 dark:bg-gray-600"
                }`}
              ></div>

              <div className="px-2">
                <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {t("settings.language", "Language")}
                </div>

                <div className="space-y-1">
                  {languages.map((language) => (
                    <button
                      key={language.code}
                      onClick={() => handleLanguageChange(language.code)}
                      className={`flex items-center justify-between w-full px-3 py-2.5 text-xs transition-all duration-200 rounded-lg ${
                        i18n.language === language.code
                          ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium"
                          : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Globe
                          size={16}
                          className={`${
                            i18n.language === language.code
                              ? "text-blue-500 dark:text-blue-400"
                              : "text-gray-400 dark:text-gray-500"
                          }`}
                        />
                        <div className="flex flex-col items-start">
                          <span className="font-medium">{language.nativeName}</span>
                          <span className="text-xs opacity-70">{language.name}</span>
                        </div>
                      </div>
                      {i18n.language === language.code && (
                        <div className="w-2 h-2 bg-blue-500 dark:bg-blue-400 rounded-full"></div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Globe, ChevronDown } from "lucide-react";
import { languages, getLanguageByCode } from "../config/languages";

interface LanguageSwitchProps {
  variant?: "home" | "normal";
}

export default function LanguageSwitch({ variant = "home" }: LanguageSwitchProps) {
  const { i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isHomePage = variant === "home";

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const handleLanguageChange = (langCode: string) => {
    setIsOpen(false);
    i18n
      .changeLanguage(langCode)
      .then(() => {
        console.log("Language changed successfully to:", i18n.language);
      })
      .catch((error) => {
        console.error("Error changing language:", error);
      });
  };

  const currentLanguage = getLanguageByCode(i18n.language);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1 lg:gap-2 px-2 py-2 lg:px-3 text-xs font-medium rounded-xl focus:outline-none transition-all duration-200 hover:scale-105 shadow-sm backdrop-blur-sm min-w-0 whitespace-nowrap ${
          isHomePage
            ? "border-white/30 dark:border-white/20 bg-white/20 dark:bg-white/10 text-white dark:text-gray-200 hover:bg-white/30 dark:hover:bg-white/15 border"
            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/80 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/90 hover:border-gray-300 dark:hover:border-gray-600 border"
        } focus:ring-2 focus:ring-blue-500/50 dark:focus:ring-blue-400/50 focus:ring-offset-2 focus:ring-offset-transparent`}
      >
        <Globe
          className={`w-4 h-4 flex-shrink-0 ${
            isHomePage ? "text-white/80 dark:text-gray-300" : "text-gray-500 dark:text-gray-400"
          }`}
        />
        {/* Hide text on small screens, only show icon */}
        <span className="text-xs font-medium hidden lg:inline truncate max-w-16 lg:max-w-20">
          {currentLanguage.nativeName}
        </span>
        <ChevronDown
          className={`w-3 h-3 flex-shrink-0 transition-transform duration-200 hidden lg:inline ${isOpen ? "rotate-180" : ""} ${
            isHomePage ? "text-white/70 dark:text-gray-400" : "text-gray-400 dark:text-gray-500"
          }`}
        />
      </button>

      {/* Dropdown Menu - Matching Footer Style (Dark Theme) */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-48 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-xl overflow-hidden py-1 animate-in fade-in zoom-in-95 duration-200 z-[9999]">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleLanguageChange(lang.code)}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${
                i18n.language === lang.code
                  ? "bg-white/10 text-white font-medium"
                  : "text-neutral-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <span>{lang.nativeName}</span>
              {i18n.language === lang.code && (
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

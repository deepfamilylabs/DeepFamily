import { memo, useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Github, Mail, Globe, ChevronUp } from "lucide-react";
import PageContainer from "./PageContainer";
import { languages, getLanguageByCode } from "../config/languages";
import Logo from "./Logo";

// Custom X (Twitter) Icon
const XIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    className={className}
    fill="currentColor"
  >
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const SiteFooter = memo(() => {
  const { t, i18n } = useTranslation();
  const [isLangOpen, setIsLangOpen] = useState(false);
  const langMenuRef = useRef<HTMLDivElement>(null);

  const currentLanguage = getLanguageByCode(i18n.language);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(event.target as Node)) {
        setIsLangOpen(false);
      }
    };

    if (isLangOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isLangOpen]);

  const handleLanguageChange = (code: string) => {
    i18n.changeLanguage(code);
    setIsLangOpen(false);
  };

  return (
    <footer className="bg-[#111111] text-white py-16 border-t border-white/5 relative z-50">
      <PageContainer>
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-10">
          {/* Left: Brand & Tagline */}
          <div className="flex flex-col items-start gap-4">
            <div className="flex items-center gap-3">
              <Logo className="w-8 h-8 text-white" />
              <span className="text-2xl font-bold tracking-tight">DeepFamily</span>
            </div>
            <p className="text-neutral-400 text-sm max-w-md leading-relaxed">
              {t("footer.tagline")}
            </p>
            
            {/* Links */}
            <div className="flex flex-wrap gap-6 mt-2">
                <a href="#" className="text-sm text-neutral-400 hover:text-white transition-colors">{t("footer.documentation")}</a>
                <a href="#" className="text-sm text-neutral-400 hover:text-white transition-colors">{t("footer.privacy")}</a>
                <a href="#" className="text-sm text-neutral-400 hover:text-white transition-colors">{t("footer.terms")}</a>
            </div>
          </div>

          {/* Right: Socials, Language & Copyright */}
          <div className="flex flex-col items-start lg:items-end gap-6 w-full lg:w-auto">
            {/* Social Icons */}
            <div className="flex items-center gap-4">
              <a 
                href="https://x.com/DeepFamilyLabs" 
                target="_blank" 
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-neutral-400 hover:bg-white/10 hover:text-white transition-all"
              >
                <XIcon className="w-4 h-4" />
              </a>
              <a 
                href="https://github.com/DeepFamilyLabs" 
                target="_blank" 
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-neutral-400 hover:bg-white/10 hover:text-white transition-all"
              >
                <Github className="w-4 h-4" />
              </a>
              <a 
                href="mailto:DeepFamilyLabs@gmail.com"
                className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-neutral-400 hover:bg-white/10 hover:text-white transition-all"
              >
                <Mail className="w-4 h-4" />
              </a>
            </div>

            <div className="flex flex-col md:flex-row items-center gap-6 w-full lg:w-auto justify-between lg:justify-end">
              {/* Language Switcher */}
              <div className="relative" ref={langMenuRef}>
                <button
                  onClick={() => setIsLangOpen(!isLangOpen)}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-sm font-medium text-neutral-300 hover:bg-white/10 transition-colors cursor-pointer min-w-[140px] justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    <span>{currentLanguage.nativeName}</span>
                  </div>
                  <ChevronUp className={`w-3 h-3 transition-transform duration-200 ${isLangOpen ? "rotate-180" : ""}`} />
                </button>
                
                {isLangOpen && (
                  <div className="absolute bottom-full right-0 mb-2 w-48 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-xl overflow-hidden py-1 animate-in fade-in zoom-in-95 duration-200">
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

              {/* Copyright */}
              <p className="text-neutral-500 text-sm whitespace-nowrap">
                {t("footer.rights")}
              </p>
            </div>
          </div>
        </div>
      </PageContainer>
    </footer>
  );
});

SiteFooter.displayName = "SiteFooter";
export default SiteFooter;

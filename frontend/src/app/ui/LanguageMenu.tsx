import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Globe } from "lucide-react";
import { languages } from "../config/languages";

const LINK_CLASSES = "transition-colors hover:text-ink focus-visible:text-ink";

/**
 * LanguageMenu: the language switch in the desktop status bar, beside the legal
 * and social links.
 *
 * Changing language is rare, and the foot of a site is where people look for
 * it. Keeping it here also leaves the rail without panels, so every pick in the
 * rail folds it straight back. Below md the drawer carries a language row
 * instead (see GlobalSidebar).
 */
export default function LanguageMenu() {
  const { t, i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const label = t("settings.language", "Language");
  const current = languages.find((lang) => lang.code === i18n.language);

  const pick = (code: string) => {
    void i18n.changeLanguage(code);
    setIsOpen(false);
  };

  return (
    // flex, not a plain block: an inline-flex button in a block sits on the line's
    // baseline, which lifts it above the links beside it.
    <div className="relative flex" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="true"
        aria-expanded={isOpen}
        title={label}
        className={`inline-flex items-center gap-1.5 ${LINK_CLASSES}`}
      >
        <Globe className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">{label}: </span>
        <span>{current?.nativeName ?? i18n.language}</span>
      </button>

      {isOpen ? (
        <div
          role="radiogroup"
          aria-label={label}
          className="absolute bottom-full right-0 mb-2 w-44 rounded-xl border border-hairline bg-surface p-1.5 shadow-[0_16px_40px_-16px_rgba(15,23,42,0.35)] dark:shadow-[0_16px_40px_-16px_rgba(0,0,0,0.75)]"
        >
          {languages.map((lang) => {
            const selected = lang.code === i18n.language;
            return (
              <button
                key={lang.code}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => pick(lang.code)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                  selected
                    ? "bg-surface-alt font-medium text-ink"
                    : "text-ink-muted hover:bg-surface-alt hover:text-ink"
                }`}
              >
                <span>{lang.nativeName}</span>
                {selected ? (
                  <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

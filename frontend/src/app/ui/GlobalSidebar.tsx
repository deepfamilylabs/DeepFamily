import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { Globe, ChevronRight, X, Moon, Sun, Image } from "lucide-react";
import { useSidebar, useTheme } from "../context";
import { useResponsiveModalMode } from "../../shared/ui";
import { languages } from "../config/languages";
import Logo from "./Logo";

/**
 * GlobalSidebar
 *
 * Desktop: a 4rem icon rail pinned under the header. Hover (or keyboard focus)
 * widens it to show labels, clicking an item opens its panel and pins the
 * rail open until it is dismissed. Both widths are *overlays* — the main
 * content keeps a constant 4rem padding (see Layout), so nothing in the page
 * reflows when the rail opens. Click-outside and Escape close the panel.
 *
 * Mobile: a full-screen drawer with modal semantics — focus trap, Escape,
 * body scroll lock, and focus restored to whatever opened it.
 */

type IconType = ComponentType<{ className?: string }>;

type SidebarItem =
  | { id: string; icon: IconType; label: string; kind: "panel"; content: ReactNode }
  | { id: string; icon: IconType; label: string; kind: "switch"; checked: boolean; onToggle: () => void }
  | { id: string; icon: IconType; label: string; kind: "action"; onClick: () => void };

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const DESKTOP_QUERY = "(min-width: 768px)";

function SidebarRow({
  item,
  showLabel,
  isActive,
  onSelect,
}: {
  item: SidebarItem;
  showLabel: boolean;
  isActive: boolean;
  onSelect: () => void;
}) {
  const Icon = item.icon;
  const panelId = `sidebar-panel-${item.id}`;

  const ariaProps =
    item.kind === "panel"
      ? { "aria-expanded": isActive, "aria-controls": panelId }
      : item.kind === "switch"
        ? { role: "switch", "aria-checked": item.checked }
        : {};

  return (
    <button
      type="button"
      id={`sidebar-item-${item.id}`}
      onClick={onSelect}
      aria-label={item.label}
      title={showLabel ? undefined : item.label}
      {...ariaProps}
      className={`relative w-full h-14 flex items-center gap-3 pl-5 pr-4 text-left transition-colors motion-reduce:transition-none ${
        isActive
          ? "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/10"
          : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-orange-500 transition-opacity duration-200 motion-reduce:transition-none ${
          isActive ? "opacity-100" : "opacity-0"
        }`}
      />
      <Icon className="w-6 h-6 shrink-0" />
      <span
        className={`flex-1 min-w-0 font-medium whitespace-nowrap overflow-hidden transition-opacity duration-200 motion-reduce:transition-none ${
          showLabel ? "opacity-100" : "opacity-0"
        }`}
      >
        {item.label}
      </span>
      <span
        aria-hidden="true"
        className={`shrink-0 transition-opacity duration-200 motion-reduce:transition-none ${
          showLabel ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {item.kind === "panel" && (
          <ChevronRight
            className={`w-4 h-4 transition-transform motion-reduce:transition-none ${isActive ? "rotate-90" : ""}`}
          />
        )}
        {item.kind === "switch" && (
          <span
            className={`inline-flex w-10 h-6 items-center rounded-full p-1 transition-colors motion-reduce:transition-none ${
              item.checked ? "bg-orange-500" : "bg-slate-300 dark:bg-slate-600"
            }`}
          >
            <span
              className={`block w-4 h-4 rounded-full bg-white shadow-xs transition-transform motion-reduce:transition-none ${
                item.checked ? "translate-x-4" : ""
              }`}
            />
          </span>
        )}
      </span>
    </button>
  );
}

export default function GlobalSidebar() {
  const { isMobileOpen, closeMobileSidebar, activeSection, toggleSection, closeSection } =
    useSidebar();
  const { t, i18n } = useTranslation();
  const { isDark, toggleTheme } = useTheme();
  const location = useLocation();
  const isDesktop = useResponsiveModalMode(DESKTOP_QUERY);

  const [isHovered, setIsHovered] = useState(false);
  const [isFocusWithin, setIsFocusWithin] = useState(false);
  const containerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const isPanelOpen = activeSection !== null;
  const isRailOpen = isHovered || isFocusWithin || isPanelOpen;
  const showLabels = isMobileOpen || (isDesktop && isRailOpen);
  // Off-canvas on mobile: keep it out of the tab order and the a11y tree.
  const isOffCanvas = !isDesktop && !isMobileOpen;

  // `inert` keeps the off-canvas drawer out of the tab order. React 18 has no
  // prop for it, so it goes on the node directly.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (isOffCanvas) {
      node.setAttribute("inert", "");
    } else {
      node.removeAttribute("inert");
    }
  }, [isOffCanvas]);

  // Navigating away should never leave the drawer covering the new page.
  useEffect(() => {
    closeMobileSidebar();
  }, [location.pathname, closeMobileSidebar]);

  // Mobile drawer: modal semantics.
  useEffect(() => {
    if (!isMobileOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMobileSidebar();
        return;
      }
      if (event.key !== "Tab") return;

      const nodes = containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [isMobileOpen, closeMobileSidebar]);

  // Desktop panel: dismiss on outside click or Escape.
  useEffect(() => {
    if (!isPanelOpen || isMobileOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) closeSection();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeSection();
      // Focus may sit inside the panel we just collapsed — put it back on the trigger.
      document.getElementById(`sidebar-item-${activeSection}`)?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPanelOpen, isMobileOpen, activeSection, closeSection]);

  const changeLanguage = useCallback((code: string) => i18n.changeLanguage(code), [i18n]);

  const items = useMemo<SidebarItem[]>(
    () => [
      {
        id: "language",
        kind: "panel",
        icon: Globe,
        label: t("settings.language", "Language"),
        content: (
          <div className="p-4 space-y-2" role="radiogroup" aria-label={t("settings.language", "Language")}>
            {languages.map((lang) => {
              const selected = i18n.language === lang.code;
              return (
                <button
                  key={lang.code}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => changeLanguage(lang.code)}
                  className={`w-full text-left px-4 py-3 rounded-lg transition-colors motion-reduce:transition-none flex items-center justify-between ${
                    selected
                      ? "bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400 font-medium"
                      : "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                  }`}
                >
                  <span>{lang.nativeName}</span>
                  {selected && <span aria-hidden="true" className="w-2 h-2 rounded-full bg-orange-500" />}
                </button>
              );
            })}
          </div>
        ),
      },
      {
        id: "theme",
        kind: "switch",
        icon: isDark ? Moon : Sun,
        label: t("settings.theme", "Theme"),
        checked: isDark,
        onToggle: toggleTheme,
      },
      {
        id: "logo",
        kind: "action",
        icon: Image,
        label: t("logo.label", "Logo"),
        onClick: () => window.open("/logo.html", "_blank", "noopener,noreferrer"),
      },
    ],
    [t, i18n.language, changeLanguage, isDark, toggleTheme],
  );

  const handleSelect = (item: SidebarItem) => {
    if (item.kind === "switch") {
      item.onToggle();
      return;
    }
    if (item.kind === "action") {
      item.onClick();
      return;
    }
    toggleSection(item.id);
  };

  const railWidth = isPanelOpen ? "md:w-72" : isRailOpen ? "md:w-56" : "md:w-16";

  return (
    <nav
      id="global-sidebar"
      ref={containerRef}
      aria-label={t("settings.title", "Settings")}
      aria-hidden={isOffCanvas || undefined}
      role={!isDesktop && isMobileOpen ? "dialog" : undefined}
      aria-modal={!isDesktop && isMobileOpen ? true : undefined}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocusWithin(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsFocusWithin(false);
        }
      }}
      className={`
        fixed left-0 bottom-0 flex flex-col
        bg-white dark:bg-slate-900 shadow-xl
        transition-[width,translate] duration-300 ease-in-out motion-reduce:transition-none
        will-change-[translate]
        z-10005 md:z-90
        pb-[env(safe-area-inset-bottom)]

        /* Mobile: full-screen drawer */
        top-0 w-full ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}

        /* Desktop: rail under the header; open widths overlay the content */
        md:translate-x-0 md:top-16 md:border-r md:border-gray-100 md:dark:border-slate-800
        ${railWidth}
      `}
    >
      {/* Mobile drawer header */}
      <div className="md:hidden p-4 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center">
        <div className="flex items-center gap-1.5">
          <Logo className="w-7 h-7 shrink-0 text-orange-500" />
          <span className="text-[1.6rem] font-display mt-1 leading-none font-medium bg-linear-to-r from-orange-400 to-red-500 bg-clip-text text-transparent">
            Deepfamily
          </span>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={closeMobileSidebar}
          aria-label={t("settings.close", "Close settings")}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors motion-reduce:transition-none"
        >
          <X className="w-6 h-6 text-slate-600 dark:text-slate-300" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden sidebar-scroll">
        {items.map((item) => (
          <div key={item.id} className="border-b border-gray-50 dark:border-slate-800/50 md:border-none">
            <SidebarRow
              item={item}
              showLabel={showLabels}
              isActive={activeSection === item.id}
              onSelect={() => handleSelect(item)}
            />

            {item.kind === "panel" && (
              <div
                id={`sidebar-panel-${item.id}`}
                role="region"
                aria-labelledby={`sidebar-item-${item.id}`}
                className={`grid transition-[grid-template-rows] duration-300 motion-reduce:transition-none bg-slate-50/50 dark:bg-black/20 ${
                  activeSection === item.id ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div
                  className={`overflow-hidden ${activeSection === item.id ? "visible" : "invisible"}`}
                >
                  {item.content}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </nav>
  );
}

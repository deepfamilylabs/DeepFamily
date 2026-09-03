import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { Globe, ChevronRight, X, Moon, Sun, Image, Home, TreePine, Zap } from "lucide-react";
import { useActivePath, useSidebar, useTheme } from "../context";
import { resolveNavSection, type NavSection } from "../config/navSections";
import { useResponsiveModalMode } from "../../shared/ui";
import { languages } from "../config/languages";
import Logo from "./Logo";

/**
 * GlobalSidebar
 *
 * Desktop: a 4rem icon rail spanning the full viewport height, stacked above
 * the header — so it owns the brand mark and the header starts after it (both
 * take a matching 4rem offset, see Layout). Hover (or keyboard focus) widens
 * the rail to show labels, clicking an item opens its panel and pins the rail
 * open until it is dismissed. Both widths are *overlays* — the main content
 * keeps a constant 4rem padding, so nothing in the page reflows when the rail
 * opens. Click-outside and Escape close the panel.
 *
 * Mobile: a full-screen drawer with modal semantics — focus trap, Escape,
 * body scroll lock, and focus restored to whatever opened it. It drops the
 * entries the bottom nav already shows, so the drawer only offers what is not
 * already on screen.
 *
 * Two groups: routes at the top, settings pinned to the bottom on desktop.
 * They highlight for different reasons — a route row lights up for the section
 * the current URL belongs to, a settings row for the panel it has open — so
 * they must not share one notion of "active".
 */

type IconType = ComponentType<{ className?: string }>;

type SidebarRouteItem = {
  id: string;
  icon: IconType;
  label: string;
  kind: "route";
  to: string;
  section: NavSection;
  /** The bottom nav already carries it, so the mobile drawer skips it. */
  inBottomNav?: boolean;
};

type SidebarItem =
  | SidebarRouteItem
  | { id: string; icon: IconType; label: string; kind: "panel"; content: ReactNode }
  | {
      id: string;
      icon: IconType;
      label: string;
      kind: "switch";
      checked: boolean;
      onToggle: () => void;
    }
  | { id: string; icon: IconType; label: string; kind: "action"; onClick: () => void };

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const DESKTOP_QUERY = "(min-width: 768px)";

const ROW_BASE =
  "relative w-full h-14 flex items-center gap-3 pl-5 pr-4 text-left transition-colors motion-reduce:transition-none";

function rowClasses(isActive: boolean) {
  return `${ROW_BASE} ${
    isActive
      ? "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/10"
      : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
  }`;
}

function SidebarRow({
  item,
  showLabel,
  isActive,
  onSelect,
}: {
  item: SidebarItem;
  showLabel: boolean;
  isActive: boolean;
  onSelect: (event: MouseEvent<HTMLElement>) => void;
}) {
  const Icon = item.icon;
  const panelId = `sidebar-panel-${item.id}`;

  const body = (
    <>
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
    </>
  );

  // A route is a real link: middle-click and open-in-new-tab have to work.
  // Plain Link, not NavLink — the row is current for the whole *section* it
  // owns, which NavLink's own URL match would contradict on the detail routes.
  if (item.kind === "route") {
    return (
      <Link
        to={item.to}
        id={`sidebar-item-${item.id}`}
        onClick={onSelect}
        aria-label={item.label}
        aria-current={isActive ? "page" : undefined}
        title={showLabel ? undefined : item.label}
        className={rowClasses(isActive)}
      >
        {body}
      </Link>
    );
  }

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
      className={rowClasses(isActive)}
    >
      {body}
    </button>
  );
}

export default function GlobalSidebar() {
  const { isMobileOpen, closeMobileSidebar, activePanel, togglePanel, closePanel } = useSidebar();
  const { t, i18n } = useTranslation();
  const { isDark, toggleTheme } = useTheme();
  const location = useLocation();
  const { activePath, setActivePath } = useActivePath();
  const isDesktop = useResponsiveModalMode(DESKTOP_QUERY);

  const [isHovered, setIsHovered] = useState(false);
  const [isFocusWithin, setIsFocusWithin] = useState(false);
  const containerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const isPanelOpen = activePanel !== null;
  // Detail routes stay under the section they belong to — the same table the
  // bottom nav reads.
  const activeNavSection = resolveNavSection(activePath);
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
      if (!containerRef.current?.contains(event.target as Node)) closePanel();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closePanel();
      // Focus may sit inside the panel we just collapsed — put it back on the trigger.
      document.getElementById(`sidebar-item-${activePanel}`)?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPanelOpen, isMobileOpen, activePanel, closePanel]);

  // Picking a language finishes the errand, so the panel (and with it the
  // pinned-open rail) closes behind it.
  const changeLanguage = useCallback(
    (code: string) => {
      void i18n.changeLanguage(code);
      closePanel();
    },
    [i18n, closePanel],
  );

  const navItems = useMemo<SidebarRouteItem[]>(
    () => [
      {
        id: "home",
        kind: "route",
        icon: Home,
        label: t("navigation.home"),
        to: "/",
        section: "home",
        inBottomNav: true,
      },
      {
        id: "familyTree",
        kind: "route",
        icon: TreePine,
        label: t("navigation.familyTree"),
        to: "/familyTree",
        section: "familyTree",
        inBottomNav: true,
      },
      {
        // The bottom nav has no room for it, so on mobile the drawer is the
        // only way in besides the floating action button.
        id: "actions",
        kind: "route",
        icon: Zap,
        label: t("navigation.actions", "Actions"),
        to: "/actions",
        section: "actions",
      },
    ],
    [t],
  );

  const settingItems = useMemo<SidebarItem[]>(
    () => [
      {
        id: "language",
        kind: "panel",
        icon: Globe,
        label: t("settings.language", "Language"),
        content: (
          <div
            className="p-4 space-y-2"
            role="radiogroup"
            aria-label={t("settings.language", "Language")}
          >
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
                  {selected && (
                    <span aria-hidden="true" className="w-2 h-2 rounded-full bg-orange-500" />
                  )}
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

  // Below md, Home and Family are already one tap away in the bottom nav.
  const visibleNavItems = isDesktop ? navItems : navItems.filter((item) => !item.inBottomNav);

  const isRowActive = (item: SidebarItem) =>
    item.kind === "route" ? activeNavSection === item.section : activePanel === item.id;

  const handleSelect = (item: SidebarItem, event: MouseEvent<HTMLElement>) => {
    if (item.kind === "route") {
      // Light the row up on click, the way the bottom nav does, and get the
      // drawer out of the way even when the route does not change.
      setActivePath(item.to);
      closeMobileSidebar();
      closePanel();
      // A pointer click leaves focus on the link, and focus-within holds the
      // rail open long after the pointer has gone. Keyboard activation
      // (detail 0) keeps its focus — it is the only way back to the rail.
      if (event.detail > 0) {
        setIsFocusWithin(false);
        event.currentTarget.blur();
      }
      return;
    }
    if (item.kind === "switch") {
      item.onToggle();
      return;
    }
    if (item.kind === "action") {
      item.onClick();
      return;
    }
    togglePanel(item.id);
  };

  const renderItem = (item: SidebarItem) => (
    <div key={item.id} className="border-b border-gray-50 dark:border-slate-800/50 md:border-none">
      <SidebarRow
        item={item}
        showLabel={showLabels}
        isActive={isRowActive(item)}
        onSelect={(event) => handleSelect(item, event)}
      />

      {item.kind === "panel" && (
        <div
          id={`sidebar-panel-${item.id}`}
          role="region"
          aria-labelledby={`sidebar-item-${item.id}`}
          className={`grid transition-[grid-template-rows] duration-300 motion-reduce:transition-none bg-slate-50/50 dark:bg-black/20 ${
            activePanel === item.id ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className={`overflow-hidden ${activePanel === item.id ? "visible" : "invisible"}`}>
            {item.content}
          </div>
        </div>
      )}
    </div>
  );

  const railWidth = isPanelOpen ? "md:w-72" : isRailOpen ? "md:w-56" : "md:w-16";

  return (
    <nav
      id="global-sidebar"
      ref={containerRef}
      aria-label={t("navigation.title", "Main navigation")}
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
        /* Full height, minus the status bar so the last row never straddles it */
        fixed inset-y-0 left-0 flex flex-col
        bg-white dark:bg-slate-900 shadow-xl
        transition-[width,translate] duration-300 ease-in-out motion-reduce:transition-none
        will-change-[translate]
        z-10005 md:z-110
        pb-[calc(env(safe-area-inset-bottom)+var(--app-statusbar-h))]

        /* Mobile: full-screen drawer */
        w-full ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}

        /* Desktop: full-height rail beside the header; open widths overlay the content */
        md:translate-x-0 md:border-r md:border-gray-100 md:dark:border-slate-800
        ${railWidth}
      `}
    >
      {/* Brand: the drawer header on mobile, the rail's own head on desktop. The
          logo sits on the same axis as the item icons; the wordmark follows the
          labels in and out. */}
      <div className="h-16 shrink-0 flex items-center gap-2 pl-5 pr-4">
        <Link
          to="/"
          className="flex flex-1 min-w-0 items-center gap-3 group focus:outline-hidden"
          title={showLabels ? undefined : "Deepfamily"}
        >
          <span className="w-6 h-6 flex shrink-0 items-center justify-center">
            <Logo className="w-7 h-7 shrink-0 text-orange-500 transition-transform duration-300 motion-reduce:transition-none group-hover:-rotate-90" />
          </span>
          <span
            className={`min-w-0 overflow-hidden whitespace-nowrap text-[1.6rem] font-display mt-1 leading-none font-medium bg-linear-to-r from-orange-400 to-red-500 bg-clip-text text-transparent transition-opacity duration-200 motion-reduce:transition-none ${
              showLabels ? "opacity-100" : "opacity-0"
            }`}
          >
            Deepfamily
          </span>
        </Link>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={closeMobileSidebar}
          aria-label={t("navigation.closeMenu", "Close menu")}
          className="md:hidden shrink-0 p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors motion-reduce:transition-none"
        >
          <X className="w-6 h-6 text-slate-600 dark:text-slate-300" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden sidebar-scroll">
        <div className="flex min-h-full flex-col">
          <div>{visibleNavItems.map(renderItem)}</div>
          {/* Settings follow the routes, and drop to the foot of the rail on
              desktop where there is height to spare. */}
          <div className="md:mt-auto" role="group" aria-label={t("settings.title", "Settings")}>
            {settingItems.map(renderItem)}
          </div>
        </div>
      </div>
    </nav>
  );
}

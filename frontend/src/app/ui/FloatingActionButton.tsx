import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Image, Plus, Star, UserPlus } from "lucide-react";
import { useActivePath } from "../context";

interface FloatingActionButtonProps {
  className?: string;
}

/**
 * Colour only ever enters through the 32px icon tile — the row itself stays on
 * `surface` + `hairline` so the three shortcuts read as one family. Hovering
 * lets that row's semantic tone bleed into its border and fill; it never floods
 * the row, which would erase the difference between the three actions.
 *
 * Tones match the cards on the actions page: add-version primary, endorse
 * success, mint-nft info.
 */
const TONE = {
  primary: {
    tile: "bg-primary/12 group-hover:bg-primary/20 dark:bg-primary/15 dark:group-hover:bg-primary/24",
    icon: "text-primary",
    row: "hover:border-primary/45 hover:bg-primary/6 dark:hover:bg-primary/8",
    arrow: "group-hover:text-primary",
  },
  success: {
    tile: "bg-success/12 group-hover:bg-success/20 dark:bg-success/15 dark:group-hover:bg-success/24",
    icon: "text-success",
    row: "hover:border-success/45 hover:bg-success/6 dark:hover:bg-success/8",
    arrow: "group-hover:text-success",
  },
  info: {
    tile: "bg-info/12 group-hover:bg-info/20 dark:bg-info/15 dark:group-hover:bg-info/24",
    icon: "text-info",
    row: "hover:border-info/45 hover:bg-info/6 dark:hover:bg-info/8",
    arrow: "group-hover:text-info",
  },
} as const;

const ROW_SHADOW =
  "shadow-[0_8px_20px_-12px_rgba(15,23,42,0.28),0_1px_3px_-1px_rgba(15,23,42,0.08)] hover:shadow-[0_14px_26px_-14px_rgba(15,23,42,0.32),0_2px_4px_-2px_rgba(15,23,42,0.10)] active:shadow-[0_6px_14px_-10px_rgba(15,23,42,0.30)] dark:shadow-[0_10px_24px_-14px_rgba(0,0,0,0.9),0_1px_3px_-1px_rgba(0,0,0,0.6)] dark:hover:shadow-[0_16px_30px_-16px_rgba(0,0,0,0.95),0_2px_4px_-2px_rgba(0,0,0,0.6)]";

const FAB_SHADOW =
  "shadow-[0_12px_28px_-12px_rgba(234,88,12,0.55),0_2px_6px_-2px_rgba(15,23,42,0.12)] hover:shadow-[0_16px_32px_-12px_rgba(234,88,12,0.6),0_2px_6px_-2px_rgba(15,23,42,0.14)] active:shadow-[0_6px_16px_-10px_rgba(234,88,12,0.5)] dark:shadow-[0_12px_28px_-12px_rgba(251,146,60,0.45),0_2px_6px_-2px_rgba(0,0,0,0.6)]";

export default function FloatingActionButton({ className = "" }: FloatingActionButtonProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setActivePath } = useActivePath();
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    if (isOpen) {
      menu.removeAttribute("inert");
    } else {
      menu.setAttribute("inert", "");
    }
  }, [isOpen]);

  const closeMenu = useCallback(() => {
    if (menuRef.current?.contains(document.activeElement)) {
      triggerRef.current?.focus();
    }
    setIsOpen(false);
  }, []);

  /*
   * Rendered bottom-up (`flex-col-reverse`), so the first entry sits closest to
   * the trigger and leads the stagger. Closing replays it in reverse, tighter.
   */
  const actions = [
    {
      id: "add-version",
      label: t("actions.addVersion", "Add Version"),
      icon: UserPlus,
      tone: TONE.primary,
      enterDelay: "delay-[0ms]",
      exitDelay: "delay-[60ms]",
      tab: "add-version",
    },
    {
      id: "endorse",
      label: t("actions.endorsement", "Endorsement"),
      icon: Star,
      tone: TONE.success,
      enterDelay: "delay-[40ms]",
      exitDelay: "delay-[30ms]",
      tab: "endorse",
    },
    {
      id: "mint-nft",
      label: t("actions.mintNFT", "Mint NFT"),
      icon: Image,
      tone: TONE.info,
      enterDelay: "delay-[80ms]",
      exitDelay: "delay-[0ms]",
      tab: "mint-nft",
    },
  ];

  const handleActionClick = (tab: string) => {
    closeMenu();
    setActivePath("/actions");
    navigate(`/actions?tab=${tab}&open=1`);
  };

  const toggleMenu = () => {
    if (isOpen) {
      closeMenu();
    } else {
      setIsOpen(true);
    }
  };

  /**
   * Arrow keys walk the shortcuts in the order they are painted: Down travels
   * toward the trigger, Up away from it. From the trigger itself, either key
   * opens the menu and steps into it.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && isOpen) {
      event.stopPropagation();
      closeMenu();
      return;
    }

    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    if (items.length === 0) return;

    event.preventDefault();

    if (!isOpen) {
      setIsOpen(true);
      // The menu is still `inert` this frame; focus it once React has painted.
      requestAnimationFrame(() => items[0]?.focus());
      return;
    }

    const step = event.key === "ArrowUp" ? 1 : -1;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = current === -1 ? 0 : (current + step + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <>
      {/* Click-catcher. Dims the page on phones, where the sheet covers content. */}
      {isOpen && (
        <div
          className="fixed inset-0 z-9999 bg-[rgba(15,23,42,0.16)] md:bg-transparent dark:bg-[rgba(2,6,12,0.36)] dark:md:bg-transparent"
          onClick={closeMenu}
        />
      )}

      <div
        className={`fixed right-6 md:right-10 z-10000 bottom-24 md:bottom-10 ${className}`}
        onKeyDown={handleKeyDown}
      >
        <div
          ref={menuRef}
          id={menuId}
          className="absolute bottom-[72px] md:bottom-[76px] right-0 flex flex-col-reverse gap-2.5 items-end"
        >
          {actions.map((action) => {
            const Icon = action.icon;

            return (
              <div
                key={action.id}
                className={`transition-[opacity,transform] motion-reduce:duration-100 ${
                  isOpen
                    ? `opacity-100 translate-y-0 scale-100 duration-200 ease-[cubic-bezier(0.2,0,0,1)] ${action.enterDelay}`
                    : `opacity-0 translate-y-2 scale-[0.96] pointer-events-none duration-[140ms] ease-[cubic-bezier(0.4,0,1,1)] motion-reduce:translate-y-0 motion-reduce:scale-100 ${action.exitDelay}`
                }`}
              >
                <button
                  type="button"
                  tabIndex={isOpen ? 0 : -1}
                  onClick={() => handleActionClick(action.tab)}
                  className={`
                    group flex items-center gap-3 h-12 pl-2 pr-4 rounded-[14px]
                    border border-hairline bg-surface ${ROW_SHADOW} ${action.tone.row}
                    transition-[transform,border-color,background-color,box-shadow]
                    duration-[140ms] ease-out
                    hover:-translate-x-[3px] hover:scale-[1.012] active:scale-[0.99]
                    motion-reduce:hover:translate-x-0 motion-reduce:hover:scale-100
                    focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary
                  `}
                >
                  <span
                    className={`w-8 h-8 rounded-[10px] shrink-0 flex items-center justify-center transition-colors duration-[140ms] ${action.tone.tile}`}
                  >
                    <Icon className={`w-[18px] h-[18px] ${action.tone.icon}`} strokeWidth={2} />
                  </span>
                  <span className="text-sm font-semibold text-ink whitespace-nowrap">
                    {action.label}
                  </span>
                  {/* Holds its 14px from the start, so hovering never reflows the row. */}
                  <ArrowRight
                    aria-hidden="true"
                    className={`w-3.5 h-3.5 shrink-0 text-ink-subtle opacity-0 -translate-x-0.5 transition-[opacity,transform,color] duration-[140ms] ease-out group-hover:opacity-100 group-hover:translate-x-0 ${action.tone.arrow}`}
                    strokeWidth={2.5}
                  />
                </button>
              </div>
            );
          })}
        </div>

        <button
          ref={triggerRef}
          type="button"
          onClick={toggleMenu}
          aria-controls={menuId}
          aria-expanded={isOpen}
          aria-label={
            isOpen
              ? t("actions.closeMenu", "Close actions menu")
              : t("actions.openMenu", "Open actions menu")
          }
          className={`
            w-14 h-14 md:w-15 md:h-15 rounded-full bg-primary hover:bg-primary-hover
            text-white dark:text-surface-body
            flex items-center justify-center ${FAB_SHADOW}
            transition-[transform,background-color,box-shadow] duration-[160ms] ease-out
            hover:-translate-y-px hover:scale-[1.03] active:translate-y-0 active:scale-[0.96]
            motion-reduce:hover:translate-y-0 motion-reduce:hover:scale-100
            focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-primary
          `}
        >
          {/* One glyph: the plus turns 45° into the close mark. */}
          <Plus
            className={`w-6 h-6 md:w-[26px] md:h-[26px] transition-transform duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:duration-100 ${
              isOpen ? "rotate-45" : "rotate-0"
            }`}
            strokeWidth={2.4}
          />
        </button>
      </div>
    </>
  );
}

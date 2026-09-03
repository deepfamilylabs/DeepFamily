import type { TFunction } from "i18next";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { FamilyTreeConfigForm } from "../../domains/config";

export interface FamilySettingsDrawerProps {
  t: TFunction;
  open: boolean;
  onClose: () => void;
  /** Preserve browser-page scrolling while keeping the desktop drawer below the site header. */
  layout?: "viewport" | "document";
}

export function FamilySettingsDrawer({
  t,
  open,
  onClose,
  layout = "viewport",
}: FamilySettingsDrawerProps) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  const title = t("familyTree.actions.openConfig", "Family settings");

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label={t("common.close", "Close")}
          onClick={onClose}
          className="absolute inset-0 z-30 cursor-default bg-ink/25 md:hidden"
        />
      ) : null}

      <aside
        role="dialog"
        aria-label={title}
        aria-hidden={!open}
        className={`absolute inset-y-0 left-0 z-40 w-[min(20rem,88vw)] shrink-0 overflow-hidden shadow-xl shadow-ink/10 transition-transform duration-300 ease-out md:z-auto md:translate-x-0 md:shadow-none md:transition-[width] ${
          layout === "document"
            ? "md:sticky md:top-16 md:bottom-auto md:h-[calc(100vh-var(--app-header-h)-var(--app-statusbar-h))] md:self-start"
            : "md:static"
        } ${
          open ? "translate-x-0 md:w-80" : "pointer-events-none -translate-x-full md:w-0"
        }`}
      >
        <div className="flex h-full w-[min(20rem,88vw)] flex-col border-r border-hairline bg-surface md:w-80">
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-hairline px-3">
            <span className="truncate text-[13px] font-semibold text-ink">{title}</span>
            <button
              type="button"
              onClick={onClose}
              title={t("common.close", "Close")}
              aria-label={t("common.close", "Close")}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
            >
              <X className="h-[15px] w-[15px]" />
            </button>
          </div>

          <div className="min-h-0 flex-1">{mounted ? <FamilyTreeConfigForm /> : null}</div>
        </div>
      </aside>
    </>
  );
}

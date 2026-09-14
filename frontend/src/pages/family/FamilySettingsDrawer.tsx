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
  // Below md the drawer overlays the page like a modal. In a scrolling document
  // an absolute drawer spans the whole page, so its head can sit far above the
  // viewport — there it is fixed between the site header and the status bar
  // instead. Both layouts layer it over the app chrome that floats on the page:
  // the page's own sticky bars (the people toolbar used to paint over it) and
  // the floating action button, which covered its save button. See
  // shared/ui/overlayLayers for the band it sits in.
  const isDocument = layout === "document";

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label={t("common.close", "Close")}
          onClick={onClose}
          className={`${isDocument ? "fixed" : "absolute"} inset-0 z-10002 cursor-default bg-ink/25 md:hidden`}
        />
      ) : null}

      <aside
        role="dialog"
        aria-label={title}
        aria-hidden={!open}
        className={`left-0 z-10003 w-[min(20rem,88vw)] shrink-0 overflow-hidden shadow-xl shadow-ink/10 transition-transform duration-300 ease-out md:z-auto md:translate-x-0 md:shadow-none md:transition-[width] ${
          isDocument
            ? "fixed top-[var(--app-header-h)] bottom-[var(--app-statusbar-h)] md:sticky md:top-16 md:bottom-auto md:h-[calc(100vh-var(--app-header-h)-var(--app-statusbar-h))] md:self-start"
            : "absolute inset-y-0 md:static"
        } ${open ? "translate-x-0 md:w-80" : "pointer-events-none -translate-x-full md:w-0"}`}
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

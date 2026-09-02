import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { TFunction } from "i18next";
import { FamilyTreeConfigForm } from "../../../domains/config";

export interface TreeConfigDrawerProps {
  t: TFunction;
  open: boolean;
  onClose: () => void;
}

/**
 * The genealogy settings drawer, docked under the toggle that opens it.
 *
 * These fields — network, contract, root hash, traversal — describe the chart this page draws, so
 * they belong to the page rather than to the global sidebar, where they were only reachable by
 * hovering the strip open first.
 *
 * From `md` up the drawer is in flow and animates its own width, so opening it pushes the canvas
 * right rather than covering it. On a phone there is no room to give away, so it stays an overlay
 * that slides in over the canvas with a backdrop.
 *
 * The form is mounted on first open and then kept, so the panel has something to carry on the way
 * out and reopening does not re-run its network reads.
 */
export function TreeConfigDrawer({ t, open, onClose }: TreeConfigDrawerProps) {
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

  const title = t("familyTree.actions.openConfig", "Genealogy settings");

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
        className={`absolute inset-y-0 left-0 z-40 w-[min(20rem,88vw)] shrink-0 overflow-hidden shadow-xl shadow-ink/10 transition-transform duration-300 ease-out md:static md:z-auto md:translate-x-0 md:shadow-none md:transition-[width] ${
          open ? "translate-x-0 md:w-80" : "pointer-events-none -translate-x-full md:w-0"
        }`}
      >
        {/* Fixed width so the form does not reflow while the drawer's own width animates. */}
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

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {mounted ? <FamilyTreeConfigForm /> : null}
          </div>
        </div>
      </aside>
    </>
  );
}

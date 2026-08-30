import type React from "react";
import { X } from "lucide-react";
import { ModalShell } from "./ModalShell";
import { OVERLAY_Z_INDEX } from "./overlayLayers";
import { useBottomSheetDrag } from "./useBottomSheetDrag";
import {
  MODAL_ACCENT_TILE,
  MODAL_CLOSE_BUTTON,
  MODAL_HEADER,
  MODAL_TILE_BASE,
  MODAL_TITLE,
  type ModalAccent,
} from "./modalTokens";

export type ResponsiveModalFrameProps = {
  isOpen: boolean;
  onClose: () => void;
  isDesktop: boolean;
  ariaLabel: string;
  icon: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  entered: boolean;
  /** Flow identity behind the header icon; defaults to the protocol orange. */
  accent?: ModalAccent;
  /** Rendered between the title block and the close button (status, stepper). */
  headerAside?: React.ReactNode;
  /**
   * Full-width action strip pinned under the header. For read modals whose
   * actions belong to the record rather than to a submit, so they don't ride
   * in the header's description slot.
   */
  toolbar?: React.ReactNode;
  zIndex?: string;
  closeLabel?: string;
  children: React.ReactNode;
};

/**
 * The `lg` shell: a centered 720px dialog on desktop, a draggable bottom sheet
 * on mobile. Header and footer sit on `surface`, the scrolling body on
 * `surface-body`, so content cards read as one step of depth without shadows.
 */
export function ResponsiveModalFrame({
  isOpen,
  onClose,
  isDesktop,
  ariaLabel,
  icon,
  title,
  description,
  entered,
  accent = "primary",
  headerAside,
  toolbar,
  zIndex = OVERLAY_Z_INDEX.appModal,
  closeLabel = "Close",
  children,
}: ResponsiveModalFrameProps) {
  const { dragging, dragOffset, startDrag, updateDrag, finishDrag, cancelDrag } =
    useBottomSheetDrag({ isOpen, onClose });

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      bare
      zIndex={zIndex}
      ariaLabel={ariaLabel}
      disableBackdropClose={isDesktop}
    >
      <div className="overflow-x-hidden touch-pan-y h-dvh max-h-dvh md:h-full md:max-h-none">
        <div className="flex items-end md:items-center justify-center h-full w-full px-2 pt-6 pb-[env(safe-area-inset-bottom)] md:p-4">
          <div
            className={`relative flex flex-col w-full max-w-[720px] h-[calc(100dvh-1.5rem-env(safe-area-inset-bottom))] max-h-[calc(100dvh-1.5rem-env(safe-area-inset-bottom))] md:h-auto md:max-h-[92vh] bg-surface-body rounded-t-2xl md:rounded-2xl border border-hairline shadow-[0_24px_48px_-24px_rgba(15,23,42,0.28),0_2px_6px_-2px_rgba(15,23,42,0.08)] dark:shadow-[0_24px_48px_-24px_rgba(0,0,0,0.7)] overflow-hidden transform transition-[transform,opacity] duration-300 ease-out ${entered ? "translate-y-0 opacity-100 md:scale-100" : "translate-y-full opacity-0 md:translate-y-0 md:scale-95"} will-change-transform`}
            onClick={(e) => e.stopPropagation()}
            style={{
              transform: dragging ? `translateY(${dragOffset}px)` : undefined,
              transitionDuration: dragging ? "0ms" : undefined,
            }}
          >
            <div
              className={`sticky top-0 z-20 relative touch-none cursor-grab active:cursor-grabbing select-none ${MODAL_HEADER} pt-6 md:pt-4`}
              onPointerDown={(e) => {
                (e.currentTarget as any).setPointerCapture?.(e.pointerId);
                startDrag(e.clientY);
              }}
              onPointerMove={(e) => updateDrag(e.clientY)}
              onPointerUp={finishDrag}
              onPointerCancel={cancelDrag}
              onTouchStart={(e) => startDrag(e.touches[0].clientY)}
              onTouchMove={(e) => updateDrag(e.touches[0].clientY)}
              onTouchEnd={finishDrag}
            >
              <div className="md:hidden absolute top-2 left-1/2 -translate-x-1/2 h-1 w-10 rounded-full bg-hairline-strong" />

              <div className={`${MODAL_TILE_BASE} ${MODAL_ACCENT_TILE[accent]}`}>{icon}</div>

              <div className="flex-1 min-w-0">
                <h2 className={MODAL_TITLE}>{title}</h2>
                {description ? (
                  <div className="text-xs text-ink-muted">{description}</div>
                ) : null}
              </div>

              {headerAside}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onClose();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                className={MODAL_CLOSE_BUTTON}
                aria-label={closeLabel}
              >
                <X className="w-[17px] h-[17px]" />
              </button>
            </div>

            {toolbar ? (
              <div className="flex items-center gap-2 px-5 py-3.5 border-b border-hairline bg-surface overflow-x-auto">
                {toolbar}
              </div>
            ) : null}

            {children}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

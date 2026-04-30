import type React from "react";
import { X } from "lucide-react";
import { ModalShell } from "./ModalShell";
import { useBottomSheetDrag } from "./useBottomSheetDrag";

export type ResponsiveModalFrameProps = {
  isOpen: boolean;
  onClose: () => void;
  isDesktop: boolean;
  ariaLabel: string;
  icon: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  entered: boolean;
  closeLabel?: string;
  children: React.ReactNode;
};

export function ResponsiveModalFrame({
  isOpen,
  onClose,
  isDesktop,
  ariaLabel,
  icon,
  title,
  description,
  entered,
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
      zIndex="z-[10020]"
      ariaLabel={ariaLabel}
      disableBackdropClose={isDesktop}
    >
      <div className="overflow-x-hidden touch-pan-y h-[100dvh] max-h-[100dvh] md:h-full md:max-h-none">
        <div className="flex items-end md:items-center justify-center h-full w-full px-2 pt-6 pb-[env(safe-area-inset-bottom)] md:p-4">
          <div
            className={`relative flex flex-col w-full max-w-4xl h-[calc(100dvh-1.5rem-env(safe-area-inset-bottom))] max-h-[calc(100dvh-1.5rem-env(safe-area-inset-bottom))] md:h-auto md:max-h-[95vh] bg-white dark:bg-gray-950 rounded-t-lg md:rounded-lg shadow-lg border border-gray-200 dark:border-gray-800 overflow-hidden transform transition-transform duration-300 ease-out ${entered ? "translate-y-0" : "translate-y-full md:translate-y-0"} will-change-transform`}
            onClick={(e) => e.stopPropagation()}
            style={{
              transform: dragging ? `translateY(${dragOffset}px)` : undefined,
              transitionDuration: dragging ? "0ms" : undefined,
            }}
          >
            <div
              className="sticky top-0 bg-white dark:bg-gray-950 p-5 border-b border-gray-200 dark:border-gray-800 z-20 relative touch-none cursor-grab active:cursor-grabbing select-none"
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
              <div className="md:hidden absolute top-3 left-1/2 -translate-x-1/2 h-1 w-12 rounded-full bg-gray-200 dark:bg-gray-800" />

              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-11 h-11 rounded-lg bg-orange-600 flex items-center justify-center shadow-sm flex-shrink-0">
                    {icon}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50 mb-0.5 truncate">
                      {title}
                    </h2>
                    {description ? (
                      <div className="text-sm text-gray-500 dark:text-gray-400">{description}</div>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onClose();
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors flex-shrink-0 group"
                  aria-label={closeLabel}
                >
                  <X className="w-5 h-5 text-gray-400 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300 transition-colors" />
                </button>
              </div>
            </div>

            {children}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

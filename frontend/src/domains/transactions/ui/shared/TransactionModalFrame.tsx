import type React from "react";
import { X } from "lucide-react";
import { ModalShell } from "../../../../shared/ui/ModalShell";

type TransactionModalFrameProps = {
  isOpen: boolean;
  onClose: () => void;
  isDesktop: boolean;
  ariaLabel: string;
  icon: React.ReactNode;
  title: React.ReactNode;
  description: React.ReactNode;
  entered: boolean;
  dragging: boolean;
  dragOffset: number;
  startYRef: React.MutableRefObject<number | null>;
  setDragging: (value: boolean) => void;
  setDragOffset: (value: number) => void;
  children: React.ReactNode;
};

export function TransactionModalFrame({
  isOpen,
  onClose,
  isDesktop,
  ariaLabel,
  icon,
  title,
  description,
  entered,
  dragging,
  dragOffset,
  startYRef,
  setDragging,
  setDragOffset,
  children,
}: TransactionModalFrameProps) {
  const finishDrag = () => {
    if (!dragging) return;
    const shouldClose = dragOffset > 120;
    setDragging(false);
    setDragOffset(0);
    if (shouldClose) onClose();
  };

  const updateDrag = (clientY: number) => {
    if (!dragging || startYRef.current == null) return;
    setDragOffset(Math.max(0, clientY - startYRef.current));
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      bare
      zIndex="z-[1200]"
      ariaLabel={ariaLabel}
      disableBackdropClose={isDesktop}
    >
      <div
        className="overflow-x-hidden touch-pan-y h-full"
        onClick={isDesktop ? undefined : onClose}
      >
        <div className="flex items-end sm:items-center justify-center h-full w-full p-2 sm:p-4">
          <div
            className={`relative flex flex-col w-full max-w-4xl h-[95vh] sm:h-auto sm:max-h-[95vh] bg-white dark:bg-gray-950 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-800 overflow-hidden transform transition-transform duration-300 ease-out ${entered ? "translate-y-0" : "translate-y-full sm:translate-y-0"} will-change-transform`}
            onClick={(e) => e.stopPropagation()}
            style={{
              transform: dragging ? `translateY(${dragOffset}px)` : undefined,
              transitionDuration: dragging ? "0ms" : undefined,
            }}
          >
            <div
              className="sticky top-0 bg-white/80 dark:bg-gray-950/80 p-6 border-b border-gray-100 dark:border-gray-800 z-20 backdrop-blur-xl supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-gray-950/60 relative touch-none cursor-grab active:cursor-grabbing select-none"
              onPointerDown={(e) => {
                (e.currentTarget as any).setPointerCapture?.(e.pointerId);
                startYRef.current = e.clientY;
                setDragging(true);
              }}
              onPointerMove={(e) => updateDrag(e.clientY)}
              onPointerUp={finishDrag}
              onPointerCancel={() => {
                setDragging(false);
                setDragOffset(0);
              }}
              onTouchStart={(e) => {
                startYRef.current = e.touches[0].clientY;
                setDragging(true);
              }}
              onTouchMove={(e) => updateDrag(e.touches[0].clientY)}
              onTouchEnd={finishDrag}
            >
              <div className="sm:hidden absolute top-3 left-1/2 -translate-x-1/2 h-1 w-12 rounded-full bg-gray-200 dark:bg-gray-800" />

              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-400 to-red-600 flex items-center justify-center shadow-lg shadow-orange-500/20 flex-shrink-0">
                    {icon}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50 mb-0.5">
                      {title}
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                      {description}
                    </p>
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
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors flex-shrink-0 group"
                  aria-label="Close"
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

import React, { useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useDialogA11y } from "./useDialogA11y";

export interface ModalShellProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Called when the user dismisses (backdrop click, X button, Escape) */
  onClose: () => void;
  /** Maximum width utility class (default: "max-w-md"). Ignored when bare=true. */
  maxWidth?: string;
  /** z-index utility class (default: "z-[1300]") */
  zIndex?: string;
  /** Accessible label for the dialog */
  ariaLabel?: string;
  /** ID of the visible dialog title. Prefer this over ariaLabel when a title exists. */
  ariaLabelledBy?: string;
  /** ID of the visible dialog description. */
  ariaDescribedBy?: string;
  /** If true, clicking the backdrop does NOT close the modal */
  disableBackdropClose?: boolean;
  /** If true, hide the built-in X close button. Ignored when bare=true. */
  hideCloseButton?: boolean;
  /** Close button aria-label override */
  closeLabel?: string;
  /**
   * When true, ModalShell provides only the portal, backdrop overlay, escape
   * handling, scroll lock, and focus management. Children are rendered directly
   * inside the overlay container and are responsible for their own panel
   * positioning and styling. Use this for modals that need responsive
   * bottom-sheet / centered-dialog layout control.
   */
  bare?: boolean;
  children: React.ReactNode;
}

/**
 * Shared modal shell with:
 *  - Portal rendering to document.body
 *  - Backdrop overlay with click-to-close
 *  - Focus trap (returns focus on close)
 *  - Escape key handling
 *  - Scroll lock on body
 *  - Optional close button (when bare=false)
 *
 * Set bare=true to skip the default panel wrapper and control layout from
 * within children (e.g. bottom-sheet on mobile, centered dialog on desktop).
 */
export function ModalShell({
  isOpen,
  onClose,
  maxWidth = "max-w-md",
  zIndex = "z-[1300]",
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  disableBackdropClose,
  hideCloseButton,
  closeLabel = "Close",
  bare,
  children,
}: ModalShellProps) {
  const panelRef = useDialogA11y({
    open: isOpen,
    onEscape: onClose,
    stopPropagationOnEscape: true,
  });

  // Scroll lock
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  const handleBackdrop = useCallback(() => {
    if (!disableBackdropClose) onClose();
  }, [disableBackdropClose, onClose]);

  if (!isOpen) return null;

  if (bare) {
    return createPortal(
      <div
        ref={panelRef}
        className={`fixed inset-0 ${zIndex}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabelledBy ? undefined : ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
        style={{ outline: "none" }}
        onClick={handleBackdrop}
      >
        {children}
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      className={`fixed inset-0 ${zIndex} flex items-center justify-center p-4 transition-all duration-300`}
      onClick={handleBackdrop}
      role="presentation"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabelledBy ? undefined : ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
        className={`w-full ${maxWidth} bg-white/95 dark:bg-black/90 backdrop-blur-xl rounded-3xl border border-white/20 dark:border-white/10 shadow-[0_0_50px_-12px_rgba(0,0,0,0.3)] p-8 relative overflow-hidden outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        {!hideCloseButton && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-6 right-6 p-2 text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-white/10"
            aria-label={closeLabel}
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {children}
      </div>
    </div>,
    document.body,
  );
}

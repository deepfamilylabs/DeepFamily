import React, { createContext, useCallback, useContext, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useDialogA11y } from "./useDialogA11y";
import { OVERLAY_Z_INDEX } from "./overlayLayers";
import { MODAL_CLOSE_BUTTON, MODAL_PANEL, MODAL_SCRIM } from "./modalTokens";

export interface ModalShellProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Called when the user dismisses (backdrop click, X button, Escape) */
  onClose: () => void;
  /** Maximum width utility class (default: "max-w-md"). Ignored when bare=true. */
  maxWidth?: string;
  /** z-index utility class (default: OVERLAY_Z_INDEX.modal) */
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
 * Nesting depth of the shell being rendered. Only the outermost one paints the
 * scrim: stacked shells would otherwise compound their backdrops (two 40%
 * layers read as 64% black, and the blur applies twice). Context follows the
 * React tree, not the DOM, so portalled children still see their parent shell.
 */
const ModalDepthContext = createContext(0);

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
  zIndex = OVERLAY_Z_INDEX.modal,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  disableBackdropClose,
  hideCloseButton,
  closeLabel = "Close",
  bare,
  children,
}: ModalShellProps) {
  const depth = useContext(ModalDepthContext);
  const isOutermost = depth === 0;

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
        {/* `bare` skips the default panel wrapper, not the scrim: an aria-modal
            dialog must still read as a layer over inert content. */}
        {isOutermost && (
          <div className={`${MODAL_SCRIM} animate-fade-in`} data-modal-scrim aria-hidden />
        )}
        {/* Positioned so children paint above the absolutely positioned scrim. */}
        <div className="relative h-full">
          <ModalDepthContext.Provider value={depth + 1}>{children}</ModalDepthContext.Provider>
        </div>
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
      {isOutermost && (
        <div className={`${MODAL_SCRIM} animate-fade-in`} data-modal-scrim aria-hidden />
      )}

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabelledBy ? undefined : ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
        className={`w-full ${maxWidth} ${MODAL_PANEL} p-6 relative overflow-hidden outline-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        {!hideCloseButton && (
          <button
            type="button"
            onClick={onClose}
            className={`absolute top-4 right-4 ${MODAL_CLOSE_BUTTON}`}
            aria-label={closeLabel}
          >
            <X className="w-[17px] h-[17px]" />
          </button>
        )}

        <ModalDepthContext.Provider value={depth + 1}>{children}</ModalDepthContext.Provider>
      </div>
    </div>,
    document.body,
  );
}

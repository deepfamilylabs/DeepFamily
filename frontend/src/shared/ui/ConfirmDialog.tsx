import { useEffect, useCallback, useId } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { ModalShell } from "./ModalShell";
import { OVERLAY_Z_INDEX } from "./overlayLayers";
import {
  MODAL_ACCENT_TILE,
  MODAL_CLOSE_BUTTON,
  MODAL_PANEL,
  MODAL_TILE_BASE,
  type ModalAccent,
} from "./modalTokens";

type ConfirmDialogType = "info" | "warning" | "danger" | "success";

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmBtnClassName?: string;
  type?: ConfirmDialogType;
}

const TYPE_ACCENT: Record<ConfirmDialogType, ModalAccent> = {
  info: "blue",
  warning: "primary",
  danger: "danger",
  success: "emerald",
};

const CONFIRM_BUTTON: Record<ConfirmDialogType, string> = {
  info: "bg-primary text-white hover:bg-primary-hover focus:ring-primary/40",
  warning: "bg-primary text-white hover:bg-primary-hover focus:ring-primary/40",
  danger: "bg-danger text-white dark:text-red-950 hover:opacity-90 focus:ring-danger/40",
  success: "bg-success text-white dark:text-green-950 hover:opacity-90 focus:ring-success/40",
};

/**
 * The `sm` shell (420px): a short confirmation or a blocking question. The icon
 * sits beside the copy rather than above it in a centered column, which is what
 * let confirmations drift to three different heights for the same amount of text.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  confirmBtnClassName,
  type = "info",
}: ConfirmDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    },
    [open, onConfirm],
  );
  useEffect(() => {
    if (!open) return;
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey, open]);
  if (!open) return null;

  const Icon =
    type === "danger"
      ? AlertCircle
      : type === "warning"
        ? AlertTriangle
        : type === "success"
          ? CheckCircle2
          : Info;

  return (
    <ModalShell
      isOpen={open}
      onClose={onCancel}
      bare
      zIndex={OVERLAY_Z_INDEX.confirmDialog}
      ariaLabel={title ? undefined : message}
      ariaLabelledBy={title ? titleId : undefined}
      ariaDescribedBy={messageId}
    >
      <div className="h-full flex items-center justify-center p-4">
        <div
          className={`relative w-[420px] max-w-[95vw] overflow-hidden ${MODAL_PANEL}`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex gap-3.5 p-5">
            <div className={`${MODAL_TILE_BASE} ${MODAL_ACCENT_TILE[TYPE_ACCENT[type]]}`}>
              <Icon className="w-[19px] h-[19px]" aria-hidden />
            </div>
            <div className="flex-1 min-w-0 space-y-1.5">
              {title ? (
                <h3 id={titleId} className="modal-heading font-body text-base font-semibold text-ink">
                  {title}
                </h3>
              ) : null}
              <div
                id={messageId}
                className="text-sm text-ink-muted whitespace-pre-line leading-relaxed"
              >
                {message}
              </div>
            </div>
            <button
              type="button"
              aria-label="Close"
              className={MODAL_CLOSE_BUTTON}
              onClick={onCancel}
            >
              <X className="w-[17px] h-[17px]" />
            </button>
          </div>
          <div className="flex gap-2.5 px-5 py-3.5 border-t border-hairline bg-surface-body">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 h-10 rounded-lg border border-hairline-strong bg-surface text-ink text-sm font-semibold transition-colors hover:bg-surface-alt focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            >
              {cancelText}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={
                "flex-1 h-10 rounded-lg text-sm font-semibold transition-colors focus:outline-hidden focus:ring-2 " +
                CONFIRM_BUTTON[type] +
                (confirmBtnClassName ? " " + confirmBtnClassName : "")
              }
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

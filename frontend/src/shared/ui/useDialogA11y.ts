import { useEffect, useRef } from "react";

const dialogFocusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getDialogFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(dialogFocusableSelector)).filter(
    (element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true",
  );
}

function isAnotherModalDialogActive(panel: HTMLElement | null) {
  const active = document.activeElement;
  if (!panel || !(active instanceof HTMLElement)) return false;
  const activeDialog = active.closest<HTMLElement>('[role="dialog"][aria-modal="true"]');
  return Boolean(activeDialog && activeDialog !== panel && !panel.contains(activeDialog));
}

export interface UseDialogA11yOptions {
  open: boolean;
  onEscape?: () => void;
  focusOnOpen?: boolean;
  restoreFocus?: boolean;
  trapFocus?: boolean;
  preventDefaultOnEscape?: boolean;
  stopPropagationOnEscape?: boolean;
}

export function useDialogA11y<T extends HTMLElement = HTMLDivElement>({
  open,
  onEscape,
  focusOnOpen = true,
  restoreFocus = true,
  trapFocus = true,
  preventDefaultOnEscape = true,
  stopPropagationOnEscape = false,
}: UseDialogA11yOptions) {
  const dialogRef = useRef<T | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const frameId = focusOnOpen
      ? window.requestAnimationFrame(() => dialogRef.current?.focus())
      : null;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isAnotherModalDialogActive(dialogRef.current)) return;

      if (event.key === "Escape") {
        if (preventDefaultOnEscape) event.preventDefault();
        if (stopPropagationOnEscape) event.stopPropagation();
        onEscapeRef.current?.();
        return;
      }

      if (!trapFocus || event.key !== "Tab") return;

      const panel = dialogRef.current;
      const focusableElements = getDialogFocusableElements(panel);
      if (focusableElements.length === 0) {
        event.preventDefault();
        panel?.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || active === panel || !panel?.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last || active === panel || !panel?.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      window.removeEventListener("keydown", handleKeyDown);

      const previousFocus = previousFocusRef.current;
      if (restoreFocus && previousFocus?.isConnected) {
        previousFocus.focus();
      }
      previousFocusRef.current = null;
    };
  }, [
    focusOnOpen,
    open,
    preventDefaultOnEscape,
    restoreFocus,
    stopPropagationOnEscape,
    trapFocus,
  ]);

  return dialogRef;
}

import { useCallback, useEffect, useRef } from "react";

type ModalHistoryMarker = {
  __dfModal: string;
  id: string;
};

export interface UseModalHistoryCloseOptions {
  isOpen: boolean;
  isDesktop: boolean;
  modalId: string;
  onRequestClose: () => void;
}

function createMarker(modalId: string): ModalHistoryMarker {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return { __dfModal: modalId, id };
}

function isSameMarker(value: unknown, marker: ModalHistoryMarker | null) {
  if (!marker || !value || typeof value !== "object") return false;
  const state = value as Partial<ModalHistoryMarker>;
  return state.__dfModal === marker.__dfModal && state.id === marker.id;
}

export function useModalHistoryClose({
  isOpen,
  isDesktop,
  modalId,
  onRequestClose,
}: UseModalHistoryCloseOptions) {
  const onRequestCloseRef = useRef(onRequestClose);
  const markerRef = useRef<ModalHistoryMarker | null>(null);
  const previousStateRef = useRef<unknown>(null);
  const pushedRef = useRef(false);
  const selfClosingRef = useRef(false);
  const closedByPopRef = useRef(false);
  const closeRequestedRef = useRef(false);

  useEffect(() => {
    onRequestCloseRef.current = onRequestClose;
  }, [onRequestClose]);

  useEffect(() => {
    if (!isOpen || isDesktop || typeof window === "undefined") return;

    const marker = createMarker(modalId);
    markerRef.current = marker;
    previousStateRef.current = window.history.state;
    pushedRef.current = false;
    selfClosingRef.current = false;
    closedByPopRef.current = false;
    closeRequestedRef.current = false;

    try {
      window.history.pushState(marker, "", window.location.href);
      pushedRef.current = true;
    } catch {}

    const handlePopState = () => {
      if (closeRequestedRef.current) return;
      if (isSameMarker(window.history.state, markerRef.current)) return;

      closedByPopRef.current = true;
      closeRequestedRef.current = true;
      onRequestCloseRef.current();
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);

      const markerToClean = markerRef.current;
      const isCurrentMarker = isSameMarker(window.history.state, markerToClean);

      if (pushedRef.current && markerToClean && !closedByPopRef.current) {
        if (selfClosingRef.current && isCurrentMarker) {
          try {
            window.history.back();
          } catch {}
        } else if (isCurrentMarker) {
          try {
            window.history.replaceState(previousStateRef.current, "", window.location.href);
          } catch {}
        }
      }

      markerRef.current = null;
      previousStateRef.current = null;
      pushedRef.current = false;
      selfClosingRef.current = false;
      closedByPopRef.current = false;
      closeRequestedRef.current = false;
    };
  }, [isDesktop, isOpen, modalId]);

  return useCallback(() => {
    selfClosingRef.current = true;
    closeRequestedRef.current = true;
    onRequestCloseRef.current();
  }, []);
}

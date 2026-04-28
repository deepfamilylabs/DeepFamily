import { useEffect, useState } from "react";
import { useModalHistoryClose } from "./useModalHistoryClose";

export interface UseTransactionModalFrameStateOptions {
  isOpen: boolean;
  isDesktop: boolean;
  modalId: string;
  onClose: () => void;
}

export function useTransactionModalFrameState({
  isOpen,
  isDesktop,
  modalId,
  onClose,
}: UseTransactionModalFrameStateOptions) {
  const [entered, setEntered] = useState(false);
  const requestClose = useModalHistoryClose({
    isOpen,
    isDesktop,
    modalId,
    onRequestClose: onClose,
  });

  useEffect(() => {
    if (!isOpen) {
      setEntered(false);
      return;
    }
    if (typeof window === "undefined") {
      setEntered(true);
      return;
    }

    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  return {
    entered,
    requestClose,
  };
}

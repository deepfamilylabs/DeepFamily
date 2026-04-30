import { useCallback, useEffect, useRef, useState } from "react";

export interface UseBottomSheetDragOptions {
  isOpen: boolean;
  onClose: () => void;
  closeThreshold?: number;
}

export function useBottomSheetDrag({
  isOpen,
  onClose,
  closeThreshold = 120,
}: UseBottomSheetDragOptions) {
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const startYRef = useRef<number | null>(null);

  const cancelDrag = useCallback(() => {
    startYRef.current = null;
    setDragging(false);
    setDragOffset(0);
  }, []);

  useEffect(() => {
    if (!isOpen) cancelDrag();
  }, [cancelDrag, isOpen]);

  const startDrag = useCallback((clientY: number) => {
    startYRef.current = clientY;
    setDragging(true);
  }, []);

  const updateDrag = useCallback(
    (clientY: number) => {
      if (!dragging || startYRef.current == null) return;
      setDragOffset(Math.max(0, clientY - startYRef.current));
    },
    [dragging],
  );

  const finishDrag = useCallback(() => {
    if (!dragging) return;
    const shouldClose = dragOffset > closeThreshold;
    cancelDrag();
    if (shouldClose) onClose();
  }, [cancelDrag, closeThreshold, dragOffset, dragging, onClose]);

  return {
    dragging,
    dragOffset,
    startDrag,
    updateDrag,
    finishDrag,
    cancelDrag,
  };
}

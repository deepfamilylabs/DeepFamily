import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Custody of the frozen wallet-bound package while it waits for a decision.
 *
 * The flow blocks on the promise handed out here, so every path that abandons
 * the flow — a newer package, a closed modal, an unmounted tree — has to resolve
 * it false rather than leave the flow hanging forever.
 */
export function useTransactionPreviewDecision<TPreview>() {
  const [transactionPreview, setTransactionPreview] = useState<TPreview | null>(null);
  const decisionRef = useRef<((approved: boolean) => void) | null>(null);

  const confirmTransactionPreview = useCallback(
    (preview: TPreview) =>
      new Promise<boolean>((resolve) => {
        // Only one wallet-bound package may await a decision at a time.
        decisionRef.current?.(false);
        decisionRef.current = resolve;
        setTransactionPreview(preview);
      }),
    [],
  );

  const decideTransactionPreview = useCallback((approved: boolean) => {
    const resolve = decisionRef.current;
    decisionRef.current = null;
    setTransactionPreview(null);
    resolve?.(approved);
  }, []);

  useEffect(
    () => () => {
      decisionRef.current?.(false);
      decisionRef.current = null;
    },
    [],
  );

  return { transactionPreview, confirmTransactionPreview, decideTransactionPreview };
}

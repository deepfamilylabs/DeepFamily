import { useEffect, useRef } from "react";

/**
 * Moves focus to a region the moment it appears.
 *
 * Terminal states in these modals — a pending decision, a result, an error —
 * render at the end of a long scrolling form, where neither a sighted user nor
 * a keyboard one would find them on their own once the submit button stopped
 * living next to them.
 */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    ref.current?.focus?.();
  }, []);

  return ref;
}

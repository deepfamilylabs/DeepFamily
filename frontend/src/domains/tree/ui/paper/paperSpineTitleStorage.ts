import type { NodeId } from "../../../../shared/model";

// Per-root persistence for the user's manual spine-title override. Keying on the rootId keeps each
// genealogy's custom spine title isolated, so switching roots never reuses another tree's title.
const PAPER_SPINE_TITLE_KEY_PREFIX = "df:paperSpineTitle:";

export function getPaperSpineTitleStorageKey(rootId: NodeId | string): string {
  return `${PAPER_SPINE_TITLE_KEY_PREFIX}${rootId}`;
}

// Returns the saved override for this root, or null when none is stored (so callers can fall back
// to the auto-generated title). An empty/whitespace value is never persisted (see save), so a
// non-null result is always a meaningful user override.
export function loadPaperSpineTitleOverride(rootId: NodeId | string | null): string | null {
  if (!rootId || typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(getPaperSpineTitleStorageKey(rootId));
  } catch {
    return null;
  }
}

// Persists the override for this root. A blank (whitespace-only) title clears the entry so the view
// reverts to the auto-generated spine title instead of storing an empty override.
export function savePaperSpineTitleOverride(
  rootId: NodeId | string | null,
  title: string,
): void {
  if (!rootId || typeof window === "undefined") return;
  try {
    const key = getPaperSpineTitleStorageKey(rootId);
    if (title.trim() === "") {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, title);
    }
  } catch {
    /* localStorage may be unavailable (private mode/quota); the override is best-effort. */
  }
}

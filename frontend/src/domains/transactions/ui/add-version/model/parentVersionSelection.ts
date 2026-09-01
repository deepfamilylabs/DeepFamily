import type { PersonVersionLookup } from "../../../hooks/usePersonVersionOptions";
import { preferredPersonVersion } from "../../../model/personVersionSelection";

export interface ParentVersionSelectionUpdate {
  /** The hash this index was decided for; null once the identity is cleared. */
  decidedForHash: string | null;
  versionIndex: number | "";
}

/**
 * Decides whether an arriving version lookup should move a parent's version
 * index, given the hash that index was last decided for.
 *
 * Returns null to leave the current selection untouched, which covers both a
 * lookup still in flight and a hash the user has already decided for.
 */
export function reconcileParentVersionSelection(
  lookup: PersonVersionLookup,
  decidedForHash: string | null,
): ParentVersionSelectionUpdate | null {
  if (!lookup.personHash) {
    // The identity was cleared; an index from the previous hash must not ride
    // along with whoever is entered next.
    return decidedForHash === null ? null : { decidedForHash: null, versionIndex: "" };
  }
  if (lookup.status !== "ready" || decidedForHash === lookup.personHash) return null;
  // Preselect the best-supported version rather than leaving the work to the
  // user. Unknown stays one click away for a contributor who does not accept
  // any recorded version.
  const versionIndex = preferredPersonVersion(lookup.versions)?.versionIndex ?? "";
  return { decidedForHash: lookup.personHash, versionIndex };
}

import type { PersonVersionLookup } from "../../transactions/hooks/usePersonVersionOptions";
import { preferredPersonVersion } from "../../transactions/model/personVersionSelection";

export interface RootVersionSelectionUpdate {
  decidedForHash: string;
  versionIndex: number;
}

/**
 * Decides whether an arriving version lookup should move the root's version
 * index, given the hash that index was last decided for.
 *
 * The root always carries an index — the form never stores 0 — so a hash with
 * no on-chain version leaves the current one alone: the field's note already
 * says the hash carries none, and whether to save it anyway is the user's call.
 */
export function reconcileRootVersionSelection(
  lookup: PersonVersionLookup,
  decidedForHash: string | null,
): RootVersionSelectionUpdate | null {
  if (!lookup.personHash || lookup.status !== "ready") return null;
  if (decidedForHash === lookup.personHash) return null;
  const preferred = preferredPersonVersion(lookup.versions);
  if (!preferred) return null;
  return { decidedForHash: lookup.personHash, versionIndex: preferred.versionIndex };
}

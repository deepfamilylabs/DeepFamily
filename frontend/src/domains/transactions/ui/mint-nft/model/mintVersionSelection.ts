import type { PersonVersionLookup } from "../../../hooks/usePersonVersionOptions";

export interface MintVersionSelectionUpdate {
  decidedForHash: string;
  versionIndex: number;
}

/**
 * Decides whether an arriving version lookup should move the mint target's
 * version index, given the hash that index was last decided for.
 *
 * Minting is only allowed on a version the caller already endorsed, so the
 * endorsed version is the only sensible preselection; the most endorsed one
 * would just land the user on a "not endorsed" target. With no endorsement the
 * choice stays open rather than guessing.
 */
export function reconcileMintVersionSelection(
  lookup: PersonVersionLookup,
  decidedForHash: string | null,
  endorsedVersionIndex: number,
): MintVersionSelectionUpdate | null {
  if (!lookup.personHash || lookup.status !== "ready") return null;
  if (decidedForHash === lookup.personHash) return null;
  const endorsed = lookup.versions.some(
    (version) => version.versionIndex === endorsedVersionIndex,
  );
  return {
    decidedForHash: lookup.personHash,
    versionIndex: endorsed ? endorsedVersionIndex : 0,
  };
}

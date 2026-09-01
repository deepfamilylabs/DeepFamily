import type { PersonVersionLookup } from "../../../hooks/usePersonVersionOptions";
import { preferredPersonVersion } from "../../../model/personVersionSelection";

export interface EndorseVersionSelectionUpdate {
  decidedForHash: string;
  versionIndex: number;
}

/**
 * Decides whether an arriving version lookup should move the endorsement
 * target's version index, given the hash that index was last decided for.
 *
 * Unlike a parent link, an endorsement has no "unknown" index to fall back to,
 * so a hash with no versions leaves the current index alone: the on-chain
 * target check already explains why it cannot be endorsed.
 */
export function reconcileEndorseVersionSelection(
  lookup: PersonVersionLookup,
  decidedForHash: string | null,
): EndorseVersionSelectionUpdate | null {
  if (!lookup.personHash || lookup.status !== "ready") return null;
  if (decidedForHash === lookup.personHash) return null;
  const preferred = preferredPersonVersion(lookup.versions);
  if (!preferred) return null;
  return { decidedForHash: lookup.personHash, versionIndex: preferred.versionIndex };
}

import type { PersonVersionOption } from "../hooks/usePersonVersionOptions";

/**
 * The version a contributor is most likely to mean: the one the community has
 * backed hardest. Ties fall to the earliest recorded version so the choice is
 * deterministic rather than dependent on page order.
 */
export function preferredPersonVersion(
  versions: PersonVersionOption[],
): PersonVersionOption | undefined {
  return versions.reduce<PersonVersionOption | undefined>((best, candidate) => {
    if (!best) return candidate;
    if (candidate.endorsementCount !== best.endorsementCount) {
      return candidate.endorsementCount > best.endorsementCount ? candidate : best;
    }
    return candidate.versionIndex < best.versionIndex ? candidate : best;
  }, undefined);
}

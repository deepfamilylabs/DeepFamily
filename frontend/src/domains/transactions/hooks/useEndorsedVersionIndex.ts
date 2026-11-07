import { useEffect, useState } from "react";

export interface EndorsedVersionLookup {
  personHash: string | null;
  versionIndex: number;
  status: "idle" | "loading" | "ready" | "error";
}

interface ScopedEndorsedVersionLookup extends EndorsedVersionLookup {
  address?: string | null;
  contract?: any;
}

/** Keeps an unanswered endorsement query distinct from an answered zero. */
export function useEndorsedVersionLookup(
  personHash: string | null,
  address?: string | null,
  contract?: any,
): EndorsedVersionLookup {
  const [lookup, setLookup] = useState<ScopedEndorsedVersionLookup>({
    personHash: null,
    versionIndex: 0,
    status: "idle",
  });
  const canLoad = Boolean(personHash && address && contract?.endorsedVersionIndex);

  useEffect(() => {
    const scope = { personHash, address, contract };
    if (!canLoad) {
      setLookup({ ...scope, versionIndex: 0, status: "idle" });
      return;
    }
    let cancelled = false;
    setLookup({ ...scope, versionIndex: 0, status: "loading" });
    void (async () => {
      try {
        const endorsed = await contract.endorsedVersionIndex(personHash, address);
        if (!cancelled) {
          setLookup({ ...scope, versionIndex: Number(endorsed) || 0, status: "ready" });
        }
      } catch {
        if (!cancelled) setLookup({ ...scope, versionIndex: 0, status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, canLoad, contract, personHash]);

  if (!canLoad) return { personHash, versionIndex: 0, status: "idle" };
  // Effects run after rendering: never expose the previous wallet or person's
  // completed query to a caller deciding the new target's initial version.
  if (
    lookup.personHash !== personHash ||
    lookup.address !== address ||
    lookup.contract !== contract
  ) {
    return { personHash, versionIndex: 0, status: "loading" };
  }
  return { personHash, versionIndex: lookup.versionIndex, status: lookup.status };
}

/**
 * The version of a person this wallet has endorsed, or 0 when none.
 *
 * Minting requires a prior endorsement from the caller, so this is the only
 * version a mint target picker can sensibly preselect.
 */
export function useEndorsedVersionIndex(
  personHash: string | null,
  address?: string | null,
  contract?: any,
): number {
  return useEndorsedVersionLookup(personHash, address, contract).versionIndex;
}

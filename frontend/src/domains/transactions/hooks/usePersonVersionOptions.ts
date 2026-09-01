import { useCallback, useEffect, useState } from "react";
import { usePersonGateway } from "../../person";

const ZERO_HASH = `0x${"0".repeat(64)}`;
const PAGE_LIMIT = 100;
/** Guards a runaway pager; a real person carries a handful of versions. */
const MAX_PAGES = 20;

export type PersonVersionLookupStatus = "idle" | "loading" | "ready" | "error";

export interface PersonVersionOption {
  versionIndex: number;
  endorsementCount: number;
  tokenId: number;
  addedBy: string;
  /** Unix seconds the version was recorded; 0 when unknown. */
  timestamp: number;
}

export interface PersonVersionLookup {
  /** The hash this lookup describes, whatever its status; null when no identity is entered. */
  personHash: string | null;
  status: PersonVersionLookupStatus;
  versions: PersonVersionOption[];
  totalVersions: number;
}

const IDLE_LOOKUP: PersonVersionLookup = {
  personHash: null,
  status: "idle",
  versions: [],
  totalVersions: 0,
};

function sameLookup(a: PersonVersionLookup, b: PersonVersionLookup): boolean {
  return (
    a.personHash === b.personHash &&
    a.status === b.status &&
    a.totalVersions === b.totalVersions &&
    a.versions.length === b.versions.length &&
    a.versions.every((version, index) => {
      const other = b.versions[index];
      return (
        version.versionIndex === other.versionIndex &&
        version.endorsementCount === other.endorsementCount &&
        version.tokenId === other.tokenId &&
        version.addedBy === other.addedBy &&
        version.timestamp === other.timestamp
      );
    })
  );
}

/**
 * Resolves the on-chain versions behind a person hash so a caller can offer
 * them as a choice instead of a free-typed index.
 *
 * An empty result is not necessarily an error: a hash derived from an identity
 * plus passphrase may simply not be on chain yet, or may belong to a different
 * passphrase than the one that recorded it.
 */
export function usePersonVersionOptions(personHash: string | null): PersonVersionLookup {
  const personGateway = usePersonGateway();
  const [lookup, setLookup] = useState<PersonVersionLookup>(IDLE_LOOKUP);
  const normalizedHash = personHash && personHash !== ZERO_HASH ? personHash : null;

  // Returning the previous value for an unchanged result keeps a caller that
  // rebuilds its gateway on every render from re-triggering this effect forever.
  const applyLookup = useCallback((next: PersonVersionLookup) => {
    setLookup((current) => (sameLookup(current, next) ? current : next));
  }, []);

  useEffect(() => {
    if (!normalizedHash) {
      applyLookup(IDLE_LOOKUP);
      return;
    }
    if (!personGateway) {
      applyLookup({ personHash: normalizedHash, status: "error", versions: [], totalVersions: 0 });
      return;
    }

    let cancelled = false;
    applyLookup({ personHash: normalizedHash, status: "loading", versions: [], totalVersions: 0 });

    void (async () => {
      try {
        const versions: PersonVersionOption[] = [];
        let offset = 0;
        let totalVersions = 0;
        for (let page = 0; page < MAX_PAGES; page++) {
          // Endorsement counts and mint state live in one call, submitter and
          // timestamp in the other; both page over the same window.
          const [endorsements, rows] = await Promise.all([
            personGateway.listVersionEndorsements(normalizedHash, offset, PAGE_LIMIT),
            personGateway.listPersonVersionsPage(normalizedHash, offset, PAGE_LIMIT),
          ]);
          const rowByIndex = new Map(rows.versions.map((row) => [row.versionIndex, row]));
          totalVersions = endorsements.totalVersions;
          endorsements.versionIndices.forEach((versionIndex, index) => {
            const row = rowByIndex.get(versionIndex);
            versions.push({
              versionIndex,
              endorsementCount: endorsements.endorsementCounts[index] ?? 0,
              tokenId: endorsements.tokenIds[index] ?? 0,
              addedBy: row?.addedBy ?? "",
              timestamp: row?.timestamp ?? 0,
            });
          });
          if (!endorsements.hasMore || endorsements.nextOffset === offset) break;
          offset = endorsements.nextOffset;
        }
        if (cancelled) return;
        applyLookup({ personHash: normalizedHash, status: "ready", versions, totalVersions });
      } catch {
        if (cancelled) return;
        applyLookup({ personHash: normalizedHash, status: "error", versions: [], totalVersions: 0 });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyLookup, normalizedHash, personGateway]);

  return lookup;
}

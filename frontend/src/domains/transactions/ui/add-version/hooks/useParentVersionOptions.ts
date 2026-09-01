import { useEffect, useState } from "react";
import { usePersonGateway } from "../../../../person";

const ZERO_HASH = `0x${"0".repeat(64)}`;
const PAGE_LIMIT = 100;
/** Guards a runaway pager; a real person carries a handful of versions. */
const MAX_PAGES = 20;

export type ParentVersionLookupStatus = "idle" | "loading" | "ready" | "error";

export interface ParentVersionOption {
  versionIndex: number;
  endorsementCount: number;
  tokenId: number;
}

export interface ParentVersionLookup {
  /** The hash this lookup describes, whatever its status; null when no identity is entered. */
  personHash: string | null;
  status: ParentVersionLookupStatus;
  versions: ParentVersionOption[];
  totalVersions: number;
}

const IDLE_LOOKUP: ParentVersionLookup = {
  personHash: null,
  status: "idle",
  versions: [],
  totalVersions: 0,
};

/**
 * Resolves the on-chain versions of a parent hash so the caller can offer them
 * as a choice instead of a free-typed index.
 *
 * The hash is derived from the parent's identity *and* passphrase, so an empty
 * result means either "not on chain yet" or "a different passphrase than the
 * one that recorded them". Both are legitimate, and both leave the submission
 * at index 0, which the contract always accepts.
 */
export function useParentVersionOptions(personHash: string | null): ParentVersionLookup {
  const personGateway = usePersonGateway();
  const [lookup, setLookup] = useState<ParentVersionLookup>(IDLE_LOOKUP);
  const normalizedHash = personHash && personHash !== ZERO_HASH ? personHash : null;

  useEffect(() => {
    if (!normalizedHash) {
      setLookup(IDLE_LOOKUP);
      return;
    }
    if (!personGateway) {
      setLookup({ personHash: normalizedHash, status: "error", versions: [], totalVersions: 0 });
      return;
    }

    let cancelled = false;
    setLookup({ personHash: normalizedHash, status: "loading", versions: [], totalVersions: 0 });

    void (async () => {
      try {
        const versions: ParentVersionOption[] = [];
        let offset = 0;
        let totalVersions = 0;
        for (let page = 0; page < MAX_PAGES; page++) {
          const out = await personGateway.listVersionEndorsements(
            normalizedHash,
            offset,
            PAGE_LIMIT,
          );
          totalVersions = out.totalVersions;
          out.versionIndices.forEach((versionIndex, index) => {
            versions.push({
              versionIndex,
              endorsementCount: out.endorsementCounts[index] ?? 0,
              tokenId: out.tokenIds[index] ?? 0,
            });
          });
          if (!out.hasMore || out.nextOffset === offset) break;
          offset = out.nextOffset;
        }
        if (cancelled) return;
        setLookup({ personHash: normalizedHash, status: "ready", versions, totalVersions });
      } catch {
        if (cancelled) return;
        setLookup({ personHash: normalizedHash, status: "error", versions: [], totalVersions: 0 });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [normalizedHash, personGateway]);

  return lookup;
}

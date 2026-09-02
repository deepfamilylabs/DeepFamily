import { describe, expect, it } from "vitest";
import type { PersonVersionLookup } from "../../transactions/hooks/usePersonVersionOptions";
import { reconcileRootVersionSelection } from "./rootVersionSelection";

const HASH = `0x${"a".repeat(64)}`;
const OTHER_HASH = `0x${"b".repeat(64)}`;

function lookup(overrides: Partial<PersonVersionLookup> = {}): PersonVersionLookup {
  return {
    personHash: HASH,
    status: "ready",
    versions: [],
    totalVersions: 0,
    ...overrides,
  };
}

function version(versionIndex: number, endorsementCount = 0, tokenId = 0) {
  return { versionIndex, endorsementCount, tokenId, addedBy: "0xabc", timestamp: 1 };
}

describe("reconcileRootVersionSelection", () => {
  it("preselects the most endorsed version of a newly entered hash", () => {
    expect(
      reconcileRootVersionSelection(
        lookup({ versions: [version(1, 2), version(2, 9), version(3, 4)], totalVersions: 3 }),
        null,
      ),
    ).toEqual({ decidedForHash: HASH, versionIndex: 2 });
  });

  it("breaks an endorsement tie on the earliest version", () => {
    expect(
      reconcileRootVersionSelection(
        lookup({ versions: [version(3, 1), version(2, 1)], totalVersions: 2 }),
        null,
      ),
    ).toEqual({ decidedForHash: HASH, versionIndex: 2 });
  });

  it("keeps the saved index when the hash carries no version", () => {
    expect(reconcileRootVersionSelection(lookup(), null)).toBeNull();
  });

  it("never overrules a hash already decided for", () => {
    expect(
      reconcileRootVersionSelection(lookup({ versions: [version(2, 5)], totalVersions: 1 }), HASH),
    ).toBeNull();
  });

  it("holds the current index while the lookup is unresolved", () => {
    for (const status of ["idle", "loading", "error"] as const) {
      expect(
        reconcileRootVersionSelection(
          lookup({ status, versions: [version(2, 5)], totalVersions: 1 }),
          null,
        ),
      ).toBeNull();
    }
  });

  it("re-decides when the typed hash changes", () => {
    expect(
      reconcileRootVersionSelection(
        lookup({ personHash: OTHER_HASH, versions: [version(4, 3)], totalVersions: 1 }),
        HASH,
      ),
    ).toEqual({ decidedForHash: OTHER_HASH, versionIndex: 4 });
  });
});

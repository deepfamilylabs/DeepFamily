import { describe, expect, it } from "vitest";
import type { PersonVersionLookup } from "../../../hooks/usePersonVersionOptions";
import { reconcileEndorseVersionSelection } from "./endorseVersionSelection";

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

describe("reconcileEndorseVersionSelection", () => {
  it("preselects the most endorsed version", () => {
    expect(
      reconcileEndorseVersionSelection(
        lookup({ versions: [version(1, 2), version(2, 9), version(3, 4)], totalVersions: 3 }),
        null,
      ),
    ).toEqual({ decidedForHash: HASH, versionIndex: 2 });
  });

  it("breaks an endorsement tie on the earliest version", () => {
    expect(
      reconcileEndorseVersionSelection(
        lookup({ versions: [version(3, 1), version(2, 1)], totalVersions: 2 }),
        null,
      ),
    ).toEqual({ decidedForHash: HASH, versionIndex: 2 });
  });

  it("leaves the typed index alone when the hash has no versions", () => {
    expect(reconcileEndorseVersionSelection(lookup(), null)).toBeNull();
  });

  it("never overrules a hash already decided for", () => {
    expect(
      reconcileEndorseVersionSelection(
        lookup({ versions: [version(2, 5)], totalVersions: 1 }),
        HASH,
      ),
    ).toBeNull();
  });

  it("holds the current index while the lookup is unresolved", () => {
    for (const status of ["idle", "loading", "error"] as const) {
      expect(
        reconcileEndorseVersionSelection(
          lookup({ status, versions: [version(2, 5)], totalVersions: 1 }),
          null,
        ),
      ).toBeNull();
    }
  });

  it("re-decides when the hash changes", () => {
    expect(
      reconcileEndorseVersionSelection(
        lookup({ personHash: OTHER_HASH, versions: [version(4, 3)], totalVersions: 1 }),
        HASH,
      ),
    ).toEqual({ decidedForHash: OTHER_HASH, versionIndex: 4 });
  });
});

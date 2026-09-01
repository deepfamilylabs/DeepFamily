import { describe, expect, it } from "vitest";
import type { PersonVersionLookup } from "../../../hooks/usePersonVersionOptions";
import { reconcileParentVersionSelection } from "./parentVersionSelection";

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

describe("reconcileParentVersionSelection", () => {
  it("preselects the only on-chain version", () => {
    expect(
      reconcileParentVersionSelection(lookup({ versions: [version(1)], totalVersions: 1 }), null),
    ).toEqual({ decidedForHash: HASH, versionIndex: 1 });
  });

  it("preselects the most endorsed version when several exist", () => {
    expect(
      reconcileParentVersionSelection(
        lookup({
          versions: [version(1, 2), version(2, 7), version(3, 5)],
          totalVersions: 3,
        }),
        null,
      ),
    ).toEqual({ decidedForHash: HASH, versionIndex: 2 });
  });

  it("breaks an endorsement tie on the earliest version", () => {
    expect(
      reconcileParentVersionSelection(
        lookup({ versions: [version(2, 4), version(1, 4)], totalVersions: 2 }),
        null,
      ),
    ).toEqual({ decidedForHash: HASH, versionIndex: 1 });
  });

  it("leaves the choice unknown when the parent is not on chain", () => {
    expect(reconcileParentVersionSelection(lookup(), null)).toEqual({
      decidedForHash: HASH,
      versionIndex: "",
    });
  });

  it("never overrules a hash already decided for, so unknown can be kept over a recorded version", () => {
    expect(
      reconcileParentVersionSelection(lookup({ versions: [version(1)], totalVersions: 1 }), HASH),
    ).toBeNull();
  });

  it("holds the current selection while the lookup is unresolved", () => {
    for (const status of ["idle", "loading", "error"] as const) {
      expect(reconcileParentVersionSelection(lookup({ status }), null)).toBeNull();
    }
  });

  it("re-decides when the identity changes to another hash", () => {
    expect(
      reconcileParentVersionSelection(
        lookup({ personHash: OTHER_HASH, versions: [version(1)], totalVersions: 1 }),
        HASH,
      ),
    ).toEqual({ decidedForHash: OTHER_HASH, versionIndex: 1 });
  });

  it("clears a decided index once the identity is cleared", () => {
    expect(reconcileParentVersionSelection(lookup({ personHash: null }), HASH)).toEqual({
      decidedForHash: null,
      versionIndex: "",
    });
  });

  it("stays quiet when there is nothing to clear", () => {
    expect(
      reconcileParentVersionSelection(lookup({ personHash: null, status: "idle" }), null),
    ).toBeNull();
  });
});

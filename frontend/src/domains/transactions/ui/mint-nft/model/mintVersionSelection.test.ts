import { describe, expect, it } from "vitest";
import type { PersonVersionLookup } from "../../../hooks/usePersonVersionOptions";
import { reconcileMintVersionSelection } from "./mintVersionSelection";

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

describe("reconcileMintVersionSelection", () => {
  it("preselects the version this wallet endorsed, not the most endorsed one", () => {
    expect(
      reconcileMintVersionSelection(
        lookup({ versions: [version(1, 9), version(2, 1)], totalVersions: 2 }),
        null,
        2,
      ),
    ).toEqual({ decidedForHash: HASH, versionIndex: 2 });
  });

  it("waits for the endorsement query when the version list arrives first", () => {
    const readyLookup = lookup({ versions: [version(1, 9), version(2, 1)], totalVersions: 2 });
    const waiting = reconcileMintVersionSelection(readyLookup, null, 0, false);
    expect(waiting).toBeNull();
    expect(reconcileMintVersionSelection(readyLookup, waiting?.decidedForHash ?? null, 2, true))
      .toEqual({ decidedForHash: HASH, versionIndex: 2 });
  });

  it("keeps an explicit selection when the pending endorsement query finishes", () => {
    const readyLookup = lookup({ versions: [version(1, 9), version(2, 1)], totalVersions: 2 });
    expect(reconcileMintVersionSelection(readyLookup, HASH, 0, false)).toBeNull();
    expect(reconcileMintVersionSelection(readyLookup, HASH, 2, true)).toBeNull();
  });

  it("leaves the choice open when the wallet endorsed nothing", () => {
    expect(
      reconcileMintVersionSelection(
        lookup({ versions: [version(1, 9)], totalVersions: 1 }),
        null,
        0,
      ),
    ).toEqual({ decidedForHash: HASH, versionIndex: 0 });
  });

  it("leaves the choice open when the endorsed version is not in the list", () => {
    expect(
      reconcileMintVersionSelection(
        lookup({ versions: [version(1, 9)], totalVersions: 1 }),
        null,
        7,
      ),
    ).toEqual({ decidedForHash: HASH, versionIndex: 0 });
  });

  it("never overrules a hash already decided for", () => {
    expect(
      reconcileMintVersionSelection(
        lookup({ versions: [version(2, 1)], totalVersions: 1 }),
        HASH,
        2,
      ),
    ).toBeNull();
  });

  it("holds the current index while the lookup is unresolved", () => {
    for (const status of ["idle", "loading", "error"] as const) {
      expect(
        reconcileMintVersionSelection(
          lookup({ status, versions: [version(2, 1)], totalVersions: 1 }),
          null,
          2,
        ),
      ).toBeNull();
    }
  });

  it("re-decides when the hash changes", () => {
    expect(
      reconcileMintVersionSelection(
        lookup({ personHash: OTHER_HASH, versions: [version(3, 1)], totalVersions: 1 }),
        HASH,
        3,
      ),
    ).toEqual({ decidedForHash: OTHER_HASH, versionIndex: 3 });
  });
});

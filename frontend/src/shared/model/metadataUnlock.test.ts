import { describe, expect, it } from "vitest";

import type { NodeData } from "./graph";
import {
  clearAllMetadataUnlocks,
  clearMetadataUnlock,
  isMetadataUnlockUsable,
  mergeValidatedMetadataUnlock,
  METADATA_CACHE_PROTOCOL_GENERATION,
  sanitizeHydratedMetadataUnlocks,
  rebaseValidatedMetadataUnlock,
  type MetadataUnlockAnchors,
} from "./metadataUnlock";

const anchors: MetadataUnlockAnchors = {
  personHash: `0x${"11".repeat(32)}`,
  versionIndex: 1,
  versionCommitment: "123",
  metadataPointer: `0x${"22".repeat(20)}`,
  metadataPayloadHash: `0x${"33".repeat(32)}`,
  metadataPayloadLength: 512,
};

const node: NodeData = {
  id: `${anchors.personHash}-v-1`,
  ...anchors,
};

const unlocked = {
  person: {
    fullName: "Alice",
    gender: 2,
    birthYear: 1980,
    birthMonth: 1,
    birthDay: 2,
    isBirthBC: false,
    personHash: anchors.personHash,
  },
  parents: { father: null, mother: null },
  tag: "",
  biography: "",
  formatVersion: 1,
  identitySuiteId: 1,
};

describe("validated NodeData metadata cache", () => {
  it("uses an explicit validated marker even when tag and biography are empty", () => {
    const merged = mergeValidatedMetadataUnlock(node, anchors, unlocked);

    expect(isMetadataUnlockUsable(merged)).toBe(true);
    expect(merged.tag).toBe("");
    expect(merged.biography).toBe("");
    expect(merged.metadataProtocolGeneration).toBe(METADATA_CACHE_PROTOCOL_GENERATION);
  });

  it("rejects plaintext whose public anchors do not match", () => {
    expect(() =>
      mergeValidatedMetadataUnlock(
        node,
        { ...anchors, metadataPayloadHash: `0x${"44".repeat(32)}` },
        unlocked,
      ),
    ).toThrow(/public anchors/);
  });

  it("clears decrypted fields without deleting public anchors", () => {
    const cleared = clearMetadataUnlock(mergeValidatedMetadataUnlock(node, anchors, unlocked));

    expect(isMetadataUnlockUsable(cleared)).toBe(false);
    expect(cleared.tag).toBeUndefined();
    expect(cleared.biography).toBeUndefined();
    expect(cleared.metadataPayloadHash).toBe(anchors.metadataPayloadHash);
    expect(cleared.versionCommitment).toBe(anchors.versionCommitment);
  });

  it("removes stale plaintext even when an older cache already marked it invalid", () => {
    const stale = {
      ...mergeValidatedMetadataUnlock(node, anchors, unlocked),
      metadataUnlockValidated: false,
    };

    const cleared = clearAllMetadataUnlocks({ [stale.id]: stale })[stale.id];

    expect(cleared.metadataUnlockValidated).toBe(false);
    expect(cleared.tag).toBeUndefined();
    expect(cleared.biography).toBeUndefined();
    expect(cleared.metadataPerson).toBeUndefined();
    expect(cleared.metadataParents).toBeUndefined();
  });

  it("sanitizes stale IndexedDB nodes while preserving complete validated unlocks", () => {
    const valid = mergeValidatedMetadataUnlock(node, anchors, unlocked);
    const stale = { ...valid, metadataUnlockValidated: false };
    const hydrated = sanitizeHydratedMetadataUnlocks({ valid, stale });

    expect(isMetadataUnlockUsable(hydrated.valid)).toBe(true);
    expect(hydrated.valid.tag).toBe("");
    expect(hydrated.stale.metadataUnlockValidated).toBe(false);
    expect(hydrated.stale.tag).toBeUndefined();
    expect(hydrated.stale.biography).toBeUndefined();
    expect(hydrated.stale.metadataPerson).toBeUndefined();
  });

  it("leaves ordinary public-only cached nodes untouched", () => {
    const publicOnly: NodeData = {
      id: "public-v-1",
      personHash: anchors.personHash,
      versionIndex: 1,
      tokenId: "1",
      fullName: "Public NFT name",
    };

    const hydrated = sanitizeHydratedMetadataUnlocks({ publicOnly });
    expect(hydrated.publicOnly).toBe(publicOnly);
    expect(hydrated.publicOnly.metadataUnlockValidated).toBeUndefined();
    expect(hydrated.publicOnly.fullName).toBe("Public NFT name");
  });

  it("rejects and sanitizes marker-only or structurally invalid unlock caches", () => {
    const valid = mergeValidatedMetadataUnlock(node, anchors, unlocked);
    const invalidEntries: Record<string, NodeData> = {
      missingFormat: { ...valid, metadataFormatVersion: undefined },
      missingSuite: { ...valid, identitySuiteId: undefined },
      zeroPayload: { ...valid, metadataPayloadLength: 0 },
      zeroVersion: { ...valid, versionIndex: 0 },
      malformedPersonHash: { ...valid, personHash: "0x1234" },
      malformedPointer: { ...valid, metadataPointer: "0x1234" },
      malformedPayloadHash: { ...valid, metadataPayloadHash: "0x1234" },
      wrongPerson: {
        ...valid,
        metadataPerson: { ...valid.metadataPerson!, personHash: `0x${"44".repeat(32)}` },
      },
    };

    for (const value of Object.values(invalidEntries)) {
      expect(isMetadataUnlockUsable(value)).toBe(false);
    }

    const hydrated = sanitizeHydratedMetadataUnlocks(invalidEntries);
    for (const value of Object.values(hydrated)) {
      expect(value.metadataUnlockValidated).toBe(false);
      expect(value.tag).toBeUndefined();
      expect(value.biography).toBeUndefined();
      expect(value.metadataPerson).toBeUndefined();
    }
  });

  it("refuses to rebase an incomplete cache even when its marker is true", () => {
    const incomplete = {
      ...mergeValidatedMetadataUnlock(node, anchors, unlocked),
      identitySuiteId: undefined,
    };

    expect(() => rebaseValidatedMetadataUnlock(node, incomplete)).toThrow(/fully validated/);
  });
});

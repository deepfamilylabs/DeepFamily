import { describe, expect, it } from "vitest";

import type { NodeData } from "./graph";
import {
  clearMetadataUnlock,
  isMetadataUnlockUsable,
  mergeValidatedMetadataUnlock,
  METADATA_CACHE_PROTOCOL_GENERATION,
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
      mergeValidatedMetadataUnlock(node, { ...anchors, metadataPayloadHash: `0x${"44".repeat(32)}` }, unlocked),
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
});

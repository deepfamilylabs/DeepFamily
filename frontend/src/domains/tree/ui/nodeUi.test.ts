import { describe, expect, it } from "vitest";

import type { NodeData } from "../../../shared/model";
import { getNodeUi } from "./nodeUi";

const id = "0xabc-v-1";

function staleNode(tokenId = "0"): NodeData {
  return {
    id,
    personHash: "0xabc",
    versionIndex: 1,
    tokenId,
    fullName: "Cached private name",
    tag: "cached private tag",
    biography: "cached private biography",
    metadataUnlockValidated: false,
  };
}

describe("getNodeUi metadata visibility", () => {
  it("does not expose stale decrypted fields from an invalid local cache entry", () => {
    const ui = getNodeUi(id, { [id]: staleNode() });

    expect(ui.fullName).toBeUndefined();
    expect(ui.tagText).toBeUndefined();
    expect(ui.titleText).toContain("0xabc");
  });

  it("keeps independently public NFT core fields but never exposes an invalid private tag", () => {
    const ui = getNodeUi(id, { [id]: staleNode("42") });

    expect(ui.fullName).toBe("Cached private name");
    expect(ui.tagText).toBeUndefined();
  });

  it("does not display a marker-only cache missing frozen format or suite evidence", () => {
    const personHash = `0x${"11".repeat(32)}`;
    const completeId = `${personHash}-v-1`;
    const markerOnly: NodeData = {
      id: completeId,
      personHash,
      versionIndex: 1,
      versionCommitment: "123",
      metadataPointer: `0x${"22".repeat(20)}`,
      metadataPayloadHash: `0x${"33".repeat(32)}`,
      metadataPayloadLength: 256,
      metadataUnlockValidated: true,
      metadataProtocolGeneration: "df-onchain-biography-v1",
      metadataPerson: {
        fullName: "Private Alice",
        gender: 2,
        birthYear: 1980,
        birthMonth: 1,
        birthDay: 2,
        isBirthBC: false,
        personHash,
      },
      metadataParents: { father: null, mother: null },
      fullName: "Private Alice",
      tag: "private tag",
      biography: "private biography",
      tokenId: "0",
    };

    const ui = getNodeUi(completeId, { [completeId]: markerOnly });
    expect(ui.fullName).toBeUndefined();
    expect(ui.tagText).toBeUndefined();
  });
});

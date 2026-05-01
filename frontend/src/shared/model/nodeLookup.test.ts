import { describe, expect, it } from "vitest";
import { findNodeByTokenId, findNodeEntryByTokenId, findNodeIdByTokenId } from "./nodeLookup";

const nodesData = {
  "0xaaa-v-1": {
    personHash: "0xaaa",
    versionIndex: 1,
    id: "0xaaa-v-1",
    tokenId: "42",
    fullName: "Alice",
  },
  "0xbbb-v-2": {
    personHash: "0xbbb",
    versionIndex: 2,
    id: "0xbbb-v-2",
    tokenId: "99",
    fullName: "Bob",
  },
};

describe("nodeLookup", () => {
  it("finds entry by token id", () => {
    const out = findNodeEntryByTokenId(nodesData, "42");
    expect(out?.[0]).toBe("0xaaa-v-1");
    expect(out?.[1].fullName).toBe("Alice");
  });

  it("finds id and node by token id", () => {
    expect(findNodeIdByTokenId(nodesData, "99")).toBe("0xbbb-v-2");
    expect(findNodeByTokenId(nodesData, "99")?.fullName).toBe("Bob");
  });

  it("returns undefined when token id is missing", () => {
    expect(findNodeEntryByTokenId(nodesData, "100")).toBeUndefined();
    expect(findNodeIdByTokenId(nodesData, "100")).toBeUndefined();
    expect(findNodeByTokenId(nodesData, "100")).toBeUndefined();
  });
});

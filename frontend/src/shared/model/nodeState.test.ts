import { describe, expect, it } from "vitest";
import { applySingleNodePatch, bumpNodeEndorsementCount, upsertNode } from "./nodeState";

describe("nodeState", () => {
  it("applies a single-node patch when the node exists", () => {
    const next = applySingleNodePatch(
      {
        "0xabc-v-1": {
          personHash: "0xabc",
          versionIndex: 1,
          id: "0xabc-v-1",
          fullName: "Alice",
        },
      },
      "0xabc-v-1",
      { owner: "0xowner" },
    );

    expect(next["0xabc-v-1"]).toMatchObject({ fullName: "Alice", owner: "0xowner" });
  });

  it("upserts nodes and bumps endorsement count", () => {
    const upserted = upsertNode(
      {},
      {
        personHash: "0xabc",
        versionIndex: 1,
        id: "0xabc-v-1",
        tokenId: "42",
      },
    );
    expect(upserted["0xabc-v-1"]?.tokenId).toBe("42");

    const bumped = bumpNodeEndorsementCount(upserted, "0xabc", 1, 2);
    expect(bumped["0xabc-v-1"]?.endorsementCount).toBe(2);

    const created = bumpNodeEndorsementCount({}, "0xdef", 3, 1);
    expect(created["0xdef-v-3"]).toMatchObject({
      personHash: "0xdef",
      versionIndex: 3,
      endorsementCount: 1,
    });
  });
});

import { describe, expect, it } from "vitest";
import { computeStoryHash } from "../story";

describe("story", () => {
  it("computes a stable story hash independent of chunk order", () => {
    const chunkA = {
      chunkIndex: 1,
      chunkHash: "0x" + "11".repeat(32),
    };
    const chunkB = {
      chunkIndex: 0,
      chunkHash: "0x" + "22".repeat(32),
    };

    const hash1 = computeStoryHash([chunkA as any, chunkB as any]);
    const hash2 = computeStoryHash([chunkB as any, chunkA as any]);

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe("0x" + "00".repeat(32));
  });
});

import { ethers } from "ethers";
import { describe, expect, it } from "vitest";
import { computeStoryRecordsHead } from "./story";

describe("story", () => {
  it("computes a stable story hash independent of record order", () => {
    const recordA = {
      recordIndex: 1,
      recordHash: ethers.id("record A"),
      payloadHash: "0x" + "11".repeat(32),
    };
    const recordB = {
      recordIndex: 0,
      recordHash: ethers.id("record B"),
      payloadHash: "0x" + "22".repeat(32),
    };

    const hash1 = computeStoryRecordsHead([recordA as any, recordB as any]);
    const hash2 = computeStoryRecordsHead([recordB as any, recordA as any]);

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe("0x" + "00".repeat(32));
  });
});

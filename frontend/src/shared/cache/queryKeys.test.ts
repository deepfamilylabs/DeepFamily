import { describe, it, expect } from "vitest";
import {
  parseVdKey,
  trustedEndorsementVisibilityKey,
  trustedEndorsersKey,
  tvKey,
  vdKey,
} from "./queryKeys";

describe("queryKeys", () => {
  it("normalizes hash keys", () => {
    expect(tvKey("0xAbC")).toBe("tv:0xabc");
    expect(vdKey("0xAbC", 2)).toBe("vd:0xabc:2");
    expect(trustedEndorsersKey("0xAbC", 2)).toBe("te:0xabc:2");
    expect(trustedEndorsementVisibilityKey("0xAbC", 2, ["0xDeF"])).toBe("tev:0xabc:2:0xdef");
  });

  it("parses vd keys", () => {
    expect(parseVdKey("vd:0xabc:2")).toEqual({ hashLower: "0xabc", versionIndex: 2 });
    expect(parseVdKey("tv:0xabc")).toBeNull();
    expect(parseVdKey("vd:0xabc:-1")).toBeNull();
  });
});

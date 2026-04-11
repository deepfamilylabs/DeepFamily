import { describe, it, expect } from "vitest";
import { parseVdKey, tvKey, vdKey } from "./queryKeys";

describe("queryKeys", () => {
  it("normalizes hash keys", () => {
    expect(tvKey("0xAbC")).toBe("tv:0xabc");
    expect(vdKey("0xAbC", 2)).toBe("vd:0xabc:2");
  });

  it("parses vd keys", () => {
    expect(parseVdKey("vd:0xabc:2")).toEqual({ hashLower: "0xabc", versionIndex: 2 });
    expect(parseVdKey("tv:0xabc")).toBeNull();
    expect(parseVdKey("vd:0xabc:-1")).toBeNull();
  });
});

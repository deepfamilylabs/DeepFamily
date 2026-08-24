import { describe, expect, it } from "vitest";
import { addVersionSchema } from "./addVersionSchema";

const input = (tag: string, biography = "") => ({
  fatherVersionIndex: "" as const,
  motherVersionIndex: "" as const,
  tag,
  biography,
});

describe("addVersionSchema", () => {
  it("accepts an exact 256-byte UTF-8 tag and rejects 257 bytes", () => {
    const exactLimit = "é".repeat(128);
    expect(new TextEncoder().encode(exactLimit)).toHaveLength(256);
    expect(addVersionSchema.safeParse(input(exactLimit)).success).toBe(true);

    const overLimit = `${exactLimit}a`;
    expect(new TextEncoder().encode(overLimit)).toHaveLength(257);
    expect(addVersionSchema.safeParse(input(overLimit)).success).toBe(false);
  });

  it("preserves empty and multiline Unicode private content", () => {
    expect(addVersionSchema.parse(input("", ""))).toMatchObject({ tag: "", biography: "" });
    expect(addVersionSchema.parse(input("版本\n标签", "第一行\n第二行 😀"))).toMatchObject({
      tag: "版本\n标签",
      biography: "第一行\n第二行 😀",
    });
  });
});

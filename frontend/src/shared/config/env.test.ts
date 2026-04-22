import { describe, expect, it } from "vitest";
import { readBooleanEnv, readListEnv, readNumberEnv, readPositiveNumberEnv } from "./env";

describe("readBooleanEnv", () => {
  it("treats explicit true-like values as enabled", () => {
    expect(readBooleanEnv(true)).toBe(true);
    expect(readBooleanEnv("true")).toBe(true);
    expect(readBooleanEnv("TRUE")).toBe(true);
    expect(readBooleanEnv(" 1 ")).toBe(true);
    expect(readBooleanEnv("yes")).toBe(true);
  });

  it("treats missing and non-true-like values as disabled", () => {
    expect(readBooleanEnv(undefined)).toBe(false);
    expect(readBooleanEnv(false)).toBe(false);
    expect(readBooleanEnv("false")).toBe(false);
    expect(readBooleanEnv("0")).toBe(false);
    expect(readBooleanEnv("")).toBe(false);
  });

  it("supports explicit default values", () => {
    expect(readBooleanEnv(undefined, true)).toBe(true);
    expect(readBooleanEnv("unexpected", true)).toBe(true);
    expect(readBooleanEnv("no", true)).toBe(false);
  });
});

describe("number env readers", () => {
  it("falls back for empty and invalid values", () => {
    expect(readNumberEnv("", 10)).toBe(10);
    expect(readNumberEnv("abc", 10)).toBe(10);
    expect(readNumberEnv("42", 10)).toBe(42);
  });

  it("requires positive values when requested", () => {
    expect(readPositiveNumberEnv("0", 10)).toBe(10);
    expect(readPositiveNumberEnv("-1", 10)).toBe(10);
    expect(readPositiveNumberEnv("42", 10)).toBe(42);
  });
});

describe("readListEnv", () => {
  it("splits comma and whitespace separated values", () => {
    expect(readListEnv("https://a.example/ipfs/, https://b.example/ipfs/ https://c.example/ipfs/")).toEqual([
      "https://a.example/ipfs/",
      "https://b.example/ipfs/",
      "https://c.example/ipfs/",
    ]);
  });
});

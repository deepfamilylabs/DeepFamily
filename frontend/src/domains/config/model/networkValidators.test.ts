import { describe, expect, it } from "vitest";
import { isAddress, isHash32, isUrl } from "./networkValidators";

describe("networkValidators", () => {
  describe("isAddress", () => {
    it("accepts a valid 20-byte hex address with 0x prefix", () => {
      expect(isAddress("0x1234567890abcdef1234567890ABCDEF12345678")).toBe(true);
    });
    it("trims whitespace before validating", () => {
      expect(isAddress("  0x1234567890abcdef1234567890ABCDEF12345678  ")).toBe(true);
    });
    it("rejects an address that is too short", () => {
      expect(isAddress("0x1234")).toBe(false);
    });
    it("rejects an address without 0x prefix", () => {
      expect(isAddress("1234567890abcdef1234567890ABCDEF12345678")).toBe(false);
    });
    it("rejects an address with non-hex characters", () => {
      expect(isAddress("0xZZZZ567890abcdef1234567890ABCDEF12345678")).toBe(false);
    });
  });

  describe("isHash32", () => {
    it("accepts a valid 32-byte hex hash with 0x prefix", () => {
      expect(
        isHash32("0x" + "a".repeat(64)),
      ).toBe(true);
    });
    it("rejects a 31-byte hash", () => {
      expect(isHash32("0x" + "a".repeat(62))).toBe(false);
    });
    it("rejects an empty string", () => {
      expect(isHash32("")).toBe(false);
    });
  });

  describe("isUrl", () => {
    it("accepts http URLs", () => {
      expect(isUrl("http://example.com")).toBe(true);
    });
    it("accepts https URLs", () => {
      expect(isUrl("https://example.com")).toBe(true);
    });
    it("accepts root-relative paths", () => {
      expect(isUrl("/local-rpc")).toBe(true);
    });
    it("rejects bare hostnames", () => {
      expect(isUrl("example.com")).toBe(false);
    });
    it("rejects empty strings", () => {
      expect(isUrl("")).toBe(false);
    });
  });
});

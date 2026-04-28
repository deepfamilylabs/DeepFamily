import { describe, expect, it } from "vitest";
import {
  formatNumericError,
  getPreviousPageOffset,
  getWatchedNumber,
  sanitizeNumberInput,
} from "./searchPageModel";

describe("searchPageModel", () => {
  it("sanitizes optional numeric form inputs", () => {
    expect(sanitizeNumberInput("12")).toBe(12);
    expect(sanitizeNumberInput("")).toBeUndefined();
    expect(sanitizeNumberInput("abc")).toBeUndefined();
  });

  it("normalizes react-hook-form number errors to the supplied fallback", () => {
    expect(formatNumericError("Expected number, received nan", "Range error")).toBe("Range error");
    expect(formatNumericError("Custom validation", "Range error")).toBe("Custom validation");
    expect(formatNumericError(undefined, "Range error")).toBeUndefined();
  });

  it("calculates previous page offsets from the next offset and page size", () => {
    expect(getPreviousPageOffset(200, 100)).toBe(0);
    expect(getPreviousPageOffset(250, 100)).toBe(50);
    expect(getPreviousPageOffset(50, 100)).toBe(0);
  });

  it("reads finite watched numbers only", () => {
    expect(getWatchedNumber(7)).toBe(7);
    expect(getWatchedNumber(Number.NaN)).toBeUndefined();
    expect(getWatchedNumber("7")).toBeUndefined();
  });
});

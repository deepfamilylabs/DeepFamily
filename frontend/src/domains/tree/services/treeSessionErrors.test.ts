import { describe, expect, it } from "vitest";
import {
  classifyTreeRootCheckError,
  classifyTreeSessionConnectionError,
} from "./treeSessionErrors";

describe("treeSessionErrors", () => {
  it("classifies rate limits and network failures", () => {
    expect(classifyTreeSessionConnectionError({ code: -32005 })).toBe("rateLimited");
    expect(classifyTreeSessionConnectionError({ message: "ECONNREFUSED" })).toBe("networkError");
    expect(classifyTreeSessionConnectionError({ message: "unknown revert" })).toBe(
      "contractModeRootNotFound",
    );
  });

  it("classifies invalid root errors separately", () => {
    expect(
      classifyTreeRootCheckError({ errorName: "InvalidPersonHash", message: "boom" }),
    ).toEqual({
      status: "rootNotFound",
      isRootInvalid: true,
    });

    expect(classifyTreeRootCheckError({ message: "network timeout" })).toEqual({
      status: "networkError",
      isRootInvalid: false,
    });
  });
});

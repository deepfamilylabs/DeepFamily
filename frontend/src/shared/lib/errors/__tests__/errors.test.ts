import { describe, expect, it } from "vitest";
import {
  ERROR_SELECTOR_MAP,
  extractRevertReason,
  getFriendlyError,
  resolveErrorReason,
  summarizeErrorForDev,
} from "..";

const passthroughT = (_key: string, fallback?: string) => fallback ?? _key;

describe("errors", () => {
  it("resolves DuplicateVersion from nested Hardhat revert data", () => {
    const error = {
      code: "CALL_EXCEPTION",
      info: {
        error: {
          data: {
            message:
              "VM Exception while processing transaction: reverted with custom error 'DuplicateVersion()'",
            data: "0x2872d6ce",
          },
        },
      },
    };

    expect(resolveErrorReason(error)).toBe("DuplicateVersion");
    expect(getFriendlyError(error, passthroughT as any).type).toBe("DuplicateVersion");
  });

  it("resolves custom error names from top-level provider messages", () => {
    const error = {
      code: "CALL_EXCEPTION",
      shortMessage:
        "execution reverted: VM Exception while processing transaction: reverted with custom error 'DuplicateVersion()'",
    };

    expect(resolveErrorReason(error)).toBe("DuplicateVersion");
  });

  it("resolves nested rpc errors stored on non-enumerable Error properties", () => {
    const error = new Error("missing revert data");
    (error as any).code = "CALL_EXCEPTION";
    Object.defineProperty(error, "info", {
      enumerable: false,
      value: {
        error: {
          code: -32603,
          message: "Internal error",
          data: {
            message:
              "VM Exception while processing transaction: reverted with custom error 'DuplicateVersion()'",
            data: "0x2872d6ce",
          },
        },
      },
    });

    expect(resolveErrorReason(error)).toBe("DuplicateVersion");
    expect(getFriendlyError(error, passthroughT as any).message).toBe(
      "This version already exists on-chain.",
    );
  });

  it("summarizes non-enumerable rpc error details for dev logging", () => {
    const error = new Error("missing revert data");
    (error as any).code = "CALL_EXCEPTION";
    Object.defineProperty(error, "info", {
      enumerable: false,
      value: {
        error: {
          code: -32603,
          message: "Internal error",
          data: {
            message:
              "VM Exception while processing transaction: reverted with custom error 'DuplicateVersion()'",
            data: "0x2872d6ce",
          },
        },
      },
    });

    expect(summarizeErrorForDev(error)).toMatchObject({
      code: "CALL_EXCEPTION",
      "info.error.code": -32603,
      "info.error.message": "Internal error",
      "info.error.data.message":
        "VM Exception while processing transaction: reverted with custom error 'DuplicateVersion()'",
      "info.error.data.data": "0x2872d6ce",
    });
  });

  it("uses contract.parseError when available", () => {
    const contract = {
      interface: {
        parseError: (data: string) => {
          if (data === "0x2872d6ce") return { name: "DuplicateVersion" };
          throw new Error("unknown");
        },
      },
    };
    const error = {
      error: {
        data: {
          data: "0x2872d6ce",
        },
      },
    };

    expect(extractRevertReason(contract, error)).toBe("DuplicateVersion");
  });

  it("keeps selector-map coverage for DuplicateVersion", () => {
    expect(ERROR_SELECTOR_MAP["0x2872d6ce"]).toBe("DuplicateVersion");
  });
});

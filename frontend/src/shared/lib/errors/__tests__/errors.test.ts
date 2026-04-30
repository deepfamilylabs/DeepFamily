import { describe, expect, it } from "vitest";
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";
import DeepFamily from "../../../../abi/DeepFamily.json";
import {
  ERROR_SELECTOR_MAP,
  extractRevertReason,
  getFriendlyError,
  getFriendlyErrorMessage,
  normalizeErrorToError,
  normalizeFriendlyError,
  resolveErrorReason,
  summarizeErrorForDev,
} from "..";

const passthroughT = (_key: string, fallback?: string) => fallback ?? _key;

const selectorOf = (signature: string) => ethers.id(signature).slice(0, 10);
const encodeStandardError = (reason: string) =>
  `0x08c379a0${ethers.AbiCoder.defaultAbiCoder().encode(["string"], [reason]).slice(2)}`;
const encodePanic = (code: bigint) =>
  `0x4e487b71${ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [code]).slice(2)}`;

const collectLocalContractErrors = () => {
  const contractsRoot = path.resolve(process.cwd(), "../contracts");
  const out: Array<{ name: string; selector: string; signature: string; file: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.name.endsWith(".sol")) continue;
      const source = fs.readFileSync(fullPath, "utf8");
      for (const match of source.matchAll(/\berror\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*;/g)) {
        const [, name, params] = match;
        const types = params.trim()
          ? params
              .split(",")
              .map((part) => part.trim().split(/\s+/)[0])
              .join(",")
          : "";
        const signature = `${name}(${types})`;
        out.push({
          name,
          selector: selectorOf(signature),
          signature,
          file: path.relative(contractsRoot, fullPath),
        });
      }
    }
  };
  walk(contractsRoot);
  return out;
};

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

  it("covers compiled DeepFamily ABI custom errors and local Solidity custom errors", () => {
    const abiErrors = DeepFamily.abi
      .filter((item: any) => item.type === "error")
      .map((item: any) => ({
        name: item.name,
        selector: selectorOf(`${item.name}(${(item.inputs || []).map((input: any) => input.type).join(",")})`),
        signature: `${item.name}(${(item.inputs || []).map((input: any) => input.type).join(",")})`,
        file: "frontend/src/abi/DeepFamily.json",
      }));
    const allErrors = [...abiErrors, ...collectLocalContractErrors()];
    const missing = allErrors.filter((item) => ERROR_SELECTOR_MAP[item.selector] !== item.name);

    expect(missing).toEqual([]);
  });

  it("decodes standard Error(string) revert data before falling back to selector names", () => {
    const error = {
      code: "CALL_EXCEPTION",
      data: encodeStandardError("DuplicateVersion"),
    };

    expect(resolveErrorReason(error)).toBe("DuplicateVersion");
    expect(getFriendlyError(error, passthroughT as any).message).toBe(
      "This version already exists on-chain.",
    );
  });

  it("classifies Solidity panic data without treating it as an unknown selector", () => {
    const error = {
      code: "CALL_EXCEPTION",
      data: encodePanic(0x11n),
    };

    expect(resolveErrorReason(error)).toBe("EVM_PANIC");
    expect(getFriendlyError(error, passthroughT as any).message).toBe(
      "Contract execution hit a Solidity panic.",
    );
  });

  it("prefers precise out-of-gas classification over generic gas errors", () => {
    expect(resolveErrorReason({ message: "execution reverted: out of gas" })).toBe("OUT_OF_GAS");
  });

  it("normalizes wallet pending requests through the shared parser", () => {
    const error = Object.assign(new Error("request already pending"), { code: -32002 });
    const friendly = normalizeFriendlyError(error, passthroughT as any);

    expect(friendly.type).toBe("WALLET_REQUEST_PENDING");
    expect(friendly.retryable).toBe(true);
    expect(getFriendlyErrorMessage(error, passthroughT as any, "fallback")).toContain(
      "pending request",
    );
  });

  it("normalizes standard EIP-1193 wallet error codes", () => {
    expect(resolveErrorReason({ code: 4100 })).toBe("WALLET_UNAUTHORIZED");
    expect(resolveErrorReason({ code: 4200 })).toBe("WALLET_METHOD_UNSUPPORTED");
    expect(resolveErrorReason({ code: 4900 })).toBe("WALLET_DISCONNECTED");
    expect(resolveErrorReason({ code: 4901 })).toBe("WALLET_CHAIN_DISCONNECTED");
    expect(resolveErrorReason({ code: 4902 })).toBe("WALLET_CHAIN_NOT_ADDED");
  });

  it("bounds deep object scanning so unrelated nested payloads do not drive classification", () => {
    const error = {
      payload: {
        a: { b: { c: { d: { e: { f: { g: "user rejected the transaction" } } } } } },
      },
    };

    expect(resolveErrorReason(error)).toBeUndefined();
  });

  it("truncates unknown error details before returning them to the UI", () => {
    const error = new Error("x".repeat(2000));
    const friendly = getFriendlyError(error, passthroughT as any);

    expect(friendly.details.length).toBeLessThanOrEqual(1201);
  });

  it("converts parsed friendly errors back into typed Error instances", () => {
    const normalized = normalizeErrorToError(
      { code: "INSUFFICIENT_DEEP_BALANCE", message: "low DEEP" },
      passthroughT as any,
    );

    expect(normalized.message).toBe("Insufficient DEEP token balance for endorsement.");
    expect((normalized as any).type).toBe("INSUFFICIENT_DEEP_BALANCE");
    expect((normalized as any).code).toBe("INSUFFICIENT_DEEP_BALANCE");
  });
});

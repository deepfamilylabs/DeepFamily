import { describe, expect, it, vi } from "vitest";
import { serializeWorkerError } from "./workerErrors";

describe("secret-bearing worker diagnostics", () => {
  it.each(["raw", "normalized", "percent-encoded", "hex", "fragment"])(
    "never forwards %s credentials from an exception's fields",
    (representation) => {
      const secret = "a\u030a-worker-secret-7Q!";
      const variants: Record<string, string> = {
        raw: secret,
        normalized: secret.normalize("NFC"),
        "percent-encoded": encodeURIComponent(secret),
        hex: Array.from(new TextEncoder().encode(secret), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
        fragment: "worker-secret-7Q",
      };
      const leaked = variants[representation];
      const error = Object.assign(new Error(`private failure: ${leaked}`), {
        name: leaked,
        code: leaked,
        cause: new Error(leaked),
        witness: { derivedSecretField: "314159265358979323846" },
      });

      expect(serializeWorkerError(error)).toEqual({
        message: "Local cryptographic operation failed",
      });
    },
  );

  it("keeps a public error code but replaces every dynamic diagnostic", () => {
    const secret = "known-code-private-secret";
    const error = Object.assign(new Error(secret), {
      name: secret,
      code: "AES_GCM_AUTHENTICATION_FAILED",
      cause: secret,
    });

    expect(serializeWorkerError(error)).toEqual({
      message: "Metadata authentication failed",
      name: "ProtocolError",
      code: "AES_GCM_AUTHENTICATION_FAILED",
    });
  });

  it("does not stringify unknown failures or forward throwing error accessors", () => {
    const toString = vi.fn(() => "private-stringification-secret");
    expect(serializeWorkerError({ toString })).toEqual({
      message: "Local cryptographic operation failed",
    });
    expect(toString).not.toHaveBeenCalled();
    const failure = {
      get code() {
        throw new Error("private-getter-secret");
      },
    };
    expect(serializeWorkerError(failure)).toEqual({
      message: "Local cryptographic operation failed",
    });
  });
});

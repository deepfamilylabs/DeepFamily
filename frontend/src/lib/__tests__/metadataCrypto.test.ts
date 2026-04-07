import { describe, expect, it } from "vitest";
import {
  decryptMetadataPayload,
  decryptMetadataPayloadV2,
  encryptMetadataJson,
  encryptMetadataJsonV2,
} from "../metadataCrypto";

describe("metadataCrypto", () => {
  it("supports v1 round-trip", async () => {
    const plaintext = JSON.stringify({ hello: "world" });
    const { payload } = await encryptMetadataJson(plaintext, "password-123");
    const result = await decryptMetadataPayload(payload, "password-123");
    expect(result.plaintext).toBe(plaintext);
    expect(result.data).toEqual({ hello: "world" });
  });

  it("supports v2 round-trip", async () => {
    const plaintext = JSON.stringify({ hello: "world", recovery: { identityKdf: { saltHex: "aa" } } });
    const { payload } = await encryptMetadataJsonV2(plaintext, "password-123");
    const result = await decryptMetadataPayloadV2(payload, "password-123");
    expect(result.plaintext).toBe(plaintext);
    expect(result.data.hello).toBe("world");
  }, 30000);

  it("unified decrypt supports v2 payload", async () => {
    const plaintext = JSON.stringify({ v: 2 });
    const { payload } = await encryptMetadataJsonV2(plaintext, "password-123");
    const result = await decryptMetadataPayload(payload, "password-123");
    expect(result.plaintext).toBe(plaintext);
  }, 30000);
});

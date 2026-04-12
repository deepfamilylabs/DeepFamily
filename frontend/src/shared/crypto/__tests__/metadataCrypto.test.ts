import { describe, expect, it } from "vitest";
import {
  decryptMetadataPayload,
  decryptMetadataPayloadV2,
  encryptMetadataJsonV2,
} from "../metadataCrypto";

describe("metadataCrypto", () => {
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

  it("rejects non-v2 payloads during parse/decrypt", async () => {
    await expect(
      decryptMetadataPayload(
        JSON.stringify({
          version: "df-meta-v1",
          schema: "deepfamily/person-version@1.0",
          cipher: "AES-256-GCM",
          aad: "deepfamily/person-version@1.0",
          kdf: { alg: "PBKDF2-SHA256", iter: 1, salt: "AA==" },
          iv: "AA==",
          ciphertext: "AA==",
          tag: "AA==",
        }),
        "password-123",
      ),
    ).rejects.toThrow("unsupported kdf algorithm");
  });
});

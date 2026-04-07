import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  deriveIdentitySecretV2,
  generateRandomSalt,
  hexToBytes,
  mapBytesToSnarkField,
  SNARK_FIELD,
} from "../secretDerivation";

describe("secretDerivation", () => {
  it("round-trips hex encoding", () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255]);
    expect(bytesToHex(bytes)).toBe("000102feff");
    expect(Array.from(hexToBytes("000102feff"))).toEqual(Array.from(bytes));
  });

  it("round-trips base64 encoding", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it("generates random salt of expected length", () => {
    const salt = generateRandomSalt();
    expect(salt).toBeInstanceOf(Uint8Array);
    expect(salt).toHaveLength(16);
  });

  it("derives stable identity secret for same inputs", async () => {
    const salt = hexToBytes("00112233445566778899aabbccddeeff");
    const a = await deriveIdentitySecretV2({ passphrase: "test-passphrase", salt });
    const b = await deriveIdentitySecretV2({ passphrase: "test-passphrase", salt });
    expect(a.derivedSecretHex).toBe(b.derivedSecretHex);
    expect(a.saltHex).toBe("00112233445566778899aabbccddeeff");
  }, 30000);

  it("maps bytes into snark field range", () => {
    const field = mapBytesToSnarkField(hexToBytes("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"));
    expect(field >= 0n).toBe(true);
    expect(field < SNARK_FIELD).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { deriveIdentitySecret, hexToBytes } from "../secretDerivation";
import {
  canonicalizeFullName,
  computeIdentityCommitment,
  computeNameField,
  computeNamePrehash,
  wrapIdentityCommitmentAsPersonHash,
} from "../identityCommitment";

describe("identityCommitment", () => {
  it("canonicalizes name with NFKC + whitespace folding", () => {
    expect(canonicalizeFullName("  Alice\u3000Smith  ")).toBe("Alice Smith");
  });

  it("computes stable name prehash and field", () => {
    const prehash = computeNamePrehash("Alice Smith");
    const field = computeNameField(prehash);
    expect(prehash.startsWith("0x")).toBe(true);
    expect(field >= 0n).toBe(true);
  });

  it("computes stable identity commitment and person hash", async () => {
    const derived = await deriveIdentitySecret({
      passphrase: "strong passphrase",
      salt: hexToBytes("00112233445566778899aabbccddeeff"),
    });

    const resultA = computeIdentityCommitment({
      canonicalInput: {
        schemaVersion: 1,
        cryptoSuiteVersion: 1,
        hashAlgoId: 1,
        fullName: "  Alice\u3000Smith  ",
        isBirthBC: false,
        birthYear: 1990,
        birthMonth: 5,
        birthDay: 15,
        gender: 1,
        passphrase: "strong passphrase",
      },
      derivedSecretBundle: derived,
    });

    const resultB = computeIdentityCommitment({
      canonicalInput: {
        schemaVersion: 1,
        cryptoSuiteVersion: 1,
        hashAlgoId: 1,
        fullName: "Alice Smith",
        isBirthBC: false,
        birthYear: 1990,
        birthMonth: 5,
        birthDay: 15,
        gender: 1,
        passphrase: "strong passphrase",
      },
      derivedSecretBundle: derived,
    });

    expect(resultA.canonicalFullName).toBe("Alice Smith");
    expect(resultA.identityCommitment).toBe(resultB.identityCommitment);
    expect(resultA.personHash).toBe(resultB.personHash);
    expect(resultA.personHash).toBe(wrapIdentityCommitmentAsPersonHash(resultA.identityCommitment));
  }, 30000);
});

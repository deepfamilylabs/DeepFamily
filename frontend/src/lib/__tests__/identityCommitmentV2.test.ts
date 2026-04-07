import { describe, expect, it } from "vitest";
import { deriveIdentitySecretV2, hexToBytes } from "../secretDerivation";
import {
  canonicalizeFullNameV2,
  computeIdentityCommitmentV2,
  computeNameFieldV2,
  computeNamePrehashV2,
  wrapIdentityCommitmentAsPersonHashV2,
} from "../identityCommitmentV2";

describe("identityCommitmentV2", () => {
  it("canonicalizes name with NFKC + whitespace folding", () => {
    expect(canonicalizeFullNameV2("  Alice\u3000Smith  ")).toBe("Alice Smith");
  });

  it("computes stable name prehash and field", () => {
    const prehash = computeNamePrehashV2("Alice Smith");
    const field = computeNameFieldV2(prehash);
    expect(prehash.startsWith("0x")).toBe(true);
    expect(field >= 0n).toBe(true);
  });

  it("computes stable identity commitment and person hash", async () => {
    const derived = await deriveIdentitySecretV2({
      passphrase: "strong passphrase",
      salt: hexToBytes("00112233445566778899aabbccddeeff"),
    });

    const resultA = computeIdentityCommitmentV2({
      canonicalInput: {
        schemaVersion: 2,
        cryptoSuiteVersion: 2,
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

    const resultB = computeIdentityCommitmentV2({
      canonicalInput: {
        schemaVersion: 2,
        cryptoSuiteVersion: 2,
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
    expect(resultA.personHash).toBe(wrapIdentityCommitmentAsPersonHashV2(resultA.identityCommitment));
  }, 30000);
});

import { describe, expect, it } from "vitest";
import { deriveIdentitySecretV2, hexToBytes } from "../secretDerivation";
import {
  bigintTo32ByteHex,
  buildMintDisclosureInputsV2,
  computeDisclosureBindingV2FromFullName,
  createDisclosureBindingV2,
} from "../disclosureBindingV2";

describe("disclosureBindingV2", () => {
  it("creates stable disclosure binding for same inputs", () => {
    const resultA = computeDisclosureBindingV2FromFullName({
      fullName: "  Alice\u3000Smith  ",
      disclosureNonceHex: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
      schemaVersion: 2,
      cryptoSuiteVersion: 2,
      hashAlgoId: 1,
    });
    const resultB = computeDisclosureBindingV2FromFullName({
      fullName: "Alice Smith",
      disclosureNonceHex: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
      schemaVersion: 2,
      cryptoSuiteVersion: 2,
      hashAlgoId: 1,
    });

    expect(resultA.canonicalFullName).toBe("Alice Smith");
    expect(resultB.canonicalFullName).toBe("Alice Smith");
    expect(resultA.nameField).toBe(resultB.nameField);
    expect(resultA.disclosureBinding).toBe(resultB.disclosureBinding);
  });

  it("creates disclosure binding with generated nonce", () => {
    const result = createDisclosureBindingV2({
      fullName: "Alice Smith",
      schemaVersion: 2,
      cryptoSuiteVersion: 2,
      hashAlgoId: 1,
    });

    expect(result.disclosureNonceHex).toHaveLength(64);
    expect(bigintTo32ByteHex(result.disclosureBinding).startsWith("0x")).toBe(true);
  });

  it("builds mint disclosure inputs aligned with identity commitment", async () => {
    const derived = await deriveIdentitySecretV2({
      passphrase: "strong passphrase",
      salt: hexToBytes("00112233445566778899aabbccddeeff"),
    });

    const result = buildMintDisclosureInputsV2({
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
      disclosureNonce: hexToBytes("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"),
    });

    expect(result.fullName).toBe("Alice Smith");
    expect(result.disclosureNonceHex).toBe(
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
    );
    expect(result.disclosureBindingHex.startsWith("0x")).toBe(true);
    expect(result.identityCommitmentHex.startsWith("0x")).toBe(true);
    expect(result.personHash.startsWith("0x")).toBe(true);
  }, 30000);
});

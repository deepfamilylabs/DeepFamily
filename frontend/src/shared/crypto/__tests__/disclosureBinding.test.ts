import { describe, expect, it } from "vitest";
import { deriveIdentitySecret, hexToBytes } from "../secretDerivation";
import {
  bigintTo32ByteHex,
  buildMintDisclosureInputs,
  computeDisclosureBindingFromFullName,
  createDisclosureBinding,
} from "../disclosureBinding";

describe("disclosureBinding", () => {
  it("creates stable disclosure binding for same inputs", () => {
    const resultA = computeDisclosureBindingFromFullName({
      fullName: "  Alice\u3000Smith  ",
      isBirthBC: false,
      birthYear: 1990,
      birthMonth: 5,
      birthDay: 15,
      gender: 1,
      schemaVersion: 1,
      cryptoSuiteVersion: 1,
      hashAlgoId: 1,
    });
    const resultB = computeDisclosureBindingFromFullName({
      fullName: "Alice Smith",
      isBirthBC: false,
      birthYear: 1990,
      birthMonth: 5,
      birthDay: 15,
      gender: 1,
      schemaVersion: 1,
      cryptoSuiteVersion: 1,
      hashAlgoId: 1,
    });

    expect(resultA.canonicalFullName).toBe("Alice Smith");
    expect(resultB.canonicalFullName).toBe("Alice Smith");
    expect(resultA.nameField).toBe(resultB.nameField);
    expect(resultA.disclosureBinding).toBe(resultB.disclosureBinding);
  });

  it("creates disclosure binding from name and basicInfo", () => {
    const result = createDisclosureBinding({
      fullName: "Alice Smith",
      isBirthBC: false,
      birthYear: 1990,
      birthMonth: 5,
      birthDay: 15,
      gender: 1,
      schemaVersion: 1,
      cryptoSuiteVersion: 1,
      hashAlgoId: 1,
    });

    expect(result.packedBirthGenderField.toString()).toBe("33386991362");
    expect(bigintTo32ByteHex(result.disclosureBinding).startsWith("0x")).toBe(true);
  });

  it("builds mint disclosure inputs aligned with identity commitment", async () => {
    const derived = await deriveIdentitySecret({
      passphrase: "strong passphrase",
      salt: hexToBytes("00112233445566778899aabbccddeeff"),
    });

    const result = buildMintDisclosureInputs({
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

    expect(result.fullName).toBe("Alice Smith");
    expect(result.disclosureBindingHex.startsWith("0x")).toBe(true);
    expect(result.identityCommitmentHex.startsWith("0x")).toBe(true);
    expect(result.personHash.startsWith("0x")).toBe(true);
  }, 30000);
});

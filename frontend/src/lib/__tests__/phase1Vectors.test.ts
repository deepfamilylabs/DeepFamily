import { describe, expect, it } from "vitest";
import vectors from "./fixtures/phase1-test-vectors.json";
import { deriveIdentitySecret, hexToBytes } from "../secretDerivation";
import { computeIdentityCommitment } from "../identityCommitment";
import { computeDisclosureBindingFromFullName } from "../disclosureBinding";

describe("phase1 test vectors", () => {
  for (const vector of vectors) {
    it(`matches vector: ${vector.id}`, async () => {
      const derived = await deriveIdentitySecret({
        passphrase: vector.input.passphrase,
        salt: hexToBytes(vector.input.saltHex),
      });

      const identity = computeIdentityCommitment({
        canonicalInput: {
          schemaVersion: 1,
          cryptoSuiteVersion: 1,
          hashAlgoId: vector.input.hashAlgoId ?? 1,
          fullName: vector.input.fullName,
          isBirthBC: vector.input.isBirthBC,
          birthYear: vector.input.birthYear,
          birthMonth: vector.input.birthMonth,
          birthDay: vector.input.birthDay,
          gender: vector.input.gender,
          passphrase: vector.input.passphrase,
        },
        derivedSecretBundle: derived,
      });

      const disclosure = computeDisclosureBindingFromFullName({
        fullName: vector.input.fullName,
        isBirthBC: vector.input.isBirthBC,
        birthYear: vector.input.birthYear,
        birthMonth: vector.input.birthMonth,
        birthDay: vector.input.birthDay,
        gender: vector.input.gender,
        schemaVersion: 1,
        cryptoSuiteVersion: 1,
        hashAlgoId: vector.input.hashAlgoId ?? 1,
      });

      expect(derived.derivedSecretHex).toBe(vector.derivedSecretHex);
      expect(identity.canonicalFullName).toBe(vector.canonicalFullName);
      expect(identity.namePrehash).toBe(vector.namePrehash);
      expect(identity.nameField.toString()).toBe(vector.nameField);
      expect(identity.packedBirthGenderField.toString()).toBe(vector.packedBirthGenderField);
      expect(identity.nameSecretCommitment.toString()).toBe(vector.nameSecretCommitment);
      expect(identity.identityCommitment.toString()).toBe(vector.identityCommitment);
      expect(identity.personHash).toBe(vector.personHash);
      expect(disclosure.packedBirthGenderField.toString()).toBe(vector.packedBirthGenderField);
      expect(disclosure.disclosureBinding.toString()).toBe(vector.disclosureBinding);
    }, 30000);
  }
});

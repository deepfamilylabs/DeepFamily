import { describe, expect, it } from "vitest";
import vectors from "./fixtures/phase1-v2-test-vectors.json";
import { deriveIdentitySecretV2, hexToBytes } from "../secretDerivation";
import { computeIdentityCommitmentV2 } from "../identityCommitmentV2";
import { computeDisclosureBindingV2FromFullName } from "../disclosureBindingV2";

describe("phase1 v2 test vectors", () => {
  for (const vector of vectors) {
    it(`matches vector: ${vector.id}`, async () => {
      const derived = await deriveIdentitySecretV2({
        passphrase: vector.input.passphrase,
        salt: hexToBytes(vector.input.saltHex),
      });

      const identity = computeIdentityCommitmentV2({
        canonicalInput: {
          schemaVersion: 2,
          cryptoSuiteVersion: 2,
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

      const disclosure = computeDisclosureBindingV2FromFullName({
        fullName: vector.input.fullName,
        disclosureNonceHex: vector.input.disclosureNonceHex,
        schemaVersion: 2,
        cryptoSuiteVersion: 2,
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
      expect(disclosure.disclosureNonceField.toString()).toBe(vector.disclosureNonceField);
      expect(disclosure.disclosureBinding.toString()).toBe(vector.disclosureBinding);
    }, 30000);
  }
});

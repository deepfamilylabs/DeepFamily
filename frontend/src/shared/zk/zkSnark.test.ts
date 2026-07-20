import { describe, expect, it } from "vitest";
import { computeDisclosureBinding, computePersonHashFromData, type PersonData } from "./zk";
import {
  assertDisclosureBindingPublicSignalsMatch,
  assertPersonCommitmentPublicSignalsMatch,
} from "./zkSnark";

const submitterAddress = "0x1234567890123456789012345678901234567890";

const person: PersonData = {
  fullName: "Child Example",
  derivedSecretField: 11n,
  isBirthBC: false,
  birthYear: 2000,
  birthMonth: 1,
  birthDay: 2,
  gender: 2,
  schemaVersion: 2,
  cryptoSuiteVersion: 3,
  hashAlgoId: 4,
};

const father: PersonData = {
  fullName: "Father Example",
  derivedSecretField: 12n,
  isBirthBC: false,
  birthYear: 1970,
  birthMonth: 3,
  birthDay: 4,
  gender: 1,
};

const mother: PersonData = {
  fullName: "Mother Example",
  derivedSecretField: 13n,
  isBirthBC: false,
  birthYear: 1972,
  birthMonth: 5,
  birthDay: 6,
  gender: 2,
};

describe("ZK public-signal assertions", () => {
  it("rejects every mismatched person-commitment public signal", () => {
    const personIdentity = computePersonHashFromData(person);
    const fatherIdentity = computePersonHashFromData({
      ...father,
      schemaVersion: person.schemaVersion,
      cryptoSuiteVersion: person.cryptoSuiteVersion,
      hashAlgoId: person.hashAlgoId,
    });
    const motherIdentity = computePersonHashFromData({
      ...mother,
      schemaVersion: person.schemaVersion,
      cryptoSuiteVersion: person.cryptoSuiteVersion,
      hashAlgoId: person.hashAlgoId,
    });
    const expectedSignals = [
      personIdentity.identityCommitment,
      fatherIdentity.identityCommitment,
      motherIdentity.identityCommitment,
      BigInt(submitterAddress),
      2n,
      3n,
      4n,
    ];
    const fieldNames = [
      "identityCommitment",
      "fatherIdentityCommitment",
      "motherIdentityCommitment",
      "submitter",
      "schemaVersion",
      "cryptoSuiteVersion",
      "hashAlgoId",
    ];

    expect(() =>
      assertPersonCommitmentPublicSignalsMatch(
        expectedSignals,
        person,
        father,
        mother,
        submitterAddress,
      ),
    ).not.toThrow();

    fieldNames.forEach((fieldName, index) => {
      const mismatched = [...expectedSignals];
      mismatched[index] += 1n;
      expect(() =>
        assertPersonCommitmentPublicSignalsMatch(
          mismatched,
          person,
          father,
          mother,
          submitterAddress,
        ),
      ).toThrow(`${fieldName} public signal mismatch`);
    });
  });

  it("rejects every mismatched disclosure-binding public signal", () => {
    const identity = computePersonHashFromData(person);
    const disclosureBinding = computeDisclosureBinding(
      identity.nameField,
      identity.packedBirthGenderField,
      identity.suiteCommitment,
    );
    const expectedSignals = [
      identity.identityCommitment,
      disclosureBinding,
      BigInt(submitterAddress),
      2n,
      3n,
      4n,
    ];
    const fieldNames = [
      "identityCommitment",
      "disclosureBinding",
      "minter",
      "schemaVersion",
      "cryptoSuiteVersion",
      "hashAlgoId",
    ];

    expect(() =>
      assertDisclosureBindingPublicSignalsMatch(expectedSignals, person, submitterAddress),
    ).not.toThrow();

    fieldNames.forEach((fieldName, index) => {
      const mismatched = [...expectedSignals];
      mismatched[index] += 1n;
      expect(() =>
        assertDisclosureBindingPublicSignalsMatch(mismatched, person, submitterAddress),
      ).toThrow(`${fieldName} public signal mismatch`);
    });
  });
});

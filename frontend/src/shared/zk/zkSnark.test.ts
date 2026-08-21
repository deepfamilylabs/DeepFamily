import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeDisclosureBinding,
  computePersonHashFromData,
  computeVersionCommitment,
  type PersonData,
} from "./zk";
import {
  assertDisclosureBindingPublicSignalsMatch,
  assertPersonRelationPublicSignalsMatch,
  generatePersonRelationProof,
  type PersonRelationProofParameters,
} from "./zkSnark";

const snarkMocks = vi.hoisted(() => ({
  fullProve: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("snarkjs", () => ({
  groth16: snarkMocks,
}));

const submitterAddress = "0x1234567890123456789012345678901234567890";

const person: PersonData = {
  fullName: "Child Example",
  derivedSecretField: 11n,
  isBirthBC: false,
  birthYear: 2000,
  birthMonth: 1,
  birthDay: 2,
  gender: 2,
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

const relationParameters: PersonRelationProofParameters = {
  person,
  father,
  mother,
  submitterAddress,
  selfSuiteId: 2,
  fatherSuiteId: 1,
  motherSuiteId: 1,
  contentDigestLo: 7n,
  contentDigestHi: 8n,
};

describe("fresh-v1 ZK public-signal assertions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    snarkMocks.fullProve.mockReset();
    snarkMocks.verify.mockReset();
  });

  it("supports mixed role suites and rejects every mismatched PersonRelation signal", () => {
    const selfIdentity = computePersonHashFromData(person, 2);
    const fatherIdentity = computePersonHashFromData(father, 1);
    const motherIdentity = computePersonHashFromData(mother, 1);
    const expectedSignals = [
      selfIdentity.identityCommitment,
      fatherIdentity.identityCommitment,
      motherIdentity.identityCommitment,
      BigInt(submitterAddress) + (2n << 160n),
      computeVersionCommitment(person.derivedSecretField, 7n, 8n),
    ];
    const fieldNames = [
      "identityCommitment",
      "fatherIdentityCommitment",
      "motherIdentityCommitment",
      "submitterAndSelfSuiteId",
      "versionCommitment",
    ];

    expect(() =>
      assertPersonRelationPublicSignalsMatch(expectedSignals, relationParameters),
    ).not.toThrow();
    fieldNames.forEach((fieldName, index) => {
      const mismatched = [...expectedSignals];
      mismatched[index] += 1n;
      expect(() => assertPersonRelationPublicSignalsMatch(mismatched, relationParameters)).toThrow(
        `${fieldName} public signal mismatch`,
      );
    });
  });

  it("passes the complete frozen PersonRelation witness to snarkjs", async () => {
    const selfIdentity = computePersonHashFromData(person, 2);
    const fatherIdentity = computePersonHashFromData(father, 1);
    const motherIdentity = computePersonHashFromData(mother, 1);
    const publicSignals = [
      selfIdentity.identityCommitment,
      fatherIdentity.identityCommitment,
      motherIdentity.identityCommitment,
      BigInt(submitterAddress) + (2n << 160n),
      computeVersionCommitment(person.derivedSecretField, 7n, 8n),
    ].map(String);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    );
    snarkMocks.fullProve.mockResolvedValue({ proof: {}, publicSignals });

    await generatePersonRelationProof(relationParameters);

    expect(snarkMocks.fullProve).toHaveBeenCalledOnce();
    expect(snarkMocks.fullProve.mock.calls[0]?.[0]).toEqual({
      nameField: selfIdentity.nameField.toString(),
      derivedSecretField: "11",
      isBirthBC: 0,
      birthYear: 2000,
      birthMonth: 1,
      birthDay: 2,
      gender: 2,
      selfSuiteId: "2",
      fatherNameField: fatherIdentity.nameField.toString(),
      fatherDerivedSecretField: "12",
      fatherIsBirthBC: 0,
      fatherBirthYear: 1970,
      fatherBirthMonth: 3,
      fatherBirthDay: 4,
      fatherGender: 1,
      fatherSuiteId: "1",
      motherNameField: motherIdentity.nameField.toString(),
      motherDerivedSecretField: "13",
      motherIsBirthBC: 0,
      motherBirthYear: 1972,
      motherBirthMonth: 5,
      motherBirthDay: 6,
      motherGender: 2,
      motherSuiteId: "1",
      hasFather: 1,
      hasMother: 1,
      submitter: BigInt(submitterAddress).toString(),
      contentDigestLo: "7",
      contentDigestHi: "8",
    });
  });

  it("requires parent suite zero exactly for a null parent", () => {
    const selfIdentity = computePersonHashFromData(person, 2);
    const nullParentParameters = {
      ...relationParameters,
      father: null,
      mother: null,
      fatherSuiteId: 0,
      motherSuiteId: 0,
    };
    const signals = [
      selfIdentity.identityCommitment,
      0n,
      0n,
      BigInt(submitterAddress) + (2n << 160n),
      computeVersionCommitment(person.derivedSecretField, 7n, 8n),
    ];
    expect(() =>
      assertPersonRelationPublicSignalsMatch(signals, nullParentParameters),
    ).not.toThrow();
    expect(() =>
      assertPersonRelationPublicSignalsMatch(signals, {
        ...nullParentParameters,
        fatherSuiteId: 1,
      }),
    ).toThrow(/fatherSuiteId must be nonzero exactly when its role is present/);
  });

  it("rejects every mismatched DisclosureBinding signal", () => {
    const identity = computePersonHashFromData(person, 2);
    const expectedSignals = [
      identity.identityCommitment,
      computeDisclosureBinding(
        identity.nameField,
        identity.packedBirthGenderField,
        identity.suiteCommitment,
      ),
      BigInt(submitterAddress),
      identity.suiteCommitment,
    ];
    const parameters = { person, minterAddress: submitterAddress, selfSuiteId: 2 };
    const fieldNames = ["identityCommitment", "disclosureBinding", "minter", "suiteCommitment"];

    expect(() =>
      assertDisclosureBindingPublicSignalsMatch(expectedSignals, parameters),
    ).not.toThrow();
    fieldNames.forEach((fieldName, index) => {
      const mismatched = [...expectedSignals];
      mismatched[index] += 1n;
      expect(() => assertDisclosureBindingPublicSignalsMatch(mismatched, parameters)).toThrow(
        `${fieldName} public signal mismatch`,
      );
    });
  });
});

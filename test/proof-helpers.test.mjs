import { expect } from "chai";
import { poseidon4 } from "poseidon-lite";
import * as personRelationProof from "../lib/personCommitmentProof.js";
import disclosureBindingProof from "../lib/disclosureBindingProof.js";

const {
  assertPersonRelationPublicSignalsMatch,
  buildPersonRelationInput,
  computeAtomicSuiteCommitment,
  computePersonHashFromInput,
  splitContentDigest,
} = personRelationProof;
const { assertDisclosureBindingPublicSignalsMatch, buildDisclosureBindingInput } =
  disclosureBindingProof;

const submitter = "0x1234567890123456789012345678901234567890";
const child = {
  fullName: "Child Example",
  derivedSecretField: 11n,
  isBirthBC: false,
  birthYear: 2000,
  birthMonth: 1,
  birthDay: 2,
  gender: 1,
};
const father = {
  fullName: "Father Example",
  derivedSecretField: 12n,
  isBirthBC: false,
  birthYear: 1970,
  birthMonth: 3,
  birthDay: 4,
  gender: 1,
};
const mother = {
  fullName: "Mother Example",
  derivedSecretField: 13n,
  isBirthBC: false,
  birthYear: 1972,
  birthMonth: 5,
  birthDay: 6,
  gender: 2,
};
const contentDigest = `0x${"0123456789abcdef".repeat(4)}`;

describe("fresh-v1 proof helpers", function () {
  it("canonicalizes names while keeping the atomic identity suite explicit", function () {
    const base = { ...child, fullName: "Alice Smith" };
    const spaced = { ...child, fullName: "  Alice　Smith  " };
    const a = computePersonHashFromInput(base, { selfSuiteId: 2 });
    const b = computePersonHashFromInput(spaced, { selfSuiteId: 2 });
    const otherSuite = computePersonHashFromInput(base, { selfSuiteId: 1 });

    expect(b.canonicalFullName).to.equal("Alice Smith");
    expect(a.identityCommitment).to.equal(b.identityCommitment);
    expect(a.personHash).to.equal(b.personHash);
    expect(otherSuite.identityCommitment).not.to.equal(a.identityCommitment);
    expect(a.suiteCommitment).to.equal(poseidon4([1000n, 2n, 0n, 0n]));
    expect(computeAtomicSuiteCommitment(2)).to.equal(a.suiteCommitment);
  });

  it("uses the release-frozen Unicode White_Space set for proof names", function () {
    const withBom = computePersonHashFromInput(
      { ...child, fullName: "Alice\ufeffSmith" },
      { selfSuiteId: 1 },
    );
    const withSpace = computePersonHashFromInput(
      { ...child, fullName: "Alice Smith" },
      { selfSuiteId: 1 },
    );

    expect(withBom.canonicalFullName).to.equal("Alice\ufeffSmith");
    expect(withBom.personHash).not.to.equal(withSpace.personHash);
  });

  it("builds mixed-suite relation input, packed signal, digest limbs, and version commitment", function () {
    const built = buildPersonRelationInput(child, father, mother, submitter, {
      selfSuiteId: 2,
      fatherSuiteId: 1,
      motherSuiteId: 1,
      contentDigest,
    });
    const { contentDigestLo, contentDigestHi } = splitContentDigest(contentDigest);

    expect(built).to.include({ circuitId: 1, proofEncodingId: 1 });
    expect(built.input).to.include({ hasFather: 1, hasMother: 1 });
    expect(built.input.selfSuiteId).to.equal("2");
    expect(built.input.fatherSuiteId).to.equal("1");
    expect(built.input.motherSuiteId).to.equal("1");
    expect(built.submitterAndSelfSuiteId).to.equal(BigInt(submitter) + (2n << 160n));
    expect(built.contentDigestLo).to.equal(contentDigestLo);
    expect(built.contentDigestHi).to.equal(contentDigestHi);
    expect(built.versionCommitment).to.equal(
      poseidon4([1004n, child.derivedSecretField, contentDigestLo, contentDigestHi]),
    );
    expect(built.person.identitySuiteId).to.equal(2n);
    expect(built.father.identitySuiteId).to.equal(1n);
    expect(built.mother.identitySuiteId).to.equal(1n);
  });

  it("canonicalizes every null-parent witness field and suite ID to zero", function () {
    const built = buildPersonRelationInput(child, null, null, submitter, {
      selfSuiteId: 1,
      contentDigestLo: 7,
      contentDigestHi: 8,
    });
    expect(built.father).to.equal(null);
    expect(built.mother).to.equal(null);
    for (const [name, value] of Object.entries(built.input)) {
      if (name.startsWith("father") || name.startsWith("mother")) {
        expect(BigInt(value), name).to.equal(0n);
      }
    }
  });

  it("rejects each mismatched PersonRelation public signal", function () {
    const built = buildPersonRelationInput(child, father, null, submitter, {
      selfSuiteId: 2,
      fatherSuiteId: 1,
      contentDigestLo: 7,
      contentDigestHi: 8,
    });
    const expected = [
      built.person.identityCommitment,
      built.father.identityCommitment,
      0n,
      built.submitterAndSelfSuiteId,
      built.versionCommitment,
    ];
    const names = [
      "identityCommitment",
      "fatherIdentityCommitment",
      "motherIdentityCommitment",
      "submitterAndSelfSuiteId",
      "versionCommitment",
    ];
    expect(() => assertPersonRelationPublicSignalsMatch(built, expected)).not.to.throw();
    names.forEach((name, index) => {
      const mismatched = [...expected];
      mismatched[index] += 1n;
      expect(() => assertPersonRelationPublicSignalsMatch(built, mismatched)).to.throw(
        `${name} public signal mismatch`,
      );
    });
  });

  it("rejects out-of-domain suite, digest, address, and identity inputs before proving", function () {
    expect(() =>
      buildPersonRelationInput(child, null, null, submitter, {
        selfSuiteId: 0,
        contentDigestLo: 1,
        contentDigestHi: 2,
      }),
    ).to.throw(/selfSuiteId must be a nonzero uint32/);
    expect(() =>
      buildPersonRelationInput(child, father, null, submitter, {
        fatherSuiteId: 0,
        contentDigestLo: 1,
        contentDigestHi: 2,
      }),
    ).to.throw(/fatherSuiteId must be a nonzero uint32/);
    expect(() =>
      buildPersonRelationInput(child, null, null, submitter, {
        contentDigestLo: 1n << 128n,
        contentDigestHi: 2,
      }),
    ).to.throw(/contentDigestLo must be a uint128/);
    expect(() =>
      buildPersonRelationInput(child, null, null, 1n << 160n, {
        contentDigestLo: 1,
        contentDigestHi: 2,
      }),
    ).to.throw(/submitter must be a uint160/);
    expect(() => computePersonHashFromInput({ ...child, gender: 256 })).to.throw(/gender/);
  });

  it("builds and validates DisclosureBinding with the same role suite commitment", function () {
    const built = buildDisclosureBindingInput(child, submitter, { selfSuiteId: 2 });
    const expected = [
      built.person.identityCommitment,
      built.disclosureBinding,
      built.minter,
      built.suiteCommitment,
    ];
    expect(built).to.include({ circuitId: 1, proofEncodingId: 1 });
    expect(built.input.selfSuiteId).to.equal("2");
    expect(built.suiteCommitment).to.equal(poseidon4([1000n, 2n, 0n, 0n]));
    expect(() => assertDisclosureBindingPublicSignalsMatch(built, expected)).not.to.throw();

    ["identityCommitment", "disclosureBinding", "minter", "suiteCommitment"].forEach(
      (name, index) => {
        const mismatched = [...expected];
        mismatched[index] += 1n;
        expect(() => assertDisclosureBindingPublicSignalsMatch(built, mismatched)).to.throw(
          `${name} public signal mismatch`,
        );
      },
    );
  });
});

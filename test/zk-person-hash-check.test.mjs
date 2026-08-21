import { expect } from "chai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validatePersonCommitmentInput,
  computeExpectedSignals,
  comparePublicSignals,
  parseArgs,
  loadPublicSignals,
  loadJson,
} from "../tasks/zk-person-hash-check.mjs";
import personCommitmentProof from "../lib/personCommitmentProof.js";

const { buildPersonRelationInput } = personCommitmentProof;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("zk-person-hash-check helpers", function () {
  describe("validatePersonCommitmentInput", function () {
    it("normalizes current person-commitment input shape", function () {
      const raw = {
        nameField: "123",
        derivedSecretField: 0,
        isBirthBC: 0,
        birthYear: "1990",
        birthMonth: 5,
        birthDay: "15",
        gender: 1,
        selfSuiteId: 2,
        hasFather: 0,
        hasMother: 0,
        submitter: "4660",
        contentDigestLo: 7,
        contentDigestHi: 8,
      };
      const validated = validatePersonCommitmentInput(raw);
      expect(validated.nameField).to.equal(123n);
      expect(validated.derivedSecretField).to.equal(0n);
      expect(validated.birthYear).to.equal(1990n);
      expect(validated.birthMonth).to.equal(5n);
      expect(validated.birthDay).to.equal(15n);
      expect(validated.submitter).to.equal(4660n);
      expect(validated.hasFather).to.equal(0n);
      expect(validated.hasMother).to.equal(0n);
      expect(validated.fatherNameField).to.equal(0n);
      expect(validated.motherNameField).to.equal(0n);
    });

    it("rejects malformed objects", function () {
      expect(() => validatePersonCommitmentInput(null)).to.throw(/Input JSON/);
      expect(() => validatePersonCommitmentInput({})).to.throw(/nameField/);
      expect(() =>
        validatePersonCommitmentInput({
          nameField: 1,
          derivedSecretField: 0,
          isBirthBC: 0,
          birthYear: 1,
          birthMonth: 1,
          birthDay: 1,
          gender: 1,
          selfSuiteId: 1,
          hasFather: 2,
          hasMother: 0,
          submitter: 1,
          contentDigestLo: 7,
          contentDigestHi: 8,
        }),
      ).to.throw(/hasFather must be 0 or 1/);
    });
  });

  describe("computeExpectedSignals", function () {
    it("matches the active person-commitment helper semantics", async function () {
      const built = buildPersonRelationInput(
        {
          fullName: "Child Example",
          derivedSecretField: 0n,
          isBirthBC: false,
          birthYear: 2000,
          birthMonth: 1,
          birthDay: 2,
          gender: 1,
        },
        {
          fullName: "Father Example",
          derivedSecretField: 0n,
          isBirthBC: false,
          birthYear: 1970,
          birthMonth: 3,
          birthDay: 4,
          gender: 1,
        },
        {
          fullName: "Mother Example",
          derivedSecretField: 0n,
          isBirthBC: false,
          birthYear: 1972,
          birthMonth: 5,
          birthDay: 6,
          gender: 2,
        },
        "0x1234567890123456789012345678901234567890",
        {
          selfSuiteId: 2,
          fatherSuiteId: 1,
          motherSuiteId: 1,
          contentDigestLo: 7,
          contentDigestHi: 8,
        },
      );

      const expected = await computeExpectedSignals(validatePersonCommitmentInput(built.input));
      expect(expected).to.deep.equal([
        built.person.identityCommitment.toString(),
        built.father.identityCommitment.toString(),
        built.mother.identityCommitment.toString(),
        built.submitterAndSelfSuiteId.toString(),
        built.versionCommitment.toString(),
      ]);
    });
  });

  describe("comparePublicSignals", function () {
    it("detects mismatches", function () {
      const { match, mismatches } = comparePublicSignals(["1", "2"], ["1", "3"]);
      expect(match).to.equal(false);
      expect(mismatches).to.deep.equal([{ index: 1, expected: "2", actual: "3" }]);
    });
  });

  describe("parseArgs", function () {
    it("parses supported CLI flags", function () {
      const parsed = parseArgs([
        "--input",
        "input.json",
        "--public",
        "public.json",
        "--wasm",
        "a.wasm",
        "--zkey",
        "b.zkey",
        "--prove",
      ]);

      expect(parsed).to.deep.equal({
        prove: true,
        help: false,
        input: "input.json",
        public: "public.json",
        wasm: "a.wasm",
        zkey: "b.zkey",
      });
    });

    it("throws on unknown flags", function () {
      expect(() => parseArgs(["--unknown"])).to.throw(/Unknown argument/);
    });
  });

  describe("loadPublicSignals", function () {
    it("supports plain arrays and object wrappers", function () {
      const arrayPath = path.join(__dirname, "../tmp_person_public_array.json");
      const objectPath = path.join(__dirname, "../tmp_person_public_object.json");

      fs.writeFileSync(arrayPath, JSON.stringify(["1", "2"]));
      fs.writeFileSync(objectPath, JSON.stringify({ publicSignals: [1, 2] }));

      try {
        expect(loadPublicSignals(arrayPath)).to.deep.equal(["1", "2"]);
        expect(loadPublicSignals(objectPath)).to.deep.equal(["1", "2"]);
      } finally {
        fs.unlinkSync(arrayPath);
        fs.unlinkSync(objectPath);
      }
    });
  });

  describe("loadJson", function () {
    it("loads JSON relative to cwd", function () {
      const filePath = path.join(__dirname, "../tmp_person_input.json");
      fs.writeFileSync(filePath, JSON.stringify({ ok: true }));

      try {
        expect(loadJson(filePath)).to.deep.equal({ ok: true });
      } finally {
        fs.unlinkSync(filePath);
      }
    });
  });
});

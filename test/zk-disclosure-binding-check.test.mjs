import { expect } from "chai";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  validateDisclosureBindingInput,
  computeExpectedSignals,
  comparePublicSignals,
  parseArgs,
  loadPublicSignals,
  loadJson,
} from "../tasks/zk-disclosure-binding-check.mjs";
import disclosureBindingProof from "../lib/disclosureBindingProof.js";

const { buildDisclosureBindingInput } = disclosureBindingProof;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("zk-disclosure-binding-check helpers", function () {
  describe("validateDisclosureBindingInput", function () {
    it("normalizes current disclosure-binding input shape", function () {
      const raw = {
        nameField: "123",
        derivedSecretField: 0,
        packedBirthGenderField: "456",
        minter: "4660",
        selfSuiteId: 2,
      };
      const validated = validateDisclosureBindingInput(raw);
      expect(validated.nameField).to.equal(123n);
      expect(validated.derivedSecretField).to.equal(0n);
      expect(validated.packedBirthGenderField).to.equal(456n);
      expect(validated.minter).to.equal(4660n);
    });

    it("rejects malformed objects", function () {
      expect(() => validateDisclosureBindingInput(null)).to.throw(/Input JSON/);
      expect(() => validateDisclosureBindingInput({})).to.throw(/nameField/);
    });
  });

  describe("computeExpectedSignals", function () {
    it("matches the active disclosure-binding helper semantics", async function () {
      const built = buildDisclosureBindingInput(
        {
          fullName: "  Alice　Smith  ",
          derivedSecretField: 0n,
          isBirthBC: false,
          birthYear: 1990,
          birthMonth: 5,
          birthDay: 15,
          gender: 1,
        },
        "0x1234567890123456789012345678901234567890",
        { selfSuiteId: 2 },
      );

      const expected = await computeExpectedSignals(validateDisclosureBindingInput(built.input));
      expect(expected).to.deep.equal([
        built.person.identityCommitment.toString(),
        built.disclosureBinding.toString(),
        built.input.minter,
        built.suiteCommitment.toString(),
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
      const arrayPath = path.join(__dirname, "../tmp_public_array.json");
      const objectPath = path.join(__dirname, "../tmp_public_object.json");

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
      const filePath = path.join(__dirname, "../tmp_disclosure_input.json");
      fs.writeFileSync(filePath, JSON.stringify({ ok: true }));

      try {
        expect(loadJson(filePath)).to.deep.equal({ ok: true });
      } finally {
        fs.unlinkSync(filePath);
      }
    });
  });
});

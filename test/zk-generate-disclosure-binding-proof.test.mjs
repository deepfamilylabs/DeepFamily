import { expect } from "chai";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import disclosureBindingProof from "../lib/disclosureBindingProof.js";
import {
  buildDisclosureBindingTaskInput,
  normalizeNameForHash,
  parseDisclosureBindingPersonArgs,
  resolveExistingFile,
} from "../tasks/zk-generate-disclosure-binding-proof.mjs";

const { buildDisclosureBindingInput } = disclosureBindingProof;

describe("zk-generate-disclosure-binding-proof helpers", function () {
  describe("normalizeNameForHash", function () {
    it("canonicalizes whitespace variants", function () {
      expect(normalizeNameForHash("  Alice　Smith  ")).to.equal("Alice Smith");
    });
  });

  describe("parseDisclosureBindingPersonArgs", function () {
    it("parses current disclosure-binding person fields", function () {
      const person = parseDisclosureBindingPersonArgs({
        fullname: "Alice Smith",
        derivedsecretfield: "7",
        birthbc: "false",
        birthyear: "1990",
        birthmonth: "5",
        birthday: "15",
        gender: "1",
      });

      expect(person).to.deep.equal({
        fullName: "Alice Smith",
        derivedSecretField: 7n,
        isBirthBC: false,
        birthYear: 1990,
        birthMonth: 5,
        birthDay: 15,
        gender: 1,
      });
    });

    it("rejects invalid numeric ranges", function () {
      expect(() =>
        parseDisclosureBindingPersonArgs({
          fullname: "Alice Smith",
          birthyear: "70000",
          birthmonth: "5",
          birthday: "15",
          gender: "1",
        }),
      ).to.throw(/birthYear/);
    });

    it("accepts the full uint8 gender range and rejects values above it", function () {
      const args = {
        fullname: "Custom Gender",
        birthyear: "1990",
        birthmonth: "5",
        birthday: "15",
      };

      expect(parseDisclosureBindingPersonArgs({ ...args, gender: "255" }).gender).to.equal(255);
      expect(() => parseDisclosureBindingPersonArgs({ ...args, gender: "256" })).to.throw(
        /gender must be an integer in \[0, 255\]/,
      );
    });
  });

  describe("buildDisclosureBindingTaskInput", function () {
    it("matches the active disclosure-binding helper output", function () {
      const args = {
        fullname: "  Alice　Smith  ",
        derivedsecretfield: "0",
        birthbc: "false",
        birthyear: "1990",
        birthmonth: "5",
        birthday: "15",
        gender: "1",
        selfsuiteid: "2",
        minter: "0x1234567890123456789012345678901234567890",
      };

      const taskBuilt = buildDisclosureBindingTaskInput(args);
      const expected = buildDisclosureBindingInput(
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

      expect(taskBuilt.built.input).to.deep.equal(expected.input);
      expect(taskBuilt.built.canonicalFullName).to.equal("Alice Smith");
      expect(taskBuilt.built.disclosureBinding).to.equal(expected.disclosureBinding);
    });
  });

  describe("resolveExistingFile", function () {
    const tempDirs = [];

    afterEach(function () {
      while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("prefers explicit paths", function () {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "disclosure-explicit-"));
      tempDirs.push(dir);
      const filePath = path.join(dir, "target.txt");
      fs.writeFileSync(filePath, "hello");

      const resolved = resolveExistingFile("target", filePath, []);
      expect(resolved).to.equal(filePath);
    });

    it("falls back to candidate list", function () {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "disclosure-candidate-"));
      tempDirs.push(dir);
      const filePath = path.join(dir, "candidate.txt");
      fs.writeFileSync(filePath, "hello");

      const resolved = resolveExistingFile("target", "", [filePath]);
      expect(resolved).to.equal(filePath);
    });

    it("throws when nothing is found", function () {
      expect(() => resolveExistingFile("missing", "", [])).to.throw(/Unable to locate missing/);
    });
  });
});

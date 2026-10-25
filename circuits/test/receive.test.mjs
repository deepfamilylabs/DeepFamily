import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WitnessCalculatorBuilder } from "circom_runtime";
import { assertConstraintViolation } from "./constraint_assertions.mjs";
import {
  receiveCodeFixture,
  eligibilityFixture,
  capabilityFixture,
} from "./receive_fixture.mjs";

const root = path.resolve(import.meta.dirname, "../..");
async function compile(out, name) {
  execFileSync(
    path.join(root, "bin/circom"),
    [
      `circuits/${name}.circom`,
      "--r1cs",
      "--wasm",
      "--O2",
      "--sanity_check",
      "2",
      "-l",
      "node_modules",
      "-l",
      "node_modules/circomlib/circuits",
      "-o",
      out,
    ],
    { cwd: root, stdio: "pipe" },
  );
  return WitnessCalculatorBuilder(fs.readFileSync(path.join(out, `${name}_js/${name}.wasm`)), {
    singleThread: true,
  });
}

test("receive issuance, independent receive code and optional capabilities", async (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-receive-"));
  try {
    const code = await compile(out, "receive_code");
    const issue = await compile(out, "eligibility_issue");
    const cap = await compile(out, "budget_capability");
    const valid = async (calc, fixture) => {
      const wires = await calc.calculateWitness(fixture.witness, 1);
      assert.deepEqual(wires.slice(1, fixture.publicSignals.length + 1), fixture.publicSignals);
    };
    const invalid = (calc, witness, patch) =>
      assertConstraintViolation(() => calc.calculateWitness({ ...witness, ...patch }, 1));
    const common = receiveCodeFixture();
    const issuance = eligibilityFixture();
    const capability = capabilityFixture(issuance, common);

    await t.test("a generic code needs no identity or family witness", async () => {
      await valid(code, common);
      assert.equal(common.publicSignals.length, 10);
      for (const name of ["identityCommitment", "familyRoot", "endorser", "credentialCommitment"])
        assert.equal(Object.hasOwn(common.witness, name), false);
      const fresh = receiveCodeFixture({
        nonce: 9002n,
        codeSecret: 334n,
        ownerSecret: 445n,
        viewKeyLo: 223n,
        viewKeyHi: 224n,
      });
      await valid(code, fresh);
      for (const i of [0, 1, 2, 5, 6, 7, 8])
        assert.notEqual(common.publicSignals[i], fresh.publicSignals[i]);
      for (const patch of [
        { ownerCommitment: "1" },
        { ownerSecret: "0" },
        { codeRootSecret: "0" },
        { codeSecret: "0" },
        { nonce: "0" },
        { expiresAt: "0" },
        { expiresAt: String(1n << 64n) },
        { chainId: "0" },
        { chainId: String(1n << 64n) },
        { authorizerScope: "0" },
        { authorizerScope: String(1n << 160n) },
        { viewKeyLo: String(1n << 128n) },
        { viewKeyHi: String(1n << 128n) },
      ])
        await invalid(code, common.witness, patch);
    });

    await t.test(
      "Issue uses the production identity commitment and authenticates all role secrets",
      async () => {
        await valid(issue, issuance);
        assert.equal(issuance.publicSignals.length, 5);
        for (const name of [
          "nameField",
          "derivedSecretField",
          "birthYear",
          "birthMonth",
          "birthDay",
          "gender",
          "suiteId",
          "parentIdentity",
          "endorser",
          "parentVersion",
          "xChild",
          "xEndorse",
          "xTrust",
          "sourceFactSalt",
          "sourceTrustSalt",
          "sourceRoot",
          "trustedRoot",
        ]) {
          await invalid(issue, issuance.witness, {
            [name]: String(BigInt(issuance.witness[name]) + 1n),
          });
        }
        for (const name of [
          "derivedSecretField",
          "familySalt",
          "issueNonce",
          "parentVersion",
          "parentIdentity",
          "endorser",
          "xChild",
          "xEndorse",
          "xTrust",
          "sourceFactSalt",
          "sourceTrustSalt",
          "credentialSalt",
        ]) {
          await invalid(issue, issuance.witness, { [name]: "0" });
        }
        const boundary = eligibilityFixture({
          sourceDepth: 64n,
          sourceIndex: (1n << 63n) + 3n,
          sourceSiblings: Array.from({ length: 64 }, (_, i) => BigInt(i + 1)),
          trustedDepth: 64n,
          trustedIndex: 13n,
          trustedSiblings: Array.from({ length: 64 }, (_, i) => BigInt(i + 101)),
        });
        await valid(issue, boundary);
        await invalid(issue, boundary.witness, { sourceIndex: "2" });
        await invalid(issue, boundary.witness, { trustedIndex: "12" });
        for (const patch of [
          { sourceDepth: "65" },
          { trustedDepth: "65" },
          { sourceIndex: String(1n << 64n) },
          { trustedIndex: String(1n << 64n) },
        ])
          await invalid(issue, boundary.witness, patch);
      },
    );

    await t.test("capability commits hidden qualification to the exact common code", async () => {
      await valid(cap, capability);
      assert.equal(capability.publicSignals.length, 10);
      for (const name of [
        "commonBinding",
        "issuanceRoot",
        "chainId",
        "authorizerScope",
        "parentVersion",
        "derivedSecretField",
        "issueNonce",
        "familyRoot",
        "endorser",
        "xChild",
        "xEndorse",
        "xTrust",
        "credentialSalt",
        "nonce",
        "ownerCommitment",
        "viewKeyLo",
        "viewKeyHi",
        "expiresAt",
        "codeSecret",
        "ownerSecret",
      ]) {
        await invalid(cap, capability.witness, {
          [name]: String(BigInt(capability.witness[name]) + 1n),
        });
      }
      const boundary = capabilityFixture(issuance, common, {
        credentialDepth: 32n,
        credentialIndex: (1n << 31n) + 3n,
        credentialSiblings: Array.from({ length: 32 }, (_, i) => BigInt(i + 1)),
      });
      await valid(cap, boundary);
      await invalid(cap, boundary.witness, { credentialIndex: "2" });
      await invalid(cap, boundary.witness, { credentialDepth: "33" });
      await invalid(cap, boundary.witness, { credentialIndex: String(1n << 32n) });
    });

    await t.test(
      "different issuances and parent capabilities bind one canonical subject and one code",
      async () => {
        const mother = eligibilityFixture({
          parentIdentity: 998877n,
          familySalt: 887766n,
          issueNonce: 776655n,
          parentVersion: 2n,
          xChild: 665544n,
          xEndorse: 554433n,
          xTrust: 443322n,
          credentialSalt: 332211n,
        });
        await valid(issue, mother);
        const second = capabilityFixture(mother, common);
        await valid(cap, second);
        assert.equal(capability.publicSignals[8], second.publicSignals[8]);
        assert.notEqual(capability.publicSignals[0], second.publicSignals[0]);
        assert.notEqual(capability.publicSignals[1], second.publicSignals[1]);
        const otherSubject = eligibilityFixture({ derivedSecretField: 111111n });
        const splice = capabilityFixture(otherSubject, common);
        await invalid(cap, splice.witness, {});
        // A second code is independently authorized and does not share alias,
        // receiving keys or role tags with the first code.
        const fresh = receiveCodeFixture({
          nonce: 9002n,
          codeSecret: 335n,
          ownerSecret: 446n,
          viewKeyLo: 225n,
          viewKeyHi: 226n,
        });
        await valid(code, fresh);
        const freshCap = capabilityFixture(issuance, fresh);
        await valid(cap, freshCap);
        for (let i = 0; i < 5; i++)
          assert.notEqual(capability.publicSignals[i], freshCap.publicSignals[i]);
      },
    );
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WitnessCalculatorBuilder } from "circom_runtime";
import { assertConstraintViolation } from "./constraint_assertions.mjs";
import { eligibilityFixture } from "./receive_fixture.mjs";
import {
  sourceFactFixture,
  sourceTrustFixture,
} from "./eligibility_source_fixture.mjs";
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

test("source bridge authenticates actual lineage facts and hidden role openings", async (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-eligibility-source-"));
  try {
    const fact = await compile(out, "eligibility_source_fact");
    const trust = await compile(out, "eligibility_source_trust");
    const valid = async (calc, f) => {
      const wires = await calc.calculateWitness(f.witness, 1);
      assert.deepEqual(wires.slice(1, f.publicSignals.length + 1), f.publicSignals);
    };
    const invalid = (calc, f, patch) =>
      assertConstraintViolation(() => calc.calculateWitness({ ...f.witness, ...patch }, 1));
    await t.test(
      "source fact matches exact deployed endorsement leaf and Issue opening",
      async () => {
        const example = sourceFactFixture();
        await valid(fact, example);
        assert.equal(example.publicSignals[0], eligibilityFixture().sourceLeaf);
        for (const name of [
          "childIdentity",
          "endorser",
          "childVersion",
          "fatherIdentity",
          "motherIdentity",
          "rootIsMother",
          "writtenAt",
          "endorsementRoot",
        ])
          await invalid(fact, example, { [name]: String(BigInt(example.witness[name]) + 1n) });
        await invalid(fact, sourceFactFixture({ parentIdentity: 777777n }), {});
        await valid(
          fact,
          sourceFactFixture({ rootIsMother: 1n, parentIdentity: 998877n }),
        );
        for (const name of [
          "chainId",
          "sourceAddress",
          "childIdentity",
          "parentIdentity",
          "endorser",
          "parentVersion",
          "childVersion",
          "xChild",
          "xEndorse",
          "sourceFactSalt",
        ])
          await invalid(fact, example, { [name]: "0" });
        for (const patch of [
          { chainId: String(1n << 64n) },
          { sourceAddress: String(1n << 160n) },
          { endorser: String(1n << 160n) },
          { childVersion: String(1n << 64n) },
          { parentVersion: String(1n << 64n) },
          { writtenAt: String(1n << 64n) },
          { endorsementDepth: "65" },
          { endorsementIndex: String(1n << 64n) },
        ])
          await invalid(fact, example, patch);
      },
    );
    await t.test("source trust matches exact deployed trusted leaf and Issue opening", async () => {
      const example = sourceTrustFixture();
      await valid(trust, example);
      assert.equal(example.publicSignals[0], eligibilityFixture().trustedLeaf);
      for (const name of ["parentIdentity", "endorser", "parentVersion", "trustedRoot"])
        await invalid(trust, example, { [name]: String(BigInt(example.witness[name]) + 1n) });
      for (const name of [
        "chainId",
        "sourceAddress",
        "parentIdentity",
        "endorser",
        "parentVersion",
        "xTrust",
        "sourceTrustSalt",
      ])
        await invalid(trust, example, { [name]: "0" });
      for (const patch of [
        { chainId: String(1n << 64n) },
        { sourceAddress: String(1n << 160n) },
        { endorser: String(1n << 160n) },
        { parentVersion: String(1n << 64n) },
        { trustedDepth: "65" },
        { trustedIndex: String(1n << 64n) },
      ])
        await invalid(trust, example, patch);
    });
    await t.test(
      "source roles cannot be swapped after a source leaf is authenticated",
      async () => {
        // A source publisher may create a new commitment, but Issue cannot use a
        // different role secret under an already authenticated source tree root.
        // This joining obligation is exercised by the Issue constraint test too.
        const originalFact = sourceFactFixture();
        const changedFact = sourceFactFixture({ xChild: 123123n, xEndorse: 321321n });
        await valid(fact, changedFact);
        assert.notEqual(originalFact.publicSignals[0], changedFact.publicSignals[0]);
        assert.notEqual(originalFact.publicSignals[1], changedFact.publicSignals[1]);
        assert.notEqual(originalFact.publicSignals[2], changedFact.publicSignals[2]);
        const changedTrust = sourceTrustFixture({ xTrust: 456456n });
        await valid(trust, changedTrust);
        assert.notEqual(
          sourceTrustFixture().publicSignals[0],
          changedTrust.publicSignals[0],
        );
      },
    );
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

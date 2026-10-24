import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WitnessCalculatorBuilder } from "circom_runtime";
import { poseidon2 } from "poseidon-lite";
import { buildShieldedClaimFixture } from "./generate_shielded_claim_input.mjs";
import { assertConstraintViolation } from "./constraint_assertions.mjs";

const root = path.resolve(import.meta.dirname, "../..");
function extend(witness, prefix, depth) {
  let hash = BigInt(witness[`${prefix}Root`]);
  for (let level = Number(witness[`${prefix}Depth`]); level < depth; level++) {
    const sibling = BigInt(10000 + level);
    witness[`${prefix}Siblings`][level] = String(sibling);
    hash = poseidon2([hash, sibling]);
  }
  witness[`${prefix}Depth`] = String(depth);
  witness[`${prefix}Root`] = String(hash);
}
function for32(witness) {
  return {
    ...witness,
    endorsementSiblings: witness.endorsementSiblings.slice(0, 32),
    trustedSiblings: witness.trustedSiblings.slice(0, 32),
  };
}

test("claim variants share roots and reject paths outside their capacity", async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-claim32-test-"));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const calculators = {};
  for (const name of ["shielded_claim", "shielded_claim32"]) {
    execFileSync(
      path.join(root, "bin/circom"),
      [
        `circuits/${name}.circom`,
        "--wasm",
        "--O2",
        "--sanity_check",
        "2",
        "-l",
        "node_modules",
        "-l",
        "node_modules/circomlib/circuits",
        "-o",
        output,
      ],
      { cwd: root, stdio: "pipe" },
    );
    calculators[name] = await WitnessCalculatorBuilder(
      fs.readFileSync(path.join(output, `${name}_js/${name}.wasm`)),
      { singleThread: true },
    );
  }
  await t.test("identical roots and public signals at the 32-level boundary", async () => {
    for (const options of [{ keyMode: 0 }, { keyMode: 1 }, { budgetKind: 1 }]) {
      const { witness } = buildShieldedClaimFixture({ ...options, claimCount: 3 });
      extend(witness, "endorsement", 32);
      // The trusted input names use trustedRoot, just like the endorsement path.
      extend(witness, "trusted", 32);
      const standard = await calculators.shielded_claim.calculateWitness(witness, true);
      const compact = await calculators.shielded_claim32.calculateWitness(for32(witness), true);
      assert.deepEqual(compact.slice(1, 16), standard.slice(1, 16));
      const forged = for32(structuredClone(witness));
      forged.endorsementSiblings[31] = "1";
      await assertConstraintViolation(() =>
        calculators.shielded_claim32.calculateWitness(forged, true),
      );
    }
  });
  await t.test("either 33-level qualification path requires the 64-level variant", async () => {
    for (const prefix of ["endorsement", "trusted"]) {
      const { witness } = buildShieldedClaimFixture();
      extend(witness, prefix, 33);
      await calculators.shielded_claim.calculateWitness(witness, true);
      await assertConstraintViolation(() =>
        calculators.shielded_claim32.calculateWitness(for32(witness), true),
      );
    }
  });
});

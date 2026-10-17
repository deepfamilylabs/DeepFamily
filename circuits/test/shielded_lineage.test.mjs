// Run with: node --test circuits/test/shielded_lineage.test.mjs
// Rebuild both lineage trees after changing a statement field so a stale hash
// cannot hide a missing relationship, authorization or range constraint.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WitnessCalculatorBuilder } from "circom_runtime";
import { poseidon3, poseidon4, poseidon5 } from "poseidon-lite";
import {
  buildLineageMerkleProof,
  createLineageTree,
  SNARK_SCALAR_FIELD,
} from "@deepfamily/protocol-core";
import { assertConstraintViolation } from "./constraint_assertions.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT160 = (1n << 160n) - 1n;
const field = (value) => ((value % SNARK_SCALAR_FIELD) + SNARK_SCALAR_FIELD) % SNARK_SCALAR_FIELD;

function lineageWitness(overrides = {}, leafEndorsers = {}) {
  const fields = {
    enabled: 1n,
    heirIdentityCommitment: 131n,
    fatherIdentityCommitment: 101n,
    motherIdentityCommitment: 103n,
    rootIsMother: 0n,
    rootVersionIndex: 3n,
    heirVersionIndex: 5n,
    endorser: BigInt("0x1111111111111111111111111111111111111111"),
    writtenAt: 900n,
    asOf: 1000n,
    ...overrides,
  };
  fields.rootIdentityCommitment ??=
    fields.rootIsMother === 1n ? fields.motherIdentityCommitment : fields.fatherIdentityCommitment;
  const parents = poseidon3([
    1009n,
    fields.fatherIdentityCommitment,
    fields.motherIdentityCommitment,
  ]);
  const endorsementLeaf = poseidon5([
    1007n,
    fields.heirIdentityCommitment,
    parents,
    fields.heirVersionIndex,
    field((fields.writtenAt << 160n) + (leafEndorsers.endorsement ?? fields.endorser)),
  ]);
  const trustedLeaf = poseidon4([
    1008n,
    fields.rootIdentityCommitment,
    fields.rootVersionIndex,
    leafEndorsers.trusted ?? fields.endorser,
  ]);
  const endorsement = buildLineageMerkleProof(
    createLineageTree([11n, endorsementLeaf, 33n, 44n, 55n]),
    1,
  );
  const trusted = buildLineageMerkleProof(createLineageTree([77n, 88n, trustedLeaf]), 2);
  return {
    ...Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, String(value)])),
    endorsementRoot: String(endorsement.root),
    endorsementDepth: String(endorsement.depth),
    endorsementIndex: String(endorsement.index),
    endorsementSiblings: endorsement.siblings.map(String),
    trustedRoot: String(trusted.root),
    trustedDepth: String(trusted.depth),
    trustedIndex: String(trusted.index),
    trustedSiblings: trusted.siblings.map(String),
  };
}

test("current direct-child lineage constraints with independently rebuilt roots", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-lineage-constraints-"));
  try {
    const name = "direct_child_current";
    const source = path.join(directory, `${name}.circom`);
    fs.writeFileSync(
      source,
      `pragma circom 2.2.3;
include "shielded_lineage_common.circom";
component main = ShieldedDirectChildCurrent();
`,
    );
    execFileSync(
      path.join(repoRoot, "bin/circom"),
      [
        source,
        "--r1cs",
        "--wasm",
        "--O2",
        "--sanity_check",
        "2",
        "-l",
        "circuits",
        "-l",
        "node_modules",
        "-l",
        "node_modules/circomlib/circuits",
        "-o",
        directory,
      ],
      { cwd: repoRoot, stdio: "pipe" },
    );
    const calculator = await WitnessCalculatorBuilder(
      fs.readFileSync(path.join(directory, `${name}_js/${name}.wasm`)),
      { singleThread: true },
    );
    const valid = async (witness) => {
      assert.equal((await calculator.calculateWitness(witness, 1))[0], 1n);
    };
    const invalid = (witness) =>
      assertConstraintViolation(() => calculator.calculateWitness(witness, 1));

    for (const [parent, rootIsMother] of [
      ["father", 0n],
      ["mother", 1n],
    ]) {
      await t.test(
        `accepts the currently endorsed ${parent} and that version's endorser`,
        async () => {
          await valid(lineageWitness({ rootIsMother }));
        },
      );
    }
    await t.test(
      "rejects an unrelated policy root even when both memberships are valid",
      async () => {
        await invalid(lineageWitness({ rootIdentityCommitment: 107n }));
      },
    );
    await t.test("accepts an endorsement exactly at asOf and rejects the next second", async () => {
      const atBoundary = lineageWitness({ writtenAt: 1000n });
      const afterBoundary = lineageWitness({ writtenAt: 1001n });
      assert.notEqual(atBoundary.endorsementRoot, afterBoundary.endorsementRoot);
      await valid(atBoundary);
      await invalid(afterBoundary);
    });
    await t.test("accepts the uint64 time boundaries and uint160 endorser maximum", async () => {
      await valid(lineageWitness({ writtenAt: 0n, asOf: 0n }));
      await valid(
        lineageWitness({ writtenAt: MAX_UINT64, asOf: MAX_UINT64, endorser: MAX_UINT160 }),
      );
    });
    for (const [label, overrides] of [
      ["endorser above uint160", { endorser: MAX_UINT160 + 1n }],
      ["negative endorser", { endorser: -1n }],
      ["asOf above uint64", { asOf: MAX_UINT64 + 1n }],
      ["negative asOf with membership disabled", { enabled: 0n, asOf: -1n }],
      [
        "writtenAt above uint64 with membership disabled",
        { enabled: 0n, writtenAt: MAX_UINT64 + 1n },
      ],
      ["negative writtenAt with membership disabled", { enabled: 0n, writtenAt: -1n }],
    ]) {
      await t.test(`rejects ${label} with recomputed leaves and paths`, async () => {
        await invalid(lineageWitness(overrides));
      });
    }
    for (const side of ["endorsement", "trusted"]) {
      await t.test(`rejects a different ${side} endorser even with that tree rebuilt`, async () => {
        await invalid(lineageWitness({}, { [side]: 12345n }));
      });
    }
    await t.test("requires Boolean enable and parent selection plus a nonzero heir", async () => {
      await invalid(lineageWitness({ enabled: 2n }));
      // Match the linear parent expression so only its Boolean selector rejects this case.
      await invalid(lineageWitness({ rootIsMother: 2n, rootIdentityCommitment: 105n }));
      await invalid(lineageWitness({ heirIdentityCommitment: 0n }));
    });
    await t.test("disables relationship, time ordering and root equality only", async () => {
      const witness = lineageWitness({
        enabled: 0n,
        rootIdentityCommitment: 107n,
        writtenAt: 1001n,
      });
      witness.endorsementRoot = "0";
      witness.trustedRoot = "0";
      await valid(witness);
      await invalid({ ...witness, enabled: "1" });
    });
    for (const tree of ["endorsement", "trusted"]) {
      await t.test(`keeps ${tree} Merkle bounds when membership is disabled`, async () => {
        const witness = lineageWitness({ enabled: 0n });
        witness[`${tree}Root`] = "0";
        await valid(witness);
        // The bare library returns root zero beyond its depth limit; matching it
        // must not let the disabled branch bypass the enclosing range checks.
        await invalid({ ...witness, [`${tree}Depth`]: "65" });
        await invalid({ ...witness, [`${tree}Index`]: String(1n << 64n) });
      });
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

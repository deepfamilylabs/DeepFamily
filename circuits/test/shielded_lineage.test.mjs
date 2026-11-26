// Run with: node --test circuits/test/shielded_lineage.test.mjs
// Rebuild both lineage trees after changing a statement field so a stale hash
// cannot hide a missing relationship, authorization or range constraint.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { circomIncludeArguments } from "../../scripts/lib/circomToolchain.mjs";
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
    heirIdentityCommitment: 131n,
    fatherIdentityCommitment: 101n,
    motherIdentityCommitment: 103n,
    rootIsMother: 0n,
    rootVersionIndex: 3n,
    heirVersionIndex: 5n,
    endorser: BigInt("0x1111111111111111111111111111111111111111"),
    writtenAt: 900n,
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
  // The template selects the root itself; the value here only builds the trusted leaf.
  const { rootIdentityCommitment: _root, ...inputs } = fields;
  return {
    ...Object.fromEntries(Object.entries(inputs).map(([name, value]) => [name, String(value)])),
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
include "shielded/common/shielded_lineage_common.circom";
component main = ShieldedDirectChildCurrent(64);
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
        ...circomIncludeArguments(),
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
      const wires = await calculator.calculateWitness(witness, 1);
      assert.equal(wires[0], 1n);
      // The only output is the selected parent, which callers bind into their policy.
      const selected =
        witness.rootIsMother === "1"
          ? witness.motherIdentityCommitment
          : witness.fatherIdentityCommitment;
      assert.equal(wires[1], BigInt(selected));
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
    await t.test("binds the exact write time in the endorsement leaf", async () => {
      const witness = lineageWitness({ writtenAt: 1000n });
      await valid(witness);
      await invalid({ ...witness, writtenAt: "1001" });
    });
    await t.test(
      "accepts the uint64 write-time boundaries and uint160 endorser maximum",
      async () => {
        await valid(lineageWitness({ writtenAt: 0n }));
        await valid(lineageWitness({ writtenAt: MAX_UINT64, endorser: MAX_UINT160 }));
      },
    );
    for (const [label, overrides] of [
      ["endorser above uint160", { endorser: MAX_UINT160 + 1n }],
      ["negative endorser", { endorser: -1n }],
      ["writtenAt above uint64", { writtenAt: MAX_UINT64 + 1n }],
      ["negative writtenAt", { writtenAt: -1n }],
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
    await t.test("requires a Boolean parent selection plus a nonzero heir", async () => {
      // Match the linear parent expression so only its Boolean selector rejects this case.
      await invalid(lineageWitness({ rootIsMother: 2n, rootIdentityCommitment: 105n }));
      await invalid(lineageWitness({ heirIdentityCommitment: 0n }));
    });
    await t.test("rejects an absent selected parent even with its trusted leaf present", async () => {
      await invalid(lineageWitness({ fatherIdentityCommitment: 0n }));
      await invalid(lineageWitness({ rootIsMother: 1n, motherIdentityCommitment: 0n }));
    });
    for (const tree of ["endorsement", "trusted"]) {
      await t.test(`enforces ${tree} Merkle bounds and root membership`, async () => {
        const witness = lineageWitness();
        await invalid({ ...witness, [`${tree}Root`]: "0" });
        await invalid({ ...witness, [`${tree}Depth`]: "65" });
        await invalid({ ...witness, [`${tree}Index`]: String(1n << 64n) });
      });
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

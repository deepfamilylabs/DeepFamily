// Run with: node --test circuits/test/shielded_helpers.test.mjs
// Compile temporary harnesses so boundary failures cannot be explained by
// stale commitments elsewhere in an action's witness.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WitnessCalculatorBuilder } from "circom_runtime";
import { poseidon2, poseidon3, poseidon8 } from "poseidon-lite";
import { shieldedFixtureTag } from "./shielded_scope_fixture.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const purposes = [1010, 1011, 1014, 1015, 1016, 1017, 1019, 1021, 1026, 1027, 1028, 1029, 1030];
const fieldPrime = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const field = (value) => ((value % fieldPrime) + fieldPrime) % fieldPrime;

async function compile(directory, name, source) {
  const circuit = path.join(directory, `${name}.circom`);
  fs.writeFileSync(circuit, source);
  execFileSync(
    path.join(repoRoot, "bin/circom"),
    [
      circuit,
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
  return {
    valid: async (witness) => {
      assert.equal((await calculator.calculateWitness(witness, 1))[0], 1n);
    },
    invalid: async (witness) => {
      const originalError = console.error;
      console.error = () => {};
      try {
        await assert.rejects(() => calculator.calculateWitness(witness, 1));
      } finally {
        console.error = originalError;
      }
    },
  };
}

function merkleSource(maxDepth, gated = false) {
  return `pragma circom 2.2.3;
include "shielded_merkle_common.circom";
template MembershipCheck() {
    signal input leaf;
    signal input root;
    signal input depth;
    signal input index;
    signal input siblings[${maxDepth}];
    ${gated ? "signal input enabled;\n    enabled * (enabled - 1) === 0;" : ""}
    component membership = ShieldedMerkleRoot(${maxDepth});
    membership.leaf <== leaf;
    membership.depth <== depth;
    membership.index <== index;
    membership.siblings <== siblings;
    ${gated ? "enabled * (membership.out - root) === 0;" : "membership.out === root;"}
}
component main = MembershipCheck();`;
}

function membershipWitness(maxDepth, index, depth = maxDepth) {
  const leaf = 12345n;
  const siblings = Array.from({ length: maxDepth }, (_, level) => BigInt(1000 + level));
  let root = leaf;
  for (let level = 0; level < depth; level += 1) {
    root =
      ((index >> BigInt(level)) & 1n) === 1n
        ? poseidon2([siblings[level], root])
        : poseidon2([root, siblings[level]]);
  }
  return {
    leaf: String(leaf),
    root: String(root),
    depth: String(depth),
    index: String(index),
    siblings: siblings.map(String),
  };
}

function budgetBindingSource() {
  return `pragma circom 2.2.3;
include "shielded_funding_common.circom";
template BudgetBindingCheck() {
    signal input chainId;
    signal input pool;
    signal input budgetKind;
    signal input policyCommitment;
    signal input enrollmentCommitment;
    signal input termsCommitment;
    signal input ownerCommitment;
    signal input rate;
    signal input remaining;
    signal input nonce;
    signal input ciphertextHash;
    signal input expectedCommitment;
    component scope = ShieldedPoolDomain();
    scope.chainId <== chainId;
    scope.pool <== pool;
    component tags = ShieldedBudgetNoteTags();
    tags.poolDomain <== scope.domain;
    component note = ShieldedBoundBudgetCommitment();
    note.privateNoteTag <== tags.privateNoteTag;
    note.identityNoteTag <== tags.identityNoteTag;
    note.budgetKind <== budgetKind;
    note.policyCommitment <== policyCommitment;
    note.enrollmentCommitment <== enrollmentCommitment;
    note.termsCommitment <== termsCommitment;
    note.ownerCommitment <== ownerCommitment;
    note.rate <== rate;
    note.remaining <== remaining;
    note.nonce <== nonce;
    note.ciphertextHash <== ciphertextHash;
    note.commitment === expectedCommitment;
}
component main = BudgetBindingCheck();`;
}

function budgetBindingWitness(budgetKind) {
  const witness = {
    chainId: "31337",
    pool: String(0x1111111111111111111111111111111111111111n),
    budgetKind: String(budgetKind),
    policyCommitment: "2100",
    enrollmentCommitment: "2101",
    termsCommitment: "2102",
    ownerCommitment: "2103",
    rate: "100",
    remaining: "300",
    nonce: "2104",
    ciphertextHash: "2105",
  };
  witness.expectedCommitment = String(
    poseidon8([
      shieldedFixtureTag(budgetKind === 0 ? 1015 : 1030, witness.chainId, witness.pool),
      BigInt(witness.policyCommitment),
      BigInt(witness.enrollmentCommitment),
      BigInt(budgetKind === 0 ? witness.ownerCommitment : witness.termsCommitment),
      BigInt(witness.rate),
      BigInt(witness.remaining),
      BigInt(witness.nonce),
      BigInt(witness.ciphertextHash),
    ]),
  );
  return witness;
}

test("shielded shared domain and Merkle constraints", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-shielded-helpers-"));
  try {
    const domain = await compile(
      directory,
      "pool_domain",
      `pragma circom 2.2.3;
include "shielded_scope_common.circom";
template DomainCheck() {
    signal input chainId;
    signal input pool;
    signal input expectedDomain;
    signal input expectedTags[${purposes.length}];
    component scope = ShieldedPoolDomain();
    scope.chainId <== chainId;
    scope.pool <== pool;
    scope.domain === expectedDomain;
    component tags[${purposes.length}];
    var purposes[${purposes.length}] = [${purposes.join(",")}];
    for (var i = 0; i < ${purposes.length}; i++) {
        tags[i] = ShieldedScopedTag();
        tags[i].poolDomain <== scope.domain;
        tags[i].purpose <== purposes[i];
        tags[i].tag === expectedTags[i];
    }
}
component main = DomainCheck();`,
    );
    const domainWitness = (chainId, pool) => ({
      chainId: String(chainId),
      pool: String(pool),
      expectedDomain: String(poseidon3([1031n, chainId, pool])),
      expectedTags: purposes.map((purpose) => String(shieldedFixtureTag(purpose, chainId, pool))),
    });
    await t.test(
      "one shared domain preserves every pool-local purpose at uint boundaries",
      async () => {
        await domain.valid(domainWitness(1n, 1n));
        await domain.valid(domainWitness((1n << 64n) - 1n, (1n << 160n) - 1n));
      },
    );
    await t.test(
      "zero and oversized chain/pool reject even when all tags are recomputed",
      async () => {
        for (const [chainId, pool] of [
          [0n, 1n],
          [1n, 0n],
          [1n << 64n, 1n],
          [1n, 1n << 160n],
        ]) {
          await domain.invalid(domainWitness(chainId, pool));
        }
      },
    );
    const budget = await compile(directory, "budget_binding", budgetBindingSource());
    await t.test(
      "shared budget tags retain distinct private owner and public terms bindings",
      async () => {
        for (const budgetKind of [0, 1]) {
          const witness = budgetBindingWitness(budgetKind);
          await budget.valid(witness);
          const binding = budgetKind === 0 ? "ownerCommitment" : "termsCommitment";
          const unusedBinding = budgetKind === 0 ? "termsCommitment" : "ownerCommitment";
          await budget.invalid({ ...witness, [binding]: String(BigInt(witness[binding]) + 1n) });
          await budget.valid({
            ...witness,
            [unusedBinding]: String(BigInt(witness[unusedBinding]) + 1n),
          });
          await budget.invalid({ ...witness, budgetKind: String(1 - budgetKind) });
          for (const invalidKind of ["2", "-1"]) {
            // A matching interpolated note isolates the Boolean guard instead
            // of failing merely because expectedCommitment became stale.
            const selector = BigInt(invalidKind);
            const privateTag = shieldedFixtureTag(1015, witness.chainId, witness.pool);
            const identityTag = shieldedFixtureTag(1030, witness.chainId, witness.pool);
            const owner = BigInt(witness.ownerCommitment);
            await budget.invalid({
              ...witness,
              budgetKind: invalidKind,
              expectedCommitment: String(
                poseidon8([
                  field(privateTag + selector * (identityTag - privateTag)),
                  BigInt(witness.policyCommitment),
                  BigInt(witness.enrollmentCommitment),
                  field(owner + selector * (BigInt(witness.termsCommitment) - owner)),
                  BigInt(witness.rate),
                  BigInt(witness.remaining),
                  BigInt(witness.nonce),
                  BigInt(witness.ciphertextHash),
                ]),
              ),
            });
          }
        }
      },
    );
    for (const maxDepth of [32, 64]) {
      const merkle = await compile(directory, `membership_${maxDepth}`, merkleSource(maxDepth));
      await t.test(
        `${maxDepth}-level helper preserves zero-depth and compact promoted leaves`,
        async () => {
          await merkle.valid({
            leaf: "0",
            root: "0",
            depth: "0",
            index: "0",
            siblings: Array(maxDepth).fill("0"),
          });
          await merkle.valid({
            leaf: "123",
            root: "123",
            depth: "0",
            index: "0",
            siblings: Array(maxDepth).fill("456"),
          });
          const leftSubtree = poseidon2([10n, 20n]);
          await merkle.valid({
            leaf: "30",
            root: String(poseidon2([leftSubtree, 30n])),
            depth: "1",
            index: "1",
            siblings: [String(leftSubtree), ...Array(maxDepth - 1).fill("0")],
          });
        },
      );
      await t.test(
        `${maxDepth}-level helper accepts its exact limit and binds every sibling`,
        async () => {
          const witness = membershipWitness(maxDepth, (1n << BigInt(maxDepth)) - 1n);
          await merkle.valid(witness);
          const forged = structuredClone(witness);
          forged.siblings[maxDepth - 1] = String(BigInt(forged.siblings[maxDepth - 1]) + 1n);
          await merkle.invalid(forged);
        },
      );
      await t.test(
        `${maxDepth}-level helper matches an independent root at every legal depth`,
        async () => {
          const alternating = BigInt(`0b${"10".repeat(maxDepth / 2)}`);
          for (let depth = 0; depth <= maxDepth; depth += 1) {
            await merkle.valid(membershipWitness(maxDepth, alternating, depth));
          }
        },
      );
      await t.test(
        `${maxDepth}-level helper matches independent roots across dynamic depths and directions`,
        async () => {
          const alternating = BigInt(`0b${"10".repeat(maxDepth / 2)}`);
          for (const depth of [0, 1, 2, 7, maxDepth - 1, maxDepth]) {
            for (const index of [0n, (1n << BigInt(maxDepth)) - 1n, alternating]) {
              const witness = membershipWitness(maxDepth, index, depth);
              await merkle.valid(witness);
              await merkle.invalid({ ...witness, root: String(BigInt(witness.root) + 1n) });
              if (depth > 0) {
                await merkle.invalid({ ...witness, index: String(index ^ 1n) });
                const changedSibling = structuredClone(witness);
                changedSibling.siblings[depth - 1] = String(
                  BigInt(changedSibling.siblings[depth - 1]) + 1n,
                );
                await merkle.invalid(changedSibling);
              }
              if (depth < maxDepth) {
                const changedUnused = structuredClone(witness);
                changedUnused.index = String(index ^ (1n << BigInt(depth)));
                for (let level = depth; level < maxDepth; level += 1) {
                  changedUnused.siblings[level] = String(BigInt(9000 + level));
                }
                await merkle.valid(changedUnused);
              }
            }
          }
        },
      );
      await t.test(
        `${maxDepth}-level helper rejects depth and index outside supported ranges`,
        async () => {
          const witness = membershipWitness(maxDepth, 0n);
          // The library selects root zero outside its supported depths.
          // Match that value so a stale root cannot mask a missing range check.
          for (const depth of [maxDepth + 1, 2 * maxDepth - 1, -1]) {
            await merkle.invalid({ ...witness, root: "0", depth: String(depth) });
          }
          await merkle.invalid({ ...witness, index: String(1n << BigInt(maxDepth)) });
        },
      );
      const gatedMerkle = await compile(
        directory,
        `gated_membership_${maxDepth}`,
        merkleSource(maxDepth, true),
      );
      await t.test(
        `${maxDepth}-level helper gates only root equality with a Boolean enable`,
        async () => {
          const witness = membershipWitness(maxDepth, 0n);
          const wrongRoot = String(BigInt(witness.root) + 1n);
          await gatedMerkle.valid({ ...witness, enabled: "1" });
          await gatedMerkle.invalid({ ...witness, root: wrongRoot, enabled: "1" });
          await gatedMerkle.valid({ ...witness, root: wrongRoot, enabled: "0" });
          for (const enabled of ["2", "-1"]) {
            await gatedMerkle.invalid({ ...witness, enabled });
          }
        },
      );
      await t.test(
        `${maxDepth}-level helper keeps depth and index bounds when root checking is disabled`,
        async () => {
          const witness = { ...membershipWitness(maxDepth, 0n), root: "0", enabled: "0" };
          for (const depth of [maxDepth + 1, 2 * maxDepth - 1, -1]) {
            await gatedMerkle.invalid({ ...witness, depth: String(depth) });
          }
          for (const index of [String(1n << BigInt(maxDepth)), "-1"]) {
            await gatedMerkle.invalid({ ...witness, index });
          }
        },
      );
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

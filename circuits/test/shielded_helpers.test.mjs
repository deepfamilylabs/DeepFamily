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
import { poseidon2, poseidon3 } from "poseidon-lite";
import { shieldedFixtureTag } from "./shielded_scope_fixture.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const purposes = [1010, 1011, 1014, 1015, 1016, 1017, 1019, 1021, 1026, 1027, 1028, 1029, 1030];

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

function merkleSource(maxDepth) {
  return `pragma circom 2.2.3;
include "shielded_merkle_common.circom";
template MembershipCheck() {
    signal input leaf;
    signal input root;
    signal input depth;
    signal input index;
    signal input siblings[${maxDepth}];
    component membership = ShieldedMerkleRoot(${maxDepth});
    membership.leaf <== leaf;
    membership.depth <== depth;
    membership.index <== index;
    membership.siblings <== siblings;
    membership.out === root;
}
component main = MembershipCheck();`;
}

function fullPath(maxDepth, index) {
  const leaf = 12345n;
  const siblings = Array.from({ length: maxDepth }, (_, level) => BigInt(1000 + level));
  let root = leaf;
  for (let level = 0; level < maxDepth; level += 1) {
    root =
      ((index >> BigInt(level)) & 1n) === 1n
        ? poseidon2([siblings[level], root])
        : poseidon2([root, siblings[level]]);
  }
  return {
    leaf: String(leaf),
    root: String(root),
    depth: String(maxDepth),
    index: String(index),
    siblings: siblings.map(String),
  };
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
          const witness = fullPath(maxDepth, (1n << BigInt(maxDepth)) - 1n);
          await merkle.valid(witness);
          const forged = structuredClone(witness);
          forged.siblings[maxDepth - 1] = String(BigInt(forged.siblings[maxDepth - 1]) + 1n);
          await merkle.invalid(forged);
        },
      );
      await t.test(
        `${maxDepth}-level helper rejects overflow returning a zero library root`,
        async () => {
          for (const depth of [maxDepth + 1, -1]) {
            await merkle.invalid({
              leaf: "123",
              root: "0",
              depth: String(depth),
              index: "0",
              siblings: Array(maxDepth).fill("0"),
            });
          }
          const overflowIndex = fullPath(maxDepth, 0n);
          overflowIndex.index = String(1n << BigInt(maxDepth));
          await merkle.invalid(overflowIndex);
        },
      );
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

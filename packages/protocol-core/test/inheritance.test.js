import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { poseidon2 } from "poseidon-lite";
import {
  INHERITANCE_PERIOD_SECONDS,
  LINEAGE_TREE_MAX_DEPTH,
  buildLineageMerkleProof,
  buildLineageMerkleProofFromPath,
  computeInheritanceClaimTag,
  computeInheritanceCredential,
  computeInheritanceEligibleFrom,
  computeInheritanceEntitlement,
  createLineageTree,
  packLineageEndorserAndTime,
  replayLineageTree,
  wrapIdentityCommitmentAsPersonHash,
} from "../index.js";
import {
  INHERITANCE_VECTOR_URL,
  buildInheritanceVector,
  serializeInheritanceVector,
} from "../scripts/generate-inheritance-vector.mjs";

// Independent LeanIMT reference: a lone left node rises unchanged, a pair is hashed.
const referenceRoot = (leaves) => {
  if (leaves.length === 0) return 0n;
  let level = leaves.map(BigInt);
  while (level.length > 1) {
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      next.push(
        index + 1 < level.length ? poseidon2([level[index], level[index + 1]]) : level[index],
      );
    }
    level = next;
  }
  return level[0];
};

const referenceProof = (leaves, leafIndex) => {
  let level = leaves.map(BigInt);
  let index = leafIndex;
  let pathIndex = 0n;
  const siblings = [];
  while (level.length > 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    if (siblingIndex < level.length) {
      if (index % 2 === 1) pathIndex |= 1n << BigInt(siblings.length);
      siblings.push(level[siblingIndex]);
    }
    const next = [];
    for (let node = 0; node < level.length; node += 2) {
      next.push(node + 1 < level.length ? poseidon2([level[node], level[node + 1]]) : level[node]);
    }
    level = next;
    index = Math.floor(index / 2);
  }
  return { root: level[0], leaf: leaves[leafIndex], index: pathIndex, siblings };
};

const rootFromProof = (proof) => {
  let node = proof.leaf;
  for (let level = 0; level < proof.depth; level += 1) {
    const sibling = proof.siblings[level];
    node =
      (proof.index >> BigInt(level)) & 1n ? poseidon2([sibling, node]) : poseidon2([node, sibling]);
  }
  return node;
};

test("the committed inheritance vector matches the generator", () => {
  const committed = fs.readFileSync(INHERITANCE_VECTOR_URL, "utf8");
  assert.equal(committed, serializeInheritanceVector(buildInheritanceVector()));
});

test("replayed lineage trees match an independent LeanIMT for appends, updates and clears", () => {
  let seed = 7n;
  const random = (modulus) => {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n);
    return Number(seed % BigInt(modulus));
  };
  const leaves = [];
  const writes = [];
  for (let step = 0; step < 120; step += 1) {
    const append = leaves.length === 0 || random(3) !== 0;
    const leafIndex = append ? leaves.length : random(leaves.length);
    const leaf = random(5) === 0 ? 0n : BigInt(1 + random(1_000_000));
    if (append) leaves.push(leaf);
    else leaves[leafIndex] = leaf;
    writes.push({ leafIndex: BigInt(leafIndex), leaf });
    const tree = replayLineageTree(writes);
    assert.equal(tree.root, referenceRoot(leaves), `root after step ${step}`);
    if (step % 17 === 0) {
      for (const index of new Set([0, Math.floor(leaves.length / 2), leaves.length - 1])) {
        const expected = referenceProof(leaves, index);
        const actual = tree.generateProof(BigInt(index));
        assert.equal(actual.root, expected.root);
        assert.equal(actual.leaf, expected.leaf);
        assert.equal(BigInt(actual.index), expected.index);
        assert.deepEqual(actual.siblings, expected.siblings);
      }
    }
  }
});

test("circuit-ready proofs recompute the root and pad siblings to the maximum depth", () => {
  const tree = createLineageTree([11n, 22n, 33n, 44n, 55n]);
  for (let index = 0; index < tree.size; index += 1) {
    const proof = buildLineageMerkleProof(tree, index);
    assert.equal(proof.siblings.length, LINEAGE_TREE_MAX_DEPTH);
    assert.ok(proof.siblings.slice(proof.depth).every((sibling) => sibling === 0n));
    assert.equal(rootFromProof(proof), tree.root);
  }
});

test("compact lineage proofs preserve a 64-bit path index without JavaScript bitwise truncation", () => {
  const leaf = 11n;
  const index = (1n << 63n) | 5n;
  const siblings = Array.from({ length: LINEAGE_TREE_MAX_DEPTH }, (_, level) => BigInt(level + 1));
  let root = leaf;
  for (let level = 0; level < siblings.length; level += 1) {
    root =
      (index >> BigInt(level)) & 1n
        ? poseidon2([siblings[level], root])
        : poseidon2([root, siblings[level]]);
  }
  const proof = buildLineageMerkleProofFromPath({ root, leaf, index, siblings });
  assert.equal(proof.depth, 64);
  assert.equal(proof.index, index);
  assert.equal(proof.root, root);
  assert.equal(proof.siblings.length, 64);
  assert.throws(
    () => buildLineageMerkleProofFromPath({ root: root + 1n, leaf, index, siblings }),
    (error) => error.code === "LINEAGE_PROOF_ROOT_MISMATCH",
  );
  assert.throws(
    () => buildLineageMerkleProofFromPath({ root, leaf, index: 1n << 64n, siblings }),
    (error) => error.code === "INTEGER_OUT_OF_RANGE",
  );
  assert.throws(
    () => buildLineageMerkleProofFromPath({ root, leaf, index, siblings: [...siblings, 1n] }),
    (error) => error.code === "LINEAGE_TREE_TOO_DEEP",
  );
});

test("compact proof rejects path direction bits beyond its sibling count", () => {
  assert.throws(
    () => buildLineageMerkleProofFromPath({ root: 1n, leaf: 1n, index: 2n, siblings: [3n] }),
    (error) => error.code === "INVALID_LINEAGE_PROOF_INDEX",
  );
});

test("replay rejects a write that skips past the end of the tree", () => {
  assert.throws(
    () => replayLineageTree([{ leafIndex: 1n, leaf: 5n }]),
    (error) => error.code === "LINEAGE_WRITE_OUT_OF_ORDER",
  );
});

test("invalid insert leaves tree size, depth, and root unchanged", () => {
  const tree = createLineageTree([1n]);
  assert.throws(
    () => tree.insert(-1n),
    (error) => error.code === "INTEGER_OUT_OF_RANGE",
  );
  assert.equal(tree.sizeBigInt, 1n);
  assert.equal(tree.depth, 0);
  assert.equal(tree.root, 1n);
  assert.deepEqual(tree.leaves, [1n]);
  tree.insert(2n);
  assert.equal(tree.root, poseidon2([1n, 2n]));
});

test("lineage proofs retain present zero siblings and skip absent right siblings", () => {
  const tree = createLineageTree([7n, 0n, 9n]);
  const first = tree.generateProof(0n);
  const last = tree.generateProof(2n);
  assert.equal(first.siblings[0], 0n);
  assert.equal(last.siblings.length, 1);
  assert.equal(last.index, 1);
  assert.equal(rootFromProof(buildLineageMerkleProof(tree, 2n)), tree.root);
});

test("the endorser and write time pack into disjoint bit ranges", () => {
  const packed = packLineageEndorserAndTime({
    endorser: "0xffffffffffffffffffffffffffffffffffffffff",
    writtenAt: 3n,
  });
  assert.equal(packed, (3n << 160n) | ((1n << 160n) - 1n));
});

test("eligibility starts on the first period boundary at least one period after the write", () => {
  const period = INHERITANCE_PERIOD_SECONDS;
  const startTime = 10n * period + 1_000n;
  assert.equal(computeInheritanceEligibleFrom({ startTime, writtenAt: 0n }), startTime);
  assert.equal(
    computeInheritanceEligibleFrom({ startTime: 1_000n, writtenAt: 0n }),
    1_000n + period,
  );
  assert.equal(
    computeInheritanceEligibleFrom({ startTime, writtenAt: startTime - period }),
    startTime,
  );
  assert.equal(
    computeInheritanceEligibleFrom({ startTime, writtenAt: startTime - period + 1n }),
    startTime + period,
  );
  assert.equal(
    computeInheritanceEligibleFrom({ startTime, writtenAt: startTime + period }),
    startTime + 2n * period,
  );
});

test("entitlement accrues one amount per started period", () => {
  const period = INHERITANCE_PERIOD_SECONDS;
  const input = { amountPerPeriod: 5n, eligibleFrom: 100n };
  assert.equal(computeInheritanceEntitlement({ ...input, now: 99n }), 0n);
  assert.equal(computeInheritanceEntitlement({ ...input, now: 100n }), 5n);
  assert.equal(computeInheritanceEntitlement({ ...input, now: 100n + period - 1n }), 5n);
  assert.equal(computeInheritanceEntitlement({ ...input, now: 100n + 3n * period }), 20n);
});

test("credentials and claim tags bind every input", () => {
  const base = { rootIdentityCommitment: 9n, rootVersionIndex: 1n, rootDerivedSecretField: 7n };
  const credential = computeInheritanceCredential(base);
  assert.notEqual(computeInheritanceCredential({ ...base, rootVersionIndex: 2n }), credential);
  assert.notEqual(
    computeInheritanceCredential({ ...base, rootDerivedSecretField: 8n }),
    credential,
  );
  assert.throws(() => computeInheritanceCredential({ ...base, rootIdentityCommitment: 0n }));
  const tag = computeInheritanceClaimTag({
    derivedSecretField: 3n,
    inheritanceCredential: credential,
  });
  assert.notEqual(
    computeInheritanceClaimTag({ derivedSecretField: 3n, inheritanceCredential: credential + 1n }),
    tag,
  );
});

test("person hashes wrap identity commitments exactly like DeepFamily", () => {
  const vector = buildInheritanceVector();
  assert.equal(
    wrapIdentityCommitmentAsPersonHash(vector.heir.identityCommitment),
    vector.heir.personHash,
  );
});

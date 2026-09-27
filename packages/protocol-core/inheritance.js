import { keccak256, toBeHex, zeroPadValue } from "ethers";
import { poseidon2, poseidon3, poseidon4, poseidon5 } from "poseidon-lite";
import { bigintFrom } from "./bytes.js";
import {
  DOMAIN_LINEAGE_ENDORSEMENT_LEAF,
  DOMAIN_LINEAGE_PARENTS,
  DOMAIN_LINEAGE_TRUSTED_LEAF,
  LINEAGE_TREE_MAX_DEPTH,
  MAX_UINT64,
  MAX_UINT256,
  SNARK_SCALAR_FIELD,
} from "./constants.js";
import { protocolAssert } from "./errors.js";
import { assertAddress } from "./identity.js";

const FIELD_MAX = SNARK_SCALAR_FIELD - 1n;
const MAX_LINEAGE_LEAVES = 1n << BigInt(LINEAGE_TREE_MAX_DEPTH);

const field = (value, label) => bigintFrom(value, label, FIELD_MAX);

export function wrapIdentityCommitmentAsPersonHash(identityCommitment) {
  const commitment = field(identityCommitment, "identityCommitment");
  protocolAssert(commitment !== 0n, "ZERO_IDENTITY_COMMITMENT", "identityCommitment is zero");
  return keccak256(zeroPadValue(toBeHex(commitment), 32));
}

export function computeLineageParentsDigest(input) {
  return poseidon3([
    DOMAIN_LINEAGE_PARENTS,
    field(input.fatherIdentityCommitment, "fatherIdentityCommitment"),
    field(input.motherIdentityCommitment, "motherIdentityCommitment"),
  ]);
}

/** Packs the endorser into bits 0..159 and the write time into bits 160..223. */
export function packLineageEndorserAndTime(input) {
  const endorser = BigInt(assertAddress(input.endorser, "endorser"));
  const writtenAt = bigintFrom(input.writtenAt, "writtenAt", MAX_UINT64);
  return (writtenAt << 160n) | endorser;
}

export function computeLineageEndorsementLeaf(input) {
  return poseidon5([
    DOMAIN_LINEAGE_ENDORSEMENT_LEAF,
    field(input.identityCommitment, "identityCommitment"),
    field(input.parentsDigest, "parentsDigest"),
    field(input.versionIndex, "versionIndex"),
    packLineageEndorserAndTime(input),
  ]);
}

export function computeLineageTrustedLeaf(input) {
  return poseidon4([
    DOMAIN_LINEAGE_TRUSTED_LEAF,
    field(input.rootIdentityCommitment, "rootIdentityCommitment"),
    field(input.rootVersionIndex, "rootVersionIndex"),
    BigInt(assertAddress(input.account, "account")),
  ]);
}

export const hashLineageNodes = (left, right) => poseidon2([left, right]);

const compactNumber = (value) => (value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value);

/** LeanIMT node rules with bigint indices and sparse per-level node maps. */
class LineageTree {
  #nodes = [new Map()];
  #size = 0n;
  #depth = 0;

  get root() {
    return this.#nodes[this.#depth].get(0n) ?? 0n;
  }

  get depth() {
    return this.#depth;
  }

  get size() {
    return compactNumber(this.#size);
  }

  get sizeBigInt() {
    return this.#size;
  }

  get leaves() {
    return Array.from(this.#nodes[0].values());
  }

  indexOf(leaf) {
    for (const [index, value] of this.#nodes[0]) {
      if (value === leaf) return compactNumber(index);
    }
    return -1;
  }

  #writePath(index, leaf) {
    let node = leaf;
    for (let level = 0; level <= this.#depth; level += 1) {
      this.#nodes[level].set(index, node);
      if (level === this.#depth) break;
      const sibling = this.#nodes[level].get(index ^ 1n);
      if (sibling !== undefined) {
        node =
          (index & 1n) === 1n ? hashLineageNodes(sibling, node) : hashLineageNodes(node, sibling);
      }
      index >>= 1n;
    }
  }

  insert(leaf) {
    const value = field(leaf, "leaf");
    protocolAssert(
      this.#size < MAX_LINEAGE_LEAVES,
      "LINEAGE_TREE_FULL",
      `Lineage tree cannot exceed ${MAX_LINEAGE_LEAVES} leaf slots`,
    );
    const index = this.#size;
    this.#size += 1n;
    if (1n << BigInt(this.#depth) < this.#size) {
      this.#depth += 1;
      this.#nodes.push(new Map());
    }
    this.#writePath(index, value);
  }

  update(index, leaf) {
    const position = bigintFrom(index, "leafIndex", MAX_UINT64);
    protocolAssert(
      position < this.#size,
      "LINEAGE_LEAF_INDEX_OUT_OF_RANGE",
      `Lineage leaf index ${position} is outside tree size ${this.#size}`,
    );
    this.#writePath(position, field(leaf, "leaf"));
  }

  generateProof(index) {
    const position = bigintFrom(index, "leafIndex", MAX_UINT64);
    protocolAssert(
      position < this.#size,
      "LINEAGE_LEAF_INDEX_OUT_OF_RANGE",
      `Lineage leaf index ${position} is outside tree size ${this.#size}`,
    );
    const siblings = [];
    let proofIndex = 0n;
    let nodeIndex = position;
    for (let level = 0; level < this.#depth; level += 1) {
      const sibling = this.#nodes[level].get(nodeIndex ^ 1n);
      if (sibling !== undefined) {
        if ((nodeIndex & 1n) === 1n) proofIndex |= 1n << BigInt(siblings.length);
        siblings.push(sibling);
      }
      nodeIndex >>= 1n;
    }
    return {
      root: this.root,
      leaf: this.#nodes[0].get(position),
      index: compactNumber(proofIndex),
      siblings,
    };
  }
}

export function createLineageTree(leaves = []) {
  const tree = new LineageTree();
  for (const [index, leaf] of leaves.entries()) tree.insert(field(leaf, `leaf ${index}`));
  return tree;
}

/**
 * Rebuilds a lineage tree from `LeafWritten` events ordered by chain position. A write at the
 * current size appends; any lower index updates in place, exactly as the index contract does.
 */
export function replayLineageTree(writes) {
  const tree = createLineageTree();
  for (const [position, write] of writes.entries()) {
    const leafIndex = bigintFrom(write.leafIndex, `write ${position} leafIndex`, MAX_UINT256);
    const leaf = field(write.leaf, `write ${position} leaf`);
    if (leafIndex === tree.sizeBigInt) {
      tree.insert(leaf);
    } else {
      protocolAssert(
        leafIndex < tree.sizeBigInt,
        "LINEAGE_WRITE_OUT_OF_ORDER",
        `Lineage write ${position} skips to index ${leafIndex}; tree size is ${tree.sizeBigInt}`,
      );
      tree.update(leafIndex, leaf);
    }
  }
  return tree;
}

/** Validates a compact LeanIMT path and pads it for the 64-level shielded claim circuit. */
export function buildLineageMerkleProofFromPath(input) {
  protocolAssert(
    Array.isArray(input.siblings),
    "INVALID_LINEAGE_PROOF",
    "siblings must be an array",
  );
  const depth = input.siblings.length;
  protocolAssert(
    depth <= LINEAGE_TREE_MAX_DEPTH,
    "LINEAGE_TREE_TOO_DEEP",
    `Lineage proof depth ${depth} exceeds ${LINEAGE_TREE_MAX_DEPTH}`,
  );
  const root = field(input.root, "proof.root");
  const leaf = field(input.leaf, "proof.leaf");
  const index = bigintFrom(input.index, "proof.index", MAX_UINT64);
  protocolAssert(
    index < 1n << BigInt(depth),
    "INVALID_LINEAGE_PROOF_INDEX",
    "Lineage proof index has bits outside its sibling path",
  );
  const siblings = input.siblings.map((sibling, position) =>
    field(sibling, `proof.siblings[${position}]`),
  );
  let node = leaf;
  for (let level = 0; level < depth; level += 1) {
    node =
      (index >> BigInt(level)) & 1n
        ? hashLineageNodes(siblings[level], node)
        : hashLineageNodes(node, siblings[level]);
  }
  protocolAssert(
    node === root,
    "LINEAGE_PROOF_ROOT_MISMATCH",
    "Lineage proof does not recompute its root",
  );
  while (siblings.length < LINEAGE_TREE_MAX_DEPTH) siblings.push(0n);
  return { root, leaf, depth, index, siblings };
}

/** Circuit-ready LeanIMT proof: `depth` is the sibling count, siblings are zero-padded. */
export function buildLineageMerkleProof(tree, leafIndex) {
  return buildLineageMerkleProofFromPath(tree.generateProof(leafIndex));
}

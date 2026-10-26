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

// A persistent AVL map indexes leaf -> ordered slot set. Only O(log n) frozen
// nodes change per write; clones retain the entire index without copying it.
const mapHeight = (node) => node?.height ?? 0;
const mapNode = (key, value, left, right) =>
  Object.freeze({
    key,
    value,
    left,
    right,
    height: 1 + Math.max(mapHeight(left), mapHeight(right)),
  });
const rotateLeft = (node) => {
  const pivot = node.right;
  return mapNode(
    pivot.key,
    pivot.value,
    mapNode(node.key, node.value, node.left, pivot.left),
    pivot.right,
  );
};
const rotateRight = (node) => {
  const pivot = node.left;
  return mapNode(
    pivot.key,
    pivot.value,
    pivot.left,
    mapNode(node.key, node.value, pivot.right, node.right),
  );
};
function balanceMap(node) {
  const difference = mapHeight(node.left) - mapHeight(node.right);
  if (difference > 1) {
    if (mapHeight(node.left.left) < mapHeight(node.left.right))
      node = mapNode(node.key, node.value, rotateLeft(node.left), node.right);
    return rotateRight(node);
  }
  if (difference < -1) {
    if (mapHeight(node.right.right) < mapHeight(node.right.left))
      node = mapNode(node.key, node.value, node.left, rotateRight(node.right));
    return rotateLeft(node);
  }
  return node;
}
function mapGet(node, key) {
  while (node && node.key !== key) node = key < node.key ? node.left : node.right;
  return node?.value;
}
function mapSet(node, key, value) {
  if (!node) return mapNode(key, value);
  if (key === node.key)
    return value === node.value ? node : mapNode(key, value, node.left, node.right);
  return balanceMap(
    key < node.key
      ? mapNode(node.key, node.value, mapSet(node.left, key, value), node.right)
      : mapNode(node.key, node.value, node.left, mapSet(node.right, key, value)),
  );
}
function mapFirst(node) {
  while (node?.left) node = node.left;
  return node;
}
function mapDelete(node, key) {
  if (!node) return undefined;
  if (key < node.key)
    return balanceMap(mapNode(node.key, node.value, mapDelete(node.left, key), node.right));
  if (key > node.key)
    return balanceMap(mapNode(node.key, node.value, node.left, mapDelete(node.right, key)));
  if (!node.left) return node.right;
  if (!node.right) return node.left;
  const next = mapFirst(node.right);
  return balanceMap(mapNode(next.key, next.value, node.left, mapDelete(node.right, next.key)));
}
function addLeafIndex(indices, leaf, index) {
  return mapSet(indices, leaf, mapSet(mapGet(indices, leaf), index, true));
}
function removeLeafIndex(indices, leaf, index) {
  const remaining = mapDelete(mapGet(indices, leaf), index);
  return remaining ? mapSet(indices, leaf, remaining) : mapDelete(indices, leaf);
}

const lineageLeaf = (value) => Object.freeze({ value });
const lineageBranch = (left, right) =>
  Object.freeze({
    value: right ? hashLineageNodes(left.value, right.value) : left.value,
    left,
    right,
  });
function writeLineageNode(node, level, index, value) {
  if (level === 0) return node?.value === value ? node : lineageLeaf(value);
  const right = (index >> BigInt(level - 1)) & 1n;
  const leftNode = right ? node?.left : writeLineageNode(node?.left, level - 1, index, value);
  const rightNode = right ? writeLineageNode(node?.right, level - 1, index, value) : node?.right;
  if (leftNode === node?.left && rightNode === node?.right) return node;
  return lineageBranch(leftNode, rightNode);
}
function readLineageNode(node, depth, level, index) {
  if (level > depth) return undefined;
  for (let current = depth; node && current > level; current--)
    node = (index >> BigInt(current - level - 1)) & 1n ? node.right : node.left;
  return node;
}
function* exportLineageNodes(node, level, index, previousNode, previousDepth) {
  if (!node || node === readLineageNode(previousNode, previousDepth, level, index)) return;
  yield Object.freeze({ level, index, value: node.value });
  if (level > 0) {
    yield* exportLineageNodes(node.left, level - 1, index * 2n, previousNode, previousDepth);
    yield* exportLineageNodes(node.right, level - 1, index * 2n + 1n, previousNode, previousDepth);
  }
}

/** LeanIMT paths and duplicate-leaf indices are immutable and structurally shared. */
class LineageTree {
  #node;
  #indices;
  #size = 0n;
  #depth = 0;

  get root() {
    return this.#node?.value ?? 0n;
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
    const leaves = [];
    const visit = (node, level) => {
      if (!node) return;
      if (level === 0) leaves.push(node.value);
      else {
        visit(node.left, level - 1);
        visit(node.right, level - 1);
      }
    };
    visit(this.#node, this.#depth);
    return leaves;
  }

  clone() {
    const tree = new LineageTree();
    tree.#node = this.#node;
    tree.#indices = this.#indices;
    tree.#size = this.#size;
    tree.#depth = this.#depth;
    return tree;
  }

  indexOf(leaf) {
    if (typeof leaf !== "bigint") return -1;
    const first = mapFirst(mapGet(this.#indices, leaf));
    return first ? compactNumber(first.key) : -1;
  }

  getNode(level, index) {
    const height = Number(bigintFrom(level, "node.level", BigInt(LINEAGE_TREE_MAX_DEPTH)));
    const position = bigintFrom(index, "node.index", MAX_UINT64);
    if (position << BigInt(height) >= this.#size) return undefined;
    return readLineageNode(this.#node, this.#depth, height, position)?.value;
  }

  exportNodes(previous) {
    protocolAssert(
      previous === undefined || previous instanceof LineageTree,
      "INVALID_LINEAGE_NODE",
      "Previous lineage tree must be a tree instance",
    );
    return exportLineageNodes(this.#node, this.#depth, 0n, previous?.#node, previous?.#depth ?? -1);
  }

  insert(leaf) {
    const value = field(leaf, "leaf");
    protocolAssert(
      this.#size < MAX_LINEAGE_LEAVES,
      "LINEAGE_TREE_FULL",
      `Lineage tree cannot exceed ${MAX_LINEAGE_LEAVES} leaf slots`,
    );
    const index = this.#size;
    const nextSize = index + 1n;
    const nextDepth = 1n << BigInt(this.#depth) < nextSize ? this.#depth + 1 : this.#depth;
    const previous = nextDepth > this.#depth ? lineageBranch(this.#node, undefined) : this.#node;
    const next = writeLineageNode(previous, nextDepth, index, value);
    const indices = addLeafIndex(this.#indices, value, index);
    this.#node = next;
    this.#indices = indices;
    this.#size = nextSize;
    this.#depth = nextDepth;
  }

  update(index, leaf) {
    const position = this.#checkedPosition(index);
    const value = field(leaf, "leaf");
    const oldValue = readLineageNode(this.#node, this.#depth, 0, position).value;
    if (oldValue === value) return;
    const next = writeLineageNode(this.#node, this.#depth, position, value);
    const indices = addLeafIndex(
      removeLeafIndex(this.#indices, oldValue, position),
      value,
      position,
    );
    this.#node = next;
    this.#indices = indices;
  }

  #checkedPosition(index) {
    const position = bigintFrom(index, "leafIndex", MAX_UINT64);
    protocolAssert(
      position < this.#size,
      "LINEAGE_LEAF_INDEX_OUT_OF_RANGE",
      `Lineage leaf index ${position} is outside tree size ${this.#size}`,
    );
    return position;
  }

  generateProof(index) {
    const position = this.#checkedPosition(index);
    const path = [];
    let node = this.#node;
    for (let level = this.#depth - 1; level >= 0; level--) {
      const right = (position >> BigInt(level)) & 1n;
      const sibling = right ? node.left : node.right;
      if (sibling) path.push({ value: sibling.value, right });
      node = right ? node.right : node.left;
    }
    path.reverse();
    let proofIndex = 0n;
    for (let level = 0; level < path.length; level++)
      if (path[level].right) proofIndex |= 1n << BigInt(level);
    return {
      root: this.root,
      leaf: node.value,
      index: compactNumber(proofIndex),
      siblings: path.map((entry) => entry.value),
    };
  }

  static fromNodes(input, records) {
    const size = bigintFrom(input.size, "size", MAX_LINEAGE_LEAVES);
    const root = field(input.root, "root");
    let depth = 0;
    while (1n << BigInt(depth) < size) depth++;
    const nodes = new Map();
    for (const record of records) {
      const node = verifyLineageTreeNode(record);
      const key = `${node.level}:${node.index}`;
      protocolAssert(
        node.level <= depth && node.index << BigInt(node.level) < size && !nodes.has(key),
        "INVALID_LINEAGE_NODE",
        "Duplicate or out-of-range lineage node",
      );
      nodes.set(key, node.value);
    }
    const tree = new LineageTree();
    let consumed = 0;
    const read = (level, index) => {
      if (index << BigInt(level) >= size) return undefined;
      const key = `${level}:${index}`;
      protocolAssert(nodes.has(key), "INVALID_LINEAGE_NODE", "Missing lineage node");
      const value = nodes.get(key);
      consumed++;
      if (level === 0) {
        tree.#indices = addLeafIndex(tree.#indices, value, index);
        return lineageLeaf(value);
      }
      const node = lineageBranch(read(level - 1, index * 2n), read(level - 1, index * 2n + 1n));
      protocolAssert(
        node.value === value,
        "INVALID_LINEAGE_NODE",
        "Lineage parent does not match its children",
      );
      return node;
    };
    tree.#node = read(depth, 0n);
    tree.#size = size;
    tree.#depth = depth;
    protocolAssert(
      tree.root === root && consumed === nodes.size,
      "INVALID_LINEAGE_NODE",
      "Lineage nodes do not match the expected root",
    );
    return tree;
  }
}

/** Check one slot record's canonical types/ranges, not its Merkle authentication. */
export function verifyLineageTreeNode(input) {
  protocolAssert(
    input && typeof input === "object",
    "INVALID_LINEAGE_NODE",
    "Lineage node is required",
  );
  return Object.freeze({
    level: Number(bigintFrom(input.level, "node.level", BigInt(LINEAGE_TREE_MAX_DEPTH))),
    index: bigintFrom(input.index, "node.index", MAX_UINT64),
    value: field(input.value, "node.value"),
  });
}

/** Import every occupied slot and verify all LeanIMT promotions/hashes against root. */
export function createLineageTreeFromNodes(input, nodes) {
  return LineageTree.fromNodes(input, nodes);
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

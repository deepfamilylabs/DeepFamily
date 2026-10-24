import { getAddress } from "ethers";
import { poseidon2, poseidon3, poseidon6 } from "poseidon-lite";
import { bigintFrom } from "./bytes.js";
import { MAX_UINT64, SNARK_SCALAR_FIELD } from "./constants.js";
import { protocolAssert } from "./errors.js";
import { computeShieldedAuthorizationAlias } from "./shielded-receive-credential.js";

export const SHIELDED_IDENTITY_AUTHORIZATION_DEPTH = 64;
export const SHIELDED_IDENTITY_COUNTER_AUTHORIZATION_DOMAIN = 202610210201n;
const field = (value, label) => bigintFrom(value, label, SNARK_SCALAR_FIELD - 1n);
const EMPTY_NODE = Object.freeze({ kind: "empty", hash: 0n });

function leafNode(key, value) {
  return Object.freeze({ kind: "leaf", key, value, hash: poseidon3([key, value, 1n]) });
}

function branchNode(left, right) {
  return Object.freeze({ kind: "branch", left, right, hash: poseidon2([left.hash, right.hash]) });
}

function assertSupportedDepth(depth) {
  protocolAssert(
    depth < SHIELDED_IDENTITY_AUTHORIZATION_DEPTH,
    "SHIELDED_AUTHORIZATION_PATH_COLLISION",
    "Authorization dictionary keys exceed the supported path depth",
  );
}

function buildNode(entries, depth = 0) {
  if (entries.length === 0) return EMPTY_NODE;
  if (entries.length === 1) {
    const [key, value] = entries[0];
    return leafNode(key, value);
  }
  assertSupportedDepth(depth);
  const left = [],
    right = [];
  for (const entry of entries) ((entry[0] >> BigInt(depth)) & 1n ? right : left).push(entry);
  const l = buildNode(left, depth + 1),
    r = buildNode(right, depth + 1);
  return branchNode(l, r);
}

function checkedRecords(entries) {
  const records = new Map();
  for (const [rawKey, rawValue] of entries) {
    const key = field(rawKey, "authorizationAlias");
    const value = bigintFrom(rawValue, "authorizationCounter", MAX_UINT64);
    protocolAssert(
      key !== 0n && value !== 0n,
      "INVALID_SHIELDED_AUTHORIZATION_ENTRY",
      "Authorization entries require a nonzero alias and counter",
    );
    protocolAssert(
      !records.has(key),
      "DUPLICATE_SHIELDED_AUTHORIZATION_ALIAS",
      "Duplicate authorization alias",
    );
    records.set(key, value);
  }
  return records;
}

function nonzeroAlias(value) {
  const alias = field(value, "authorizationAlias");
  protocolAssert(alias !== 0n, "INVALID_SHIELDED_AUTHORIZATION_ENTRY", "Alias must be nonzero");
  return alias;
}

// Nodes never change after construction. A failed insertion cannot alter the
// current root, and clones can safely retain every untouched subtree.
function writeNode(node, key, value, depth = 0) {
  if (node.kind === "empty" || (node.kind === "leaf" && node.key === key))
    return leafNode(key, value);
  assertSupportedDepth(depth);
  const right = (key >> BigInt(depth)) & 1n;
  if (node.kind === "leaf") {
    const oldRight = (node.key >> BigInt(depth)) & 1n;
    if (right !== oldRight) {
      const next = leafNode(key, value);
      return right ? branchNode(node, next) : branchNode(next, node);
    }
    const child = writeNode(node, key, value, depth + 1);
    return right ? branchNode(EMPTY_NODE, child) : branchNode(child, EMPTY_NODE);
  }
  return right
    ? branchNode(node.left, writeNode(node.right, key, value, depth + 1))
    : branchNode(writeNode(node.left, key, value, depth + 1), node.right);
}

class IdentityAuthorizationTree {
  #node;

  constructor(entries) {
    this.#node = buildNode([...checkedRecords(entries)]);
  }

  get root() {
    return this.#node.hash;
  }

  getCounter(authorizationAlias) {
    const alias = nonzeroAlias(authorizationAlias);
    let node = this.#node;
    let depth = 0n;
    while (node.kind === "branch") node = (alias >> depth++) & 1n ? node.right : node.left;
    return node.kind === "leaf" && node.key === alias ? node.value : 0n;
  }

  getWitness(authorizationAlias) {
    return witnessFromNode(this.#node, nonzeroAlias(authorizationAlias));
  }

  increment(authorizationAlias, oldCounter, newCounter) {
    const alias = nonzeroAlias(authorizationAlias);
    const oldValue = bigintFrom(oldCounter, "oldCounter", MAX_UINT64);
    const newValue = bigintFrom(newCounter, "newCounter", MAX_UINT64);
    protocolAssert(
      this.getCounter(alias) === oldValue && newValue === oldValue + 1n,
      "INVALID_SHIELDED_AUTHORIZATION_INCREMENT",
      "Authorization counter must match the current value and increment by one",
    );
    const next = writeNode(this.#node, alias, newValue);
    this.#node = next;
  }

  clone() {
    const copy = new IdentityAuthorizationTree([]);
    copy.#node = this.#node;
    return copy;
  }

  snapshot() {
    const entries = new Map();
    const visit = (node) => {
      if (node.kind === "leaf") entries.set(node.key, node.value);
      else if (node.kind === "branch") {
        visit(node.left);
        visit(node.right);
      }
    };
    visit(this.#node);
    return { root: this.root, entries };
  }

  /** Capture this root now; a previous immutable clone prunes unchanged subtrees. */
  exportNodes(previous) {
    protocolAssert(
      previous === undefined || previous instanceof IdentityAuthorizationTree,
      "INVALID_SHIELDED_AUTHORIZATION_NODE",
      "Previous authorization tree must be a tree instance",
    );
    return exportAuthorizationNodes(this.#node, previous?.#node);
  }

  static fromNodes(root, records) {
    const tree = new IdentityAuthorizationTree([]);
    tree.#node = importAuthorizationNodes(root, records);
    return tree;
  }
}

function* exportAuthorizationNodes(node, previous, depth = 0) {
  if (node === previous) return;
  if (node.kind === "empty") {
    if (depth === 0) yield Object.freeze({ kind: "empty", hash: 0n });
    return;
  }
  if (node.kind === "leaf") {
    yield Object.freeze({ kind: "leaf", hash: node.hash, key: node.key, value: node.value });
    return;
  }
  yield Object.freeze({
    kind: "branch",
    hash: node.hash,
    leftHash: node.left.hash,
    rightHash: node.right.hash,
  });
  const oldRight = previous?.kind === "leaf" && (previous.key >> BigInt(depth)) & 1n;
  yield* exportAuthorizationNodes(
    node.left,
    previous?.kind === "branch"
      ? previous.left
      : previous?.kind === "leaf" && !oldRight
        ? previous
        : undefined,
    depth + 1,
  );
  yield* exportAuthorizationNodes(
    node.right,
    previous?.kind === "branch" ? previous.right : oldRight ? previous : undefined,
    depth + 1,
  );
}

/** Validate one content-addressed record; path placement is checked by the full importer/witness. */
export function verifyShieldedIdentityAuthorizationNode(input, expectedHash) {
  const valid = (condition, message) =>
    protocolAssert(condition, "INVALID_SHIELDED_AUTHORIZATION_NODE", message);
  valid(input && typeof input === "object", "Authorization node is required");
  const hash = field(input.hash, "node.hash");
  if (expectedHash !== undefined)
    valid(hash === field(expectedHash, "expectedHash"), "Authorization node hash does not match");
  if (input.kind === "empty") {
    valid(hash === 0n, "Empty authorization node must have hash zero");
    return Object.freeze({ kind: "empty", hash });
  }
  valid(hash !== 0n, "Nonempty authorization node cannot have hash zero");
  if (input.kind === "leaf") {
    const key = nonzeroAlias(input.key);
    const value = bigintFrom(input.value, "node.value", MAX_UINT64);
    valid(value !== 0n && poseidon3([key, value, 1n]) === hash, "Invalid authorization leaf hash");
    return Object.freeze({ kind: "leaf", hash, key, value });
  }
  valid(input.kind === "branch", "Unknown authorization node kind");
  const leftHash = field(input.leftHash, "node.leftHash");
  const rightHash = field(input.rightHash, "node.rightHash");
  valid(
    (leftHash !== 0n || rightHash !== 0n) && poseidon2([leftHash, rightHash]) === hash,
    "Invalid authorization branch hash",
  );
  return Object.freeze({ kind: "branch", hash, leftHash, rightHash });
}

function importAuthorizationNodes(expectedRoot, inputs) {
  const root = field(expectedRoot, "root");
  const records = new Map();
  for (const input of inputs) {
    const record = verifyShieldedIdentityAuthorizationNode(input);
    protocolAssert(
      !records.has(record.hash),
      "INVALID_SHIELDED_AUTHORIZATION_NODE",
      "Duplicate authorization node",
    );
    records.set(record.hash, record);
  }
  const visited = new Set();
  const read = (hash, depth, prefix) => {
    if (hash === 0n) return EMPTY_NODE;
    const record = records.get(hash);
    protocolAssert(
      record && !visited.has(hash),
      "INVALID_SHIELDED_AUTHORIZATION_NODE",
      "Missing or repeated authorization node",
    );
    visited.add(hash);
    if (record.kind === "leaf") {
      protocolAssert(
        (record.key & ((1n << BigInt(depth)) - 1n)) === prefix,
        "INVALID_SHIELDED_AUTHORIZATION_NODE",
        "Authorization leaf is on the wrong path",
      );
      return leafNode(record.key, record.value);
    }
    assertSupportedDepth(depth);
    const left = read(record.leftHash, depth + 1, prefix);
    const right = read(record.rightHash, depth + 1, prefix | (1n << BigInt(depth)));
    protocolAssert(
      !(
        (left.kind === "empty" && right.kind === "leaf") ||
        (right.kind === "empty" && left.kind === "leaf")
      ),
      "INVALID_SHIELDED_AUTHORIZATION_NODE",
      "Authorization leaf must be compressed",
    );
    return branchNode(left, right);
  };
  const node = read(root, 0, 0n);
  protocolAssert(
    [...records.keys()].every((hash) => hash === 0n || visited.has(hash)),
    "INVALID_SHIELDED_AUTHORIZATION_NODE",
    "Unreachable authorization node",
  );
  return node;
}

/** Import a complete untrusted node stream against a separately authenticated root. */
export function createShieldedIdentityAuthorizationTreeFromNodes(root, nodes) {
  return IdentityAuthorizationTree.fromNodes(root, nodes);
}

/** Public counter mirror with immutable nodes and path-only counter updates. */
export function createShieldedIdentityAuthorizationTree(entries = []) {
  return new IdentityAuthorizationTree(entries);
}

/** Rebuild only public R/counter state. Zero counters are represented by absence. */
export function buildShieldedIdentityAuthorizationState(entries = []) {
  return createShieldedIdentityAuthorizationTree(entries).snapshot();
}

export function getShieldedIdentityAuthorizationWitness(state, authorizationAlias) {
  const alias = nonzeroAlias(authorizationAlias);
  // Authenticate snapshot records against their declared root instead of
  // trusting caller-supplied or cached private nodes.
  let node = buildNode([...checkedRecords(state.entries)]);
  const root = node.hash;
  protocolAssert(
    root === BigInt(state.root),
    "SHIELDED_AUTHORIZATION_ROOT_MISMATCH",
    "Authorization state root is inconsistent",
  );
  return witnessFromNode(node, alias);
}

function witnessFromNode(node, alias) {
  const root = node.hash;
  const siblings = [];
  while (node.kind === "branch") {
    const right = (alias >> BigInt(siblings.length)) & 1n;
    siblings.push(right ? node.left.hash : node.right.hash);
    node = right ? node.right : node.left;
  }
  const present = node.kind === "leaf" && node.key === alias;
  return {
    authorizationAlias: alias,
    authorizationCounter: present ? node.value : 0n,
    stateRoot: root,
    depth: BigInt(siblings.length),
    siblings: [
      ...siblings,
      ...Array(SHIELDED_IDENTITY_AUTHORIZATION_DEPTH - siblings.length).fill(0n),
    ],
    oldKey: node.kind === "leaf" ? node.key : 0n,
    oldValue: node.kind === "leaf" ? node.value : 0n,
    isOld0: node.kind === "empty" ? 1n : 0n,
    fnc: present ? 0n : 1n,
    absent: present ? 0n : 1n,
  };
}

/** Validate a supplied path against a separately authenticated chain root. */
export function verifyShieldedIdentityAuthorizationWitness(input, expectedRoot, expectedAlias) {
  const invalid = (condition, message) =>
    protocolAssert(condition, "INVALID_SHIELDED_AUTHORIZATION_WITNESS", message);
  invalid(input && typeof input === "object", "Authorization witness is required");
  const alias = nonzeroAlias(input.authorizationAlias);
  if (expectedAlias !== undefined)
    invalid(alias === nonzeroAlias(expectedAlias), "Authorization witness alias does not match");
  const root = field(expectedRoot, "expectedRoot");
  invalid(
    field(input.stateRoot, "stateRoot") === root,
    "Authorization witness root does not match",
  );
  const counter = bigintFrom(input.authorizationCounter, "authorizationCounter", MAX_UINT64);
  const depth = bigintFrom(input.depth, "depth", BigInt(SHIELDED_IDENTITY_AUTHORIZATION_DEPTH));
  const oldKey = field(input.oldKey, "oldKey");
  const oldValue = bigintFrom(input.oldValue, "oldValue", MAX_UINT64);
  const isOld0 = bigintFrom(input.isOld0, "isOld0", 1n);
  const absent = bigintFrom(input.absent, "absent", 1n);
  invalid(absent === (counter === 0n ? 1n : 0n), "Authorization counter and absence disagree");
  if (input.fnc !== undefined)
    invalid(bigintFrom(input.fnc, "fnc", 1n) === absent, "Authorization lookup function disagrees");
  if (!absent) {
    invalid(
      isOld0 === 0n && oldKey === alias && oldValue === counter,
      "Authorization membership leaf does not match",
    );
  } else if (isOld0) {
    invalid(oldKey === 0n && oldValue === 0n, "Empty authorization leaf is not canonical");
  } else {
    invalid(
      oldKey !== 0n && oldKey !== alias && oldValue !== 0n,
      "Authorization collision leaf is not canonical",
    );
    const prefixMask = (1n << depth) - 1n;
    invalid(
      (alias & prefixMask) === (oldKey & prefixMask),
      "Authorization collision leaf has the wrong path",
    );
  }
  invalid(
    Array.isArray(input.siblings) &&
      input.siblings.length === SHIELDED_IDENTITY_AUTHORIZATION_DEPTH,
    "Authorization path requires 64 siblings",
  );
  const siblings = input.siblings.map((value) => field(value, "authorization sibling"));
  const length = Number(depth);
  invalid(
    siblings.slice(length).every((sibling) => sibling === 0n),
    "Authorization path padding must be zero",
  );
  invalid(
    length === 0 || siblings[length - 1] !== 0n,
    "Authorization path has a redundant terminal branch",
  );
  let computed = isOld0 ? 0n : poseidon3([oldKey, oldValue, 1n]);
  for (let level = length - 1; level >= 0; level -= 1)
    computed =
      (alias >> BigInt(level)) & 1n
        ? poseidon2([siblings[level], computed])
        : poseidon2([computed, siblings[level]]);
  invalid(computed === root, "Authorization witness does not recompute the trusted root");
  return {
    authorizationAlias: alias,
    authorizationCounter: counter,
    stateRoot: root,
    depth,
    siblings,
    oldKey,
    oldValue,
    isOld0,
    absent,
    fnc: absent,
  };
}

/**
 * Prove authority for one counter increment. The state contract checks the live
 * counter and updates its tree; ownership proofs never contain global tree paths.
 */
export function prepareShieldedIdentityCounterAuthorization(input) {
  const chainId = bigintFrom(input.chainId, "chainId", MAX_UINT64);
  const consumer = BigInt(getAddress(input.authorizationStateAddress));
  protocolAssert(
    chainId > 0n && consumer > 0n,
    "INVALID_SHIELDED_AUTHORIZATION_CONTEXT",
    "Authorization scope must be nonzero",
  );
  const aliasR = nonzeroAlias(computeShieldedAuthorizationAlias(input));
  const counter = bigintFrom(input.authorizationCounter, "authorizationCounter", MAX_UINT64);
  protocolAssert(
    counter < MAX_UINT64,
    "SHIELDED_AUTHORIZATION_COUNTER_OVERFLOW",
    "Authorization counter cannot be incremented further",
  );
  const newCounter = counter + 1n;
  const authNullifier = poseidon6([
    SHIELDED_IDENTITY_COUNTER_AUTHORIZATION_DOMAIN,
    field(input.derivedSecretField, "derivedSecretField"),
    aliasR,
    chainId,
    consumer,
    counter,
  ]);
  protocolAssert(
    authNullifier !== 0n,
    "INVALID_SHIELDED_AUTHORIZATION_NULLIFIER",
    "Authorization nullifier must be nonzero",
  );
  return {
    publicSignals: [authNullifier, chainId, consumer, aliasR, counter, newCounter],
    witness: {
      chainId: String(chainId),
      consumer: String(consumer),
      aliasR: String(aliasR),
      oldCounter: String(counter),
      newCounter: String(newCounter),
    },
  };
}

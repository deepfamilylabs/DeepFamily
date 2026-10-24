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
  #records;

  constructor(entries) {
    this.#records = checkedRecords(entries);
    this.#node = buildNode([...this.#records]);
  }

  get root() {
    return this.#node.hash;
  }

  getCounter(authorizationAlias) {
    return this.#records.get(nonzeroAlias(authorizationAlias)) ?? 0n;
  }

  getWitness(authorizationAlias) {
    return witnessFromNode(this.#node, nonzeroAlias(authorizationAlias));
  }

  increment(authorizationAlias, oldCounter, newCounter) {
    const alias = nonzeroAlias(authorizationAlias);
    const oldValue = bigintFrom(oldCounter, "oldCounter", MAX_UINT64);
    const newValue = bigintFrom(newCounter, "newCounter", MAX_UINT64);
    protocolAssert(
      (this.#records.get(alias) ?? 0n) === oldValue && newValue === oldValue + 1n,
      "INVALID_SHIELDED_AUTHORIZATION_INCREMENT",
      "Authorization counter must match the current value and increment by one",
    );
    const next = writeNode(this.#node, alias, newValue);
    this.#records.set(alias, newValue);
    this.#node = next;
  }

  clone() {
    const copy = new IdentityAuthorizationTree([]);
    copy.#node = this.#node;
    copy.#records = new Map(this.#records);
    return copy;
  }

  snapshot() {
    return { root: this.root, entries: new Map(this.#records) };
  }
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
  // State snapshots remain mutable for compatibility. Always rebuild from their
  // checked records instead of trusting caller-supplied or cached private nodes.
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

/** Prepare the existing owner circuit from one authenticated path, without a full state map. */
export function prepareShieldedIdentityAuthorizationIncrementFromWitness(input) {
  const chainId = bigintFrom(input.chainId, "chainId", MAX_UINT64);
  const consumer = BigInt(getAddress(input.authorizationStateAddress));
  protocolAssert(
    chainId > 0n && consumer > 0n,
    "INVALID_SHIELDED_AUTHORIZATION_CONTEXT",
    "Authorization scope must be nonzero",
  );
  const aliasR = computeShieldedAuthorizationAlias(input);
  const lookup = verifyShieldedIdentityAuthorizationWitness(
    input.authorizationWitness,
    input.authorizationStateRoot,
    aliasR,
  );
  protocolAssert(
    lookup.authorizationCounter < MAX_UINT64,
    "SHIELDED_AUTHORIZATION_COUNTER_OVERFLOW",
    "Authorization counter cannot be incremented further",
  );
  const newCounter = lookup.authorizationCounter + 1n;
  let terminal = lookup.isOld0 ? EMPTY_NODE : leafNode(lookup.oldKey, lookup.oldValue);
  terminal = writeNode(terminal, aliasR, newCounter, Number(lookup.depth));
  let newRoot = terminal.hash;
  for (let level = Number(lookup.depth) - 1; level >= 0; level -= 1)
    newRoot =
      (aliasR >> BigInt(level)) & 1n
        ? poseidon2([lookup.siblings[level], newRoot])
        : poseidon2([newRoot, lookup.siblings[level]]);
  const authNullifier = poseidon6([
    SHIELDED_IDENTITY_COUNTER_AUTHORIZATION_DOMAIN,
    field(input.derivedSecretField, "derivedSecretField"),
    aliasR,
    chainId,
    consumer,
    lookup.authorizationCounter,
  ]);
  return {
    newRoot,
    publicSignals: [
      authNullifier,
      chainId,
      consumer,
      aliasR,
      lookup.stateRoot,
      newRoot,
      lookup.authorizationCounter,
      newCounter,
    ],
    witness: {
      chainId: String(chainId),
      consumer: String(consumer),
      aliasR: String(aliasR),
      oldRoot: String(lookup.stateRoot),
      newRoot: String(newRoot),
      oldCounter: String(lookup.authorizationCounter),
      newCounter: String(newCounter),
      siblings: lookup.siblings.map(String),
      oldKey: String(lookup.oldKey),
      oldValue: String(lookup.oldValue),
      isOld0: String(lookup.isOld0),
    },
  };
}

/**
 * Authorize one counter value using a constant-size owner statement. Its synthetic
 * roots are not live chain roots: the state contract checks its current counter
 * and independently updates the canonical tree after verifying this proof.
 */
export function prepareShieldedIdentityCounterAuthorization(input) {
  const counter = bigintFrom(input.authorizationCounter, "authorizationCounter", MAX_UINT64);
  const alias = computeShieldedAuthorizationAlias(input);
  const tree = createShieldedIdentityAuthorizationTree(counter === 0n ? [] : [[alias, counter]]);
  return prepareShieldedIdentityAuthorizationIncrementFromWitness({
    ...input,
    authorizationWitness: tree.getWitness(alias),
    authorizationStateRoot: tree.root,
  });
}

/** Prepare a transition for the owner circuit; identity preimage verification remains in-circuit. */
export function prepareShieldedIdentityAuthorizationIncrement(input) {
  const chainId = bigintFrom(input.chainId, "chainId", MAX_UINT64);
  const consumer = BigInt(getAddress(input.authorizationStateAddress));
  protocolAssert(
    chainId > 0n && consumer > 0n,
    "INVALID_SHIELDED_AUTHORIZATION_CONTEXT",
    "Authorization scope must be nonzero",
  );
  const aliasR = computeShieldedAuthorizationAlias(input);
  const lookup = getShieldedIdentityAuthorizationWitness(input.state, aliasR);
  protocolAssert(
    lookup.authorizationCounter < MAX_UINT64,
    "SHIELDED_AUTHORIZATION_COUNTER_OVERFLOW",
    "Authorization counter cannot be incremented further",
  );
  const newCounter = lookup.authorizationCounter + 1n;
  const records = new Map(input.state.entries);
  records.set(aliasR, newCounter);
  const nextState = buildShieldedIdentityAuthorizationState(records);
  const authNullifier = poseidon6([
    SHIELDED_IDENTITY_COUNTER_AUTHORIZATION_DOMAIN,
    field(input.derivedSecretField, "derivedSecretField"),
    aliasR,
    chainId,
    consumer,
    lookup.authorizationCounter,
  ]);
  return {
    nextState,
    publicSignals: [
      authNullifier,
      chainId,
      consumer,
      aliasR,
      lookup.stateRoot,
      nextState.root,
      lookup.authorizationCounter,
      newCounter,
    ],
    witness: {
      chainId: String(chainId),
      consumer: String(consumer),
      aliasR: String(aliasR),
      oldRoot: String(lookup.stateRoot),
      newRoot: String(nextState.root),
      oldCounter: String(lookup.authorizationCounter),
      newCounter: String(newCounter),
      siblings: lookup.siblings.map(String),
      oldKey: String(lookup.oldKey),
      oldValue: String(lookup.oldValue),
      isOld0: String(lookup.isOld0),
    },
  };
}

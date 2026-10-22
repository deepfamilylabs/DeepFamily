import { getAddress } from "ethers";
import { poseidon2, poseidon3, poseidon6 } from "poseidon-lite";
import { bigintFrom } from "./bytes.js";
import { MAX_UINT64, SNARK_SCALAR_FIELD } from "./constants.js";
import { protocolAssert } from "./errors.js";
import { computeShieldedAuthorizationAlias } from "./shielded-receive-credential.js";

export const SHIELDED_IDENTITY_AUTHORIZATION_DEPTH = 64;
export const SHIELDED_IDENTITY_COUNTER_AUTHORIZATION_DOMAIN = 202610210201n;
const field = (value, label) => bigintFrom(value, label, SNARK_SCALAR_FIELD - 1n);

function buildNode(entries, depth = 0) {
  if (entries.length === 0) return { kind: "empty", hash: 0n };
  if (entries.length === 1) {
    const [key, value] = entries[0];
    return { kind: "leaf", key, value, hash: poseidon3([key, value, 1n]) };
  }
  protocolAssert(
    depth < SHIELDED_IDENTITY_AUTHORIZATION_DEPTH,
    "SHIELDED_AUTHORIZATION_PATH_COLLISION",
    "Authorization dictionary keys exceed the supported path depth",
  );
  const left = [],
    right = [];
  for (const entry of entries) ((entry[0] >> BigInt(depth)) & 1n ? right : left).push(entry);
  const l = buildNode(left, depth + 1),
    r = buildNode(right, depth + 1);
  return { kind: "branch", left: l, right: r, hash: poseidon2([l.hash, r.hash]) };
}

/** Rebuild only public R/counter state. Zero counters are represented by absence. */
export function buildShieldedIdentityAuthorizationState(entries = []) {
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
  const node = buildNode([...records]);
  // The retained node is not mutable by callers; witnesses are rebuilt from the
  // public records to prevent a modified cached path being trusted as state.
  return { root: node.hash, entries: records };
}

export function getShieldedIdentityAuthorizationWitness(state, authorizationAlias) {
  const alias = field(authorizationAlias, "authorizationAlias");
  protocolAssert(alias !== 0n, "INVALID_SHIELDED_AUTHORIZATION_ENTRY", "Alias must be nonzero");
  const checked = buildShieldedIdentityAuthorizationState(state.entries);
  protocolAssert(
    checked.root === BigInt(state.root),
    "SHIELDED_AUTHORIZATION_ROOT_MISMATCH",
    "Authorization state root is inconsistent",
  );
  let node = buildNode([...checked.entries]);
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
    stateRoot: checked.root,
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

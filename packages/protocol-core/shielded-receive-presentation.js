import { AbiCoder, getAddress, getBytes, hexlify, keccak256 } from "ethers";
import { poseidon3 } from "poseidon-lite";
import { bigintFrom } from "./bytes.js";
import { MAX_UINT64, MAX_UINT128, SNARK_SCALAR_FIELD } from "./constants.js";
import { protocolAssert } from "./errors.js";
import { buildShieldedReceiveCredentialPublicSignals } from "./shielded-receive-credential.js";
import {
  buildShieldedIdentityAuthorizationState,
  getShieldedIdentityAuthorizationWitness,
} from "./shielded-identity-authorization.js";

export const SHIELDED_RECEIVE_PRESENTATION_ACTION = Object.freeze({
  Letter: 1,
  AttachedLetter: 2,
  Fund: 3,
  PrivateTransfer: 4,
});
export const SHIELDED_RECEIVE_BINDING_DOMAIN = 202610210102n;
export const SHIELDED_FUND_RECEIVE_BINDING_DOMAIN = 202610220102n;
const field = (value, label) => bigintFrom(value, label, SNARK_SCALAR_FIELD - 1n);
const check = (condition, message) =>
  protocolAssert(condition, "INVALID_SHIELDED_RECEIVE_PRESENTATION", message);

/** Shared by the presentation circuit and the money circuit's private receiver witness. */
export function computeShieldedReceiveCredentialBinding({ credential, salt }) {
  const signals = buildShieldedReceiveCredentialPublicSignals(credential);
  const offset = credential.disclosure === "fund" ? 1 : 0;
  const randomizer = field(salt, "salt");
  check(randomizer !== 0n, "A receive presentation requires a nonzero randomizer");
  let binding = poseidon3([SHIELDED_RECEIVE_BINDING_DOMAIN, signals[0], signals[3 + offset]]);
  binding = poseidon3([binding, signals[6 + offset], signals[4 + offset]]);
  binding = poseidon3([binding, signals[5 + offset], randomizer]);
  if (offset) binding = poseidon3([SHIELDED_FUND_RECEIVE_BINDING_DOMAIN, binding, signals[3]]);
  check(binding !== 0n, "A receive binding must be nonzero");
  return binding;
}

/** Exact ABI hash reconstructed by ShieldedPoolCore.receiveActionHash, excluding authorizations. */
export function computeShieldedReceiveActionHash(data) {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      [
        "uint256[]",
        "uint256[]",
        "uint256[]",
        "uint256[12]",
        "uint256[2]",
        "bytes[2]",
        "uint256",
        "uint256",
        "uint256",
        "uint256",
        "uint256",
        "uint256",
      ],
      [
        data.inputShardIds,
        data.inputRoots,
        data.inputNullifiers,
        data.periodNullifiers,
        data.outputCommitments,
        data.outputCiphertexts,
        data.relation0 ?? 0n,
        data.relation1 ?? 0n,
        data.asOf ?? 0n,
        data.lineageCheckpointId ?? 0n,
        data.fundMode ?? 0n,
        data.budgetKind ?? 0n,
      ],
    ),
  );
}

export function emptyShieldedReceiveAuthorizations() {
  return Array.from({ length: 2 }, () => ({
    checkpointId: 0n,
    asOf: 0n,
    expiresAt: 0n,
    recipientBinding: 0n,
    proof: "0x",
  }));
}

/**
 * Builds private prover input, never a public transport packet. The issuer and presentation
 * proofs are linked over hidden common inputs. No identity, R or reusable proof is sent on chain.
 */
export function prepareShieldedReceivePresentation(input) {
  const credential = input.credential;
  const signals = buildShieldedReceiveCredentialPublicSignals(credential);
  const action = bigintFrom(input.action, "action", 4n);
  check(action > 0n, "Unknown receive action");
  const isFund = credential.disclosure === "fund";
  check(isFund === (action === 3n), "Use the credential disclosure required by this operation");
  const chainId = bigintFrom(input.chainId, "chainId", MAX_UINT64);
  const consumer = BigInt(getAddress(input.consumer));
  const checkpointId = field(input.checkpointId, "checkpointId");
  const asOf = bigintFrom(input.asOf, "asOf", MAX_UINT64);
  const messageId = bigintFrom(input.messageId, "messageId", MAX_UINT128);
  check(chainId > 0n && consumer > 0n && checkpointId > 0n, "Receive context must be nonzero");
  check(asOf < signals[2], "Receive credential has expired at the selected state time");
  const hashBytes = getBytes(input.payloadHash);
  check(hashBytes.length === 32, "Receive operation hash must be 32 bytes");
  const hash = BigInt(hexlify(hashBytes));
  const lookup = getShieldedIdentityAuthorizationWitness(input.state, signals[0]);
  check(lookup.authorizationCounter === signals[1], "Receive credential has been revoked");
  const binding = computeShieldedReceiveCredentialBinding(input);
  const publicSignals = [
    chainId,
    consumer,
    action,
    messageId,
    hash & MAX_UINT128,
    hash >> 128n,
    checkpointId,
    lookup.stateRoot,
    asOf,
    signals[2],
    binding,
  ];
  const presentation = Object.fromEntries(
    [
      "chainId",
      "consumer",
      "action",
      "messageId",
      "cipherLo",
      "cipherHi",
      "checkpointId",
      "stateRoot",
      "asOf",
      "expiresAt",
      "binding",
    ].map((name, i) => [name, String(publicSignals[i])]),
  );
  Object.assign(presentation, {
    salt: String(input.salt),
    depth: String(lookup.depth),
    siblings: lookup.siblings.map(String),
    oldKey: String(lookup.oldKey),
    oldValue: String(lookup.oldValue),
    isOld0: String(lookup.isOld0),
    absent: String(lookup.absent),
  });
  const kind = action === 2n ? "attachment" : isFund ? "fund" : "anonymous";
  return {
    publicSignals,
    recipientBinding: binding,
    presentation,
    request: {
      kind,
      credentialProof: credential.proof,
      credentialPublicSignals: signals.map(String),
      presentation,
    },
  };
}

/**
 * The common prefix is public only to the local Groth16 prover. LinkG16 blinds it before
 * transport; callers must never submit the raw presentation proof or this prefix on chain.
 */
export function prepareReceivePresentationWitness(request) {
  const kinds = {
    anonymous: ["anonymousReceivePresentation", 11],
    fund: ["fundReceivePresentation", 12],
    attachment: ["attachedReceivePresentation", 11],
  };
  check(request && Object.hasOwn(kinds, request.kind), "Unsupported receive presentation kind");
  const [circuit, count] = kinds[request.kind];
  check(
    Array.isArray(request.credentialPublicSignals) &&
      request.credentialPublicSignals.length === count,
    "Incorrect credential signal count",
  );
  const commonInputs = request.credentialPublicSignals.map((value) =>
    String(field(value, "credential signal")),
  );
  const p = request.presentation;
  check(p && typeof p === "object", "Missing receive presentation");
  const publicNames = [
    "chainId",
    "consumer",
    "action",
    "messageId",
    "cipherLo",
    "cipherHi",
    "checkpointId",
    "stateRoot",
    "asOf",
    "expiresAt",
    "binding",
  ];
  const witness = { credentialPublicSignals: commonInputs };
  for (const name of [...publicNames, "salt", "depth", "oldKey", "oldValue", "isOld0", "absent"]) {
    witness[name] = String(field(p[name], name));
  }
  check(
    Array.isArray(p.siblings) && p.siblings.length === 64,
    "Authorization path requires 64 siblings",
  );
  witness.siblings = p.siblings.map((value) => String(field(value, "authorization sibling")));
  const publicInputs = publicNames.map((name) => witness[name]);
  if (request.kind === "attachment") {
    const a = request.attachment;
    check(a && typeof a === "object", "Missing attachment witness");
    for (const name of ["budgetPool", "budgetRoot", "relation"]) {
      witness[name] = String(field(a[name], name));
      publicInputs.push(witness[name]);
    }
    for (const name of [
      "policy",
      "enrollment",
      "rate",
      "remaining",
      "nonce",
      "ciphertextHash",
      "depth",
      "index",
    ]) {
      witness[`budget${name[0].toUpperCase()}${name.slice(1)}`] = String(field(a[name], name));
    }
    check(
      Array.isArray(a.siblings) && a.siblings.length === 32,
      "Budget path requires 32 siblings",
    );
    witness.budgetSiblings = a.siblings.map((value) => String(field(value, "budget sibling")));
  } else {
    check(request.attachment === undefined, "Unexpected attachment witness");
  }
  return { circuit, witness, commonInputs, publicInputs };
}

/** Rebuild from all contract events, never query an RPC with a private recipient alias. */
export function rebuildShieldedIdentityAuthorizationState(events, expectedRoot) {
  let state = buildShieldedIdentityAuthorizationState();
  let checkpoint = 1n;
  for (const event of events) {
    const args = event.args ?? event;
    const alias = field(args.aliasR, "aliasR");
    const oldCounter = bigintFrom(args.oldCounter, "oldCounter", MAX_UINT64);
    const newCounter = bigintFrom(args.newCounter, "newCounter", MAX_UINT64);
    check(BigInt(args.checkpointId) === ++checkpoint, "Incomplete authorization event history");
    check(BigInt(args.oldRoot) === state.root, "Authorization event root is inconsistent");
    check(
      (state.entries.get(alias) ?? 0n) === oldCounter && newCounter === oldCounter + 1n,
      "Authorization event counter is inconsistent",
    );
    const entries = new Map(state.entries);
    entries.set(alias, newCounter);
    state = buildShieldedIdentityAuthorizationState(entries);
    check(state.root === BigInt(args.newRoot), "Authorization event new root is inconsistent");
  }
  if (expectedRoot !== undefined)
    check(
      state.root === field(expectedRoot, "expectedRoot"),
      "Authorization history does not match the on-chain root",
    );
  return state;
}

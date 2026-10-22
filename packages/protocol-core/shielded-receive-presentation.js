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
 * Builds private prover input, never a public transport packet. A fixed issuer key must verify
 * credentialProof inside the presentation circuit. No identity, R or reusable proof is sent on chain.
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

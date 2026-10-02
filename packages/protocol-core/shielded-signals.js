import { getAddress } from "ethers";
import { bigintFrom } from "./bytes.js";
import { MAX_UINT64, MAX_UINT128, SNARK_SCALAR_FIELD } from "./constants.js";
import { protocolAssert } from "./errors.js";
import { computeShieldedCiphertextHashField } from "./shielded-inheritance.js";
import { splitShieldedViewPublicKey } from "./shielded-hpke.js";

export const SHIELDED_POOL_ACTION = Object.freeze({
  Shield: 0,
  Fund: 1,
  Claim: 2,
  PrivateTransfer: 3,
  Unshield: 4,
  ClaimPublic: 5,
});

const MAX_FIELD = SNARK_SCALAR_FIELD - 1n;
const field = (value, label) => bigintFrom(value, label, MAX_FIELD);

const CONTEXT = ["chainId", "pool"];
const ONE_INPUT = ["inputShardId", "inputRoot", "inputNullifiers"];
const TWO_INPUTS = ["inputShardIds", "inputRoots", "inputNullifiers"];
const OUTPUTS = ["outputCommitments", "ciphertextHashes"];
const LINEAGE = ["endorsementRoot", "trustedRoot", "asOf"];

/**
 * Each action's circuit declares exactly these named public inputs, in this order.
 * ShieldedDeepPool._publicSignals builds the same sequence. Single-input actions
 * repeat their first input shard and root in ActionData's second slot; only the
 * first pair is a public input.
 */
export const SHIELDED_POOL_PUBLIC_INPUTS = Object.freeze({
  [SHIELDED_POOL_ACTION.Shield]: Object.freeze([...CONTEXT, ...OUTPUTS, "amount"]),
  [SHIELDED_POOL_ACTION.Fund]: Object.freeze([
    ...CONTEXT,
    "fundMode",
    ...TWO_INPUTS,
    ...OUTPUTS,
    ...LINEAGE,
  ]),
  [SHIELDED_POOL_ACTION.Claim]: Object.freeze([
    ...CONTEXT,
    ...TWO_INPUTS,
    "periodNullifiers",
    ...OUTPUTS,
    ...LINEAGE,
  ]),
  [SHIELDED_POOL_ACTION.PrivateTransfer]: Object.freeze([...CONTEXT, ...TWO_INPUTS, ...OUTPUTS]),
  [SHIELDED_POOL_ACTION.Unshield]: Object.freeze([
    ...CONTEXT,
    ...ONE_INPUT,
    ...OUTPUTS,
    "amount",
    "recipient",
  ]),
  [SHIELDED_POOL_ACTION.ClaimPublic]: Object.freeze([
    ...CONTEXT,
    "budgetId",
    "heirIdentityCommitment",
    "firstPeriod",
    "claimCount",
    "amount",
    ...OUTPUTS,
  ]),
});

const INPUT_WIDTHS = Object.freeze({
  chainId: 1,
  pool: 1,
  fundMode: 1,
  inputShardId: 1,
  inputRoot: 1,
  inputShardIds: 2,
  inputRoots: 2,
  inputNullifiers: 2,
  periodNullifiers: 12,
  outputCommitments: 2,
  ciphertextHashes: 2,
  amount: 1,
  recipient: 1,
  endorsementRoot: 1,
  trustedRoot: 1,
  asOf: 1,
  budgetId: 1,
  heirIdentityCommitment: 1,
  firstPeriod: 1,
  claimCount: 1,
});

/** Mirrors the per-purpose lengths in ProofConstants.sol. */
export const SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS = Object.freeze(
  Object.fromEntries(
    Object.entries(SHIELDED_POOL_PUBLIC_INPUTS).map(([action, names]) => [
      action,
      names.reduce((total, name) => total + INPUT_WIDTHS[name], 0),
    ]),
  ),
);

export const SHIELDED_RECEIVE_CODE_PUBLIC_SIGNAL_COUNT = 4;

function values(list, length, label) {
  protocolAssert(
    Array.isArray(list) && list.length === length,
    "INVALID_SHIELDED_SIGNAL_SHAPE",
    `${label} must have ${length} values`,
  );
  return list.map((value, index) => field(value, `${label}[${index}]`));
}

function unused(condition, label) {
  protocolAssert(condition, "INVALID_SHIELDED_ACTION_DATA", `${label} is not used by this action`);
}

/**
 * Build one action's proof inputs from ShieldedDeepPool.ActionData plus the
 * external amount and recipient. `signals` is the ordered verifier input;
 * `witness` holds the same values under the circuit's named inputs.
 * Data the action does not use must be zero, as the pool requires.
 */
export function buildShieldedPoolPublicInputs(input) {
  const action = Number(bigintFrom(input.action, "action", 4n));
  const names = SHIELDED_POOL_PUBLIC_INPUTS[action];
  const inputShardIds = values(input.inputShardIds, 2, "inputShardIds");
  const inputRoots = values(input.inputRoots, 2, "inputRoots");
  const inputNullifiers = values(input.inputNullifiers, 2, "inputNullifiers");
  const periodNullifiers = values(input.periodNullifiers, 12, "periodNullifiers");
  const outputCommitments = values(input.outputCommitments, 2, "outputCommitments");
  protocolAssert(
    Array.isArray(input.outputCiphertexts) && input.outputCiphertexts.length === 2,
    "INVALID_SHIELDED_SIGNAL_SHAPE",
    "outputCiphertexts must have 2 values",
  );
  const available = {
    chainId: [bigintFrom(input.chainId, "chainId", MAX_UINT64)],
    pool: [BigInt(getAddress(input.poolAddress))],
    fundMode: [bigintFrom(input.fundMode ?? 0n, "fundMode", 1n)],
    inputShardId: [inputShardIds[0]],
    inputRoot: [inputRoots[0]],
    inputShardIds,
    inputRoots,
    inputNullifiers,
    periodNullifiers,
    outputCommitments,
    ciphertextHashes: input.outputCiphertexts.map(computeShieldedCiphertextHashField),
    amount: [bigintFrom(input.amount ?? 0n, "amount", MAX_UINT128)],
    recipient: [input.recipient === undefined ? 0n : BigInt(getAddress(input.recipient))],
    endorsementRoot: [field(input.relation0 ?? 0n, "relation0")],
    trustedRoot: [field(input.relation1 ?? 0n, "relation1")],
    asOf: [bigintFrom(input.asOf ?? 0n, "asOf", MAX_UINT64)],
  };

  const uses = new Set(names);
  if (action === SHIELDED_POOL_ACTION.Fund && available.fundMode[0] === 0n) {
    unused(
      inputShardIds[1] === inputShardIds[0] && inputRoots[1] === inputRoots[0],
      "Initial fund second root",
    );
  }
  if (action === SHIELDED_POOL_ACTION.Fund && available.fundMode[0] === 1n) {
    unused(
      [...available.endorsementRoot, ...available.trustedRoot, ...available.asOf].every(
        (value) => value === 0n,
      ),
      "Continuation fund lineage/time",
    );
  }
  if (uses.has("inputShardId")) {
    unused(
      inputShardIds[1] === inputShardIds[0] && inputRoots[1] === inputRoots[0],
      "A second input root",
    );
  } else if (!uses.has("inputShardIds")) {
    unused(
      [...inputShardIds, ...inputRoots, ...inputNullifiers].every((value) => value === 0n),
      "Note input",
    );
  }
  for (const name of [
    "periodNullifiers",
    "fundMode",
    "amount",
    "recipient",
    "endorsementRoot",
    "trustedRoot",
    "asOf",
  ]) {
    if (!uses.has(name))
      unused(
        available[name].every((value) => value === 0n),
        name,
      );
  }

  const signals = [];
  const witness = {};
  for (const name of names) {
    const entries = available[name];
    signals.push(...entries);
    witness[name] = INPUT_WIDTHS[name] === 1 ? entries[0].toString() : entries.map(String);
  }
  return { signals, witness };
}

/** The ordered verifier input for one pool action. */
export function buildShieldedPoolPublicSignals(input) {
  return buildShieldedPoolPublicInputs(input).signals;
}

/** Public budget claims have their own calldata shape and no note inputs. */
export function buildShieldedPublicClaimPublicInputs(input) {
  const budgetId = bigintFrom(input.budgetId, "budgetId", MAX_UINT64);
  const identity = field(input.heirIdentityCommitment, "heirIdentityCommitment");
  const firstPeriod = bigintFrom(input.firstPeriod, "firstPeriod", MAX_UINT64);
  const claimCount = bigintFrom(input.claimCount, "claimCount", 12n);
  const amount = bigintFrom(input.amount, "amount", MAX_UINT128);
  const outputCommitments = values(input.outputCommitments, 2, "outputCommitments");
  protocolAssert(
    budgetId > 0n &&
      identity > 0n &&
      claimCount > 0n &&
      amount > 0n &&
      firstPeriod + claimCount <= MAX_UINT64 &&
      outputCommitments.every((value) => value > 0n) &&
      outputCommitments[0] !== outputCommitments[1],
    "INVALID_SHIELDED_PUBLIC_CLAIM",
    "Public claim needs a budget, identity, mature period range and distinct outputs",
  );
  protocolAssert(
    Array.isArray(input.outputCiphertexts) && input.outputCiphertexts.length === 2,
    "INVALID_SHIELDED_SIGNAL_SHAPE",
    "outputCiphertexts must have 2 values",
  );
  const available = {
    chainId: [bigintFrom(input.chainId, "chainId", MAX_UINT64)],
    pool: [BigInt(getAddress(input.poolAddress))],
    budgetId: [budgetId],
    heirIdentityCommitment: [identity],
    firstPeriod: [firstPeriod],
    claimCount: [claimCount],
    amount: [amount],
    outputCommitments,
    ciphertextHashes: input.outputCiphertexts.map(computeShieldedCiphertextHashField),
  };
  const signals = [];
  const witness = {};
  for (const name of SHIELDED_POOL_PUBLIC_INPUTS[SHIELDED_POOL_ACTION.ClaimPublic]) {
    signals.push(...available[name]);
    witness[name] =
      INPUT_WIDTHS[name] === 1 ? available[name][0].toString() : available[name].map(String);
  }
  return { signals, witness };
}

/**
 * A receive code proves that the holder of `identityCommitment` chose these
 * payment keys. The keys do not depend on chain or pool, so neither is bound.
 */
export function buildShieldedReceiveCodePublicSignals(input) {
  const identityCommitment = field(input.identityCommitment, "identityCommitment");
  const ownerCommitment = field(input.ownerCommitment, "ownerCommitment");
  protocolAssert(
    identityCommitment !== 0n && ownerCommitment !== 0n,
    "ZERO_SHIELDED_SECRET",
    "Receive code commitments must be nonzero",
  );
  const { viewKeyLo, viewKeyHi } = splitShieldedViewPublicKey(input.viewingKey);
  protocolAssert(
    viewKeyLo !== 0n || viewKeyHi !== 0n,
    "ZERO_SHIELDED_VIEW_KEY",
    "view public key must be nonzero",
  );
  return [identityCommitment, ownerCommitment, viewKeyLo, viewKeyHi];
}

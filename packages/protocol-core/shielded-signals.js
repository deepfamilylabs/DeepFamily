import { getAddress } from "ethers";
import { bigintFrom } from "./bytes.js";
import { MAX_UINT64, MAX_UINT128, SNARK_SCALAR_FIELD } from "./constants.js";
import { protocolAssert } from "./errors.js";
import { computeShieldedCiphertextHashField } from "./shielded-inheritance.js";
import { splitShieldedViewPublicKey } from "./shielded-hpke.js";
import {
  decodePublicShieldedBudgetEnvelope,
  getShieldedPublicBudgetFields,
} from "./shielded-note-codec.js";

export const SHIELDED_POOL_ACTION = Object.freeze({
  Shield: 0,
  Fund: 1,
  Claim: 2,
  PrivateTransfer: 3,
  Unshield: 4,
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
 * ShieldedPoolCore._publicSignals builds the same sequence. Single-input actions
 * repeat their first input shard and root in ActionData's second slot; only the
 * first pair is a public input.
 */
export const SHIELDED_POOL_PUBLIC_INPUTS = Object.freeze({
  [SHIELDED_POOL_ACTION.Shield]: Object.freeze([...CONTEXT, ...OUTPUTS, "amount"]),
  [SHIELDED_POOL_ACTION.Fund]: Object.freeze([
    ...CONTEXT,
    "fundMode",
    "budgetKind",
    "publicBudget",
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
});

const INPUT_WIDTHS = Object.freeze({
  chainId: 1,
  pool: 1,
  fundMode: 1,
  budgetKind: 1,
  publicBudget: 10,
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

export const SHIELDED_RECEIVE_CODE_PUBLIC_SIGNAL_COUNT = 9;
export const SHIELDED_POOL_CAPACITY_PUBLIC_SIGNAL_COUNTS = Object.freeze({
  [SHIELDED_POOL_ACTION.PrivateTransfer]: Object.freeze({ 2: 12, 8: 30 }),
  [SHIELDED_POOL_ACTION.Unshield]: Object.freeze({ 1: 12, 8: 32 }),
});

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
 * Build one action's proof inputs from ShieldedPoolCore.ActionData plus the
 * external amount and recipient. `signals` is the ordered verifier input;
 * `witness` holds the same values under the circuit's named inputs.
 * Data the action does not use must be zero, as the pool requires.
 */
export function buildShieldedPoolPublicInputs(input) {
  const action = Number(bigintFrom(input.action, "action", 4n));
  const valueAction =
    action === SHIELDED_POOL_ACTION.PrivateTransfer || action === SHIELDED_POOL_ACTION.Unshield;
  const capacity =
    input.capacity === undefined
      ? valueAction && input.inputShardIds?.length === 8
        ? 8
        : action === SHIELDED_POOL_ACTION.Unshield
          ? 1
          : 2
      : Number(bigintFrom(input.capacity, "capacity", 8n));
  protocolAssert(
    valueAction
      ? (action === SHIELDED_POOL_ACTION.Unshield ? [1, 8] : [2, 8]).includes(capacity)
      : capacity === 2,
    "INVALID_SHIELDED_CAPACITY",
    "Unsupported capacity for this action",
  );
  const width = capacity === 8 ? 8 : 2;
  const names =
    action === SHIELDED_POOL_ACTION.Unshield && capacity === 8
      ? [...CONTEXT, ...TWO_INPUTS, ...OUTPUTS, "amount", "recipient"]
      : SHIELDED_POOL_PUBLIC_INPUTS[action];
  const inputShardIds = values(input.inputShardIds, width, "inputShardIds");
  const inputRoots = values(input.inputRoots, width, "inputRoots");
  const inputNullifiers = values(input.inputNullifiers, width, "inputNullifiers");
  const periodNullifiers = values(input.periodNullifiers, 12, "periodNullifiers");
  const outputCommitments = values(input.outputCommitments, 2, "outputCommitments");
  protocolAssert(
    Array.isArray(input.outputCiphertexts) && input.outputCiphertexts.length === 2,
    "INVALID_SHIELDED_SIGNAL_SHAPE",
    "outputCiphertexts must have 2 values",
  );
  const budgetKind = bigintFrom(input.budgetKind ?? 0n, "budgetKind", 1n);
  if (action !== SHIELDED_POOL_ACTION.Fund) unused(budgetKind === 0n, "budgetKind");
  let publicBudget = Array(10).fill(0n);
  if (budgetKind === 1n) {
    const scope = { chainId: input.chainId, poolAddress: input.poolAddress };
    const note = decodePublicShieldedBudgetEnvelope(input.outputCiphertexts[0], scope);
    protocolAssert(
      note !== null,
      "INVALID_SHIELDED_PUBLIC_BUDGET",
      "Public funding requires a canonical identity-budget envelope in output zero",
    );
    publicBudget = getShieldedPublicBudgetFields(note, scope);
  }
  if (input.publicBudget !== undefined) {
    const provided = values(input.publicBudget, 10, "publicBudget");
    protocolAssert(
      provided.every((value, index) => value === publicBudget[index]),
      "INVALID_SHIELDED_PUBLIC_BUDGET",
      "Public budget fields must equal the envelope, or zero for private funding",
    );
  }
  const available = {
    chainId: [bigintFrom(input.chainId, "chainId", MAX_UINT64)],
    pool: [BigInt(getAddress(input.poolAddress))],
    fundMode: [bigintFrom(input.fundMode ?? 0n, "fundMode", 1n)],
    budgetKind: [budgetKind],
    publicBudget,
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
    "budgetKind",
    "publicBudget",
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
  const keyMode = bigintFrom(input.keyMode ?? 0n, "keyMode", 1n);
  const metadata = [
    input.identitySuiteId ?? 1,
    input.assetSuiteId ?? 1,
    input.assetDerivationVersion ?? 1,
    input.receiveCodeVersion ?? 2,
  ].map((value, index) => bigintFrom(value, `receiveMetadata[${index}]`, 255n));
  protocolAssert(
    metadata[0] === 1n && metadata[1] === 1n && metadata[2] === 1n && metadata[3] === 2n,
    "UNSUPPORTED_SHIELDED_RECEIVE_SUITE",
    "Unsupported receive-code suite or version",
  );
  return [identityCommitment, ownerCommitment, viewKeyLo, viewKeyHi, keyMode, ...metadata];
}

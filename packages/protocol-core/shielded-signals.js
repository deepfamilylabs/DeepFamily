import { getAddress } from "ethers";
import { bigintFrom } from "./bytes.js";
import { MAX_UINT64, MAX_UINT128, SNARK_SCALAR_FIELD } from "./constants.js";
import { protocolAssert } from "./errors.js";
import { computeShieldedCiphertextHashField } from "./shielded-inheritance.js";
import {
  decodePublicShieldedBudgetEnvelope,
  getShieldedPublicBudgetFields,
} from "./shielded-note-codec.js";
import {
  SHIELDED_POOL_ACTION,
  SHIELDED_POOL_PUBLIC_INPUTS,
  SHIELDED_POOL_INPUT_WIDTHS as INPUT_WIDTHS,
  shieldedInputSlotCount as inputSlotCount,
} from "./shielded-signal-layout.js";
export {
  SHIELDED_POOL_ACTION,
  SHIELDED_POOL_PUBLIC_INPUTS,
  SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS,
  SHIELDED_VALUE_PUBLIC_SIGNAL_COUNTS,
} from "./shielded-signal-layout.js";

const MAX_FIELD = SNARK_SCALAR_FIELD - 1n;
const field = (value, label) => bigintFrom(value, label, MAX_FIELD);

function isValueAction(action) {
  return action === SHIELDED_POOL_ACTION.PrivateTransfer || action === SHIELDED_POOL_ACTION.Unshield;
}

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
  const width = isValueAction(action) ? input.inputRoots?.length : inputSlotCount(action);
  protocolAssert(
    !isValueAction(action) || width === 1 || width === 4,
    "INVALID_SHIELDED_SIGNAL_SHAPE",
    "VALUE actions require one or four input slots",
  );
  const names = SHIELDED_POOL_PUBLIC_INPUTS[action];
  const inputShardIds = values(input.inputShardIds, width, "inputShardIds");
  const inputRoots = values(input.inputRoots, width, "inputRoots");
  const inputNullifiers = values(input.inputNullifiers, width, "inputNullifiers");
  const periodNullifiers = values(input.periodNullifiers, 3, "periodNullifiers");
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
    receiveBindings: values(
      input.receiveBindings ??
        input.receiveAuthorizations?.map((item) => item.recipientBinding) ?? [0n, 0n],
      2,
      "receiveBindings",
    ),
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
  if (!uses.has("inputRoots")) {
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
    "receiveBindings",
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

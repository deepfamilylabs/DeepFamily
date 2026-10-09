import { poseidon3, poseidon4 } from "poseidon-lite";
import { MAX_UINT128, SNARK_SCALAR_FIELD } from "./constants.js";
import {
  computeShieldedScopedPurpose,
  SHIELDED_INHERITANCE_DOMAINS,
} from "./shielded-inheritance.js";

/** Slot one retains the two-slot domain; further placeholders have a distinct slot domain. */
export function computeShieldedDummyInputNullifierForSlot(
  ownerSecret,
  firstCommitment,
  slot,
  scope,
) {
  if (!Number.isInteger(slot) || slot < 1 || slot > 7)
    throw new Error("Dummy input slot must be 1..7");
  const secret = BigInt(ownerSecret);
  const commitment = BigInt(firstCommitment);
  if (
    secret <= 0n ||
    secret >= SNARK_SCALAR_FIELD ||
    commitment <= 0n ||
    commitment >= SNARK_SCALAR_FIELD
  ) {
    throw new Error("Dummy input requires nonzero field owner secret and commitment");
  }
  const tag = computeShieldedScopedPurpose(SHIELDED_INHERITANCE_DOMAINS.dummyInputNullifier, scope);
  return slot === 1
    ? poseidon3([tag, secret, commitment])
    : poseidon4([tag, secret, commitment, BigInt(slot)]);
}

/**
 * Pure, deterministic preview. Candidate notes are a permission boundary, not a request to
 * consume every note. Generated IDs describe later steps; clients re-scan after each receipt.
 */
export function planShieldedValueSpend({ notes, candidateCommitments, amount, maxInputs = 8 }) {
  const target = BigInt(amount);
  if (target <= 0n || target > MAX_UINT128)
    throw new Error("Spend amount must be positive uint128");
  if (![1, 2, 8].includes(maxInputs)) throw new Error("Spend capacity must be 1, 2 or 8");
  if (!Array.isArray(notes)) throw new Error("Candidate notes must be an array");
  const commitmentId = (value) => {
    const commitment = BigInt(value);
    if (commitment <= 0n || commitment >= SNARK_SCALAR_FIELD)
      throw new Error("VALUE commitment must be a nonzero field element");
    return String(commitment);
  };
  const permitted =
    candidateCommitments === undefined
      ? undefined
      : new Set(candidateCommitments.map(commitmentId));
  if (permitted && permitted.size !== candidateCommitments.length)
    throw new Error("Candidate commitments must be unique");
  const seen = new Set();
  const candidates = notes
    .filter((note) => !permitted || permitted.has(commitmentId(note.commitment)))
    .map((note) => {
      const commitment = commitmentId(note.commitment);
      const value = BigInt(note.amount);
      if (seen.has(commitment)) throw new Error("Duplicate VALUE candidate");
      seen.add(commitment);
      if (value <= 0n || value > MAX_UINT128)
        throw new Error("VALUE candidate amount must be positive uint128");
      return { ...note, commitment, amount: value };
    });
  if (permitted && [...permitted].some((commitment) => !seen.has(commitment))) {
    throw new Error("A selected VALUE candidate is unavailable");
  }
  for (const field of ["ownerCommitment", "chainId", "poolAddress"]) {
    const values = new Set(
      candidates.map((note) =>
        note[field] === undefined ? undefined : String(note[field]).toLowerCase(),
      ),
    );
    if (values.size > 1) throw new Error(`VALUE candidates must share ${field}`);
  }
  if (candidates.reduce((sum, note) => sum + note.amount, 0n) < target)
    throw new Error("Insufficient candidate VALUE balance");
  const byAmount = (a, b) =>
    a.amount === b.amount ? a.commitment.localeCompare(b.commitment) : a.amount > b.amount ? -1 : 1;
  let available = [...candidates];
  const steps = [];
  const usedOriginal = new Set();
  for (;;) {
    available.sort(byAmount);
    const single = available
      .filter((note) => note.amount >= target)
      .sort((a, b) => -byAmount(a, b))[0];
    let selected;
    if (single) selected = [single];
    else {
      selected = [];
      let total = 0n;
      for (const note of available) {
        selected.push(note);
        total += note.amount;
        if (total >= target) break;
      }
    }
    const final = selected.length <= maxInputs;
    // Transfers can merge up to eight even when the final operation (Fund) consumes one.
    const inputs = final ? selected : selected.slice(0, 8);
    const total = inputs.reduce((sum, note) => sum + note.amount, 0n);
    const principal = final || total >= target ? target : total;
    const remainder = total - principal;
    if (principal > MAX_UINT128 || remainder > MAX_UINT128 || remainder < 0n) {
      throw new Error("The planned step cannot fit two uint128 outputs");
    }
    const index = steps.length;
    const outputs = [`planned:${index}:0`, `planned:${index}:1`];
    for (const note of inputs) if (seen.has(note.commitment)) usedOriginal.add(note.commitment);
    steps.push({
      kind: final ? "spend" : "merge",
      capacity: inputs.length <= 2 ? 2 : 8,
      inputCommitments: inputs.map((note) => note.commitment),
      inputAmount: total,
      outputAmounts: [principal, remainder],
      outputCommitments: outputs,
    });
    if (final) break;
    const consumed = new Set(inputs.map((note) => note.commitment));
    available = available.filter((note) => !consumed.has(note.commitment));
    available.push({ ...inputs[0], commitment: outputs[0], amount: principal });
    if (remainder > 0n) available.push({ ...inputs[0], commitment: outputs[1], amount: remainder });
  }
  return { amount: target, maxInputs, steps, selectedCommitments: [...usedOriginal] };
}

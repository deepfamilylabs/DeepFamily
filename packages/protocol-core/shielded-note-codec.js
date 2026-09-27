import { asUint8Array, bigintFrom } from "./bytes.js";
import { MAX_UINT64, MAX_UINT128, SNARK_SCALAR_FIELD } from "./constants.js";
import { ProtocolError, protocolAssert } from "./errors.js";
import { SHIELDED_HPKE_MAX_PAYLOAD_BYTES } from "./shielded-hpke.js";
import {
  computeShieldedBudgetNoteCommitment,
  computeShieldedAllocationKeyCommitment,
  computeShieldedCiphertextHashField,
  computeShieldedEnrollmentCommitment,
  computeShieldedPolicyCommitment,
  computeShieldedPolicyNoteCommitment,
  computeShieldedValueNoteCommitment,
} from "./shielded-inheritance.js";

export const SHIELDED_NOTE_PAYLOAD_VERSION = 1;
export const SHIELDED_VALUE_NOTE_KIND = 1;
export const SHIELDED_BUDGET_NOTE_KIND = 2;
export const SHIELDED_POLICY_NOTE_KIND = 3;
export const SHIELDED_VALUE_WITH_BUDGET_MEMO_KIND = 4;
export const SHIELDED_VALUE_NOTE_PAYLOAD_BYTES = 86;
export const SHIELDED_BUDGET_NOTE_PAYLOAD_BYTES = 302;
export const SHIELDED_POLICY_NOTE_PAYLOAD_BYTES = 182;
export const SHIELDED_VALUE_WITH_BUDGET_MEMO_PAYLOAD_BYTES =
  SHIELDED_VALUE_NOTE_PAYLOAD_BYTES + 32 + SHIELDED_BUDGET_NOTE_PAYLOAD_BYTES;

const MAGIC = Uint8Array.of(0x44, 0x46, 0x53, 0x4e); // DFSN
const HEADER_BYTES = 6;
const MAX_FIELD = SNARK_SCALAR_FIELD - 1n;
const valueSchema = [
  ["ownerCommitment", 32, MAX_FIELD],
  ["amount", 16, MAX_UINT128],
  ["nonce", 32, MAX_FIELD],
];
const budgetSchema = [
  ["rootIdentityCommitment", 32, MAX_FIELD],
  ["rootVersionIndex", 32, MAX_FIELD],
  ["policySalt", 32, MAX_FIELD],
  ["allocationKeyCommitment", 32, MAX_FIELD],
  ["heirIdentityCommitment", 32, MAX_FIELD],
  ["eligibleFrom", 8, MAX_UINT64],
  ["enrollmentSalt", 32, MAX_FIELD],
  ["heirOwnerCommitment", 32, MAX_FIELD],
  ["amountPerPeriod", 16, MAX_UINT128],
  ["remaining", 16, MAX_UINT128],
  ["nonce", 32, MAX_FIELD],
];
const policySchema = [
  ["rootIdentityCommitment", 32, MAX_FIELD],
  ["rootVersionIndex", 32, MAX_FIELD],
  ["amountPerPeriod", 16, MAX_UINT128],
  ["policySalt", 32, MAX_FIELD],
  ["allocationKey", 32, MAX_FIELD],
  ["nonce", 32, MAX_FIELD],
];

function writeFixedUint(output, offset, value, width, maximum, label) {
  let remaining = bigintFrom(value, label, maximum);
  for (let index = offset + width - 1; index >= offset; index -= 1) {
    output[index] = Number(remaining & 255n);
    remaining >>= 8n;
  }
}

function readFixedUint(input, offset, width, maximum, label) {
  let result = 0n;
  for (let index = offset; index < offset + width; index += 1) {
    result = (result << 8n) | BigInt(input[index]);
  }
  return bigintFrom(result, label, maximum);
}

function encode(kind, value, schema, expectedLength) {
  const output = new Uint8Array(expectedLength);
  try {
    output.set(MAGIC);
    output[4] = SHIELDED_NOTE_PAYLOAD_VERSION;
    output[5] = kind;
    let offset = HEADER_BYTES;
    for (const [label, width, maximum] of schema) {
      writeFixedUint(output, offset, value[label], width, maximum, label);
      offset += width;
    }
    protocolAssert(
      offset === expectedLength,
      "INVALID_SHIELDED_NOTE_SCHEMA",
      "Note schema length mismatch",
    );
    protocolAssert(
      output.length <= SHIELDED_HPKE_MAX_PAYLOAD_BYTES,
      "SHIELDED_NOTE_TOO_LARGE",
      "Note does not fit inside the fixed HPKE envelope",
    );
    return output;
  } catch (error) {
    output.fill(0);
    throw error;
  }
}

/** Encode a private fungible-value note, including zero-value dummy outputs. */
export function encodeShieldedValueNotePayload(note) {
  // Validate nonzero owner/nonce exactly as the commitment helper does.
  computeShieldedValueNoteCommitment({ ...note, ciphertextHashField: 0n });
  if (note.topUpMemo === undefined) {
    return encode(SHIELDED_VALUE_NOTE_KIND, note, valueSchema, SHIELDED_VALUE_NOTE_PAYLOAD_BYTES);
  }
  const base = encode(
    SHIELDED_VALUE_WITH_BUDGET_MEMO_KIND,
    note,
    valueSchema,
    SHIELDED_VALUE_NOTE_PAYLOAD_BYTES,
  );
  const budget = encodeShieldedBudgetNotePayload(note.topUpMemo.budgetNote);
  const output = new Uint8Array(SHIELDED_VALUE_WITH_BUDGET_MEMO_PAYLOAD_BYTES);
  try {
    const budgetCommitment = bigintFrom(
      note.topUpMemo.budgetCommitment,
      "budgetCommitment",
      MAX_FIELD,
    );
    protocolAssert(
      budgetCommitment !== 0n,
      "ZERO_SHIELDED_BUDGET_COMMITMENT",
      "Memo budget commitment must be nonzero",
    );
    output.set(base);
    writeFixedUint(
      output,
      SHIELDED_VALUE_NOTE_PAYLOAD_BYTES,
      budgetCommitment,
      32,
      MAX_FIELD,
      "budgetCommitment",
    );
    output.set(budget, SHIELDED_VALUE_NOTE_PAYLOAD_BYTES + 32);
    return output;
  } catch (error) {
    output.fill(0);
    throw error;
  } finally {
    base.fill(0);
    budget.fill(0);
  }
}

/** Encode an allocated or continuation budget note, including zero remainder. */
export function encodeShieldedBudgetNotePayload(note) {
  const policyCommitment = computeShieldedPolicyCommitment(note);
  const enrollmentCommitment = computeShieldedEnrollmentCommitment({
    policyCommitment,
    heirIdentityCommitment: note.heirIdentityCommitment,
    eligibleFrom: note.eligibleFrom,
    enrollmentSalt: note.enrollmentSalt,
  });
  computeShieldedBudgetNoteCommitment({
    policyCommitment,
    enrollmentCommitment,
    heirOwnerCommitment: note.heirOwnerCommitment,
    amountPerPeriod: note.amountPerPeriod,
    remaining: note.remaining,
    nonce: note.nonce,
    ciphertextHashField: 0n,
  });
  return encode(SHIELDED_BUDGET_NOTE_KIND, note, budgetSchema, SHIELDED_BUDGET_NOTE_PAYLOAD_BYTES);
}

/**
 * Encode an immutable, zero-value policy template. Knowledge of its private
 * policySalt, allocationKey and a membership proof authorizes the first
 * private allocation for each heir.
 */
export function encodeShieldedPolicyNotePayload(note) {
  const policyCommitment = computeShieldedPolicyCommitment({
    ...note,
    allocationKeyCommitment: computeShieldedAllocationKeyCommitment(note.allocationKey),
  });
  computeShieldedPolicyNoteCommitment({
    policyCommitment,
    nonce: note.nonce,
    ciphertextHashField: 0n,
  });
  return encode(SHIELDED_POLICY_NOTE_KIND, note, policySchema, SHIELDED_POLICY_NOTE_PAYLOAD_BYTES);
}

/** Decode only exact, versioned, fixed-width payloads; no trailing bytes. */
export function decodeShieldedNotePayload(payload) {
  const input = asUint8Array(payload, "shielded note payload");
  protocolAssert(
    input.length >= HEADER_BYTES,
    "TRUNCATED_SHIELDED_NOTE",
    "Note payload is truncated",
  );
  protocolAssert(
    MAGIC.every((byte, index) => input[index] === byte),
    "INVALID_SHIELDED_NOTE_MAGIC",
    "Note payload has invalid magic",
  );
  protocolAssert(
    input[4] === SHIELDED_NOTE_PAYLOAD_VERSION,
    "UNSUPPORTED_SHIELDED_NOTE_VERSION",
    "Unsupported note payload version",
  );
  const kind = input[5];
  const schema =
    kind === SHIELDED_VALUE_NOTE_KIND || kind === SHIELDED_VALUE_WITH_BUDGET_MEMO_KIND
      ? valueSchema
      : kind === SHIELDED_BUDGET_NOTE_KIND
        ? budgetSchema
        : kind === SHIELDED_POLICY_NOTE_KIND
          ? policySchema
          : null;
  protocolAssert(schema !== null, "UNSUPPORTED_SHIELDED_NOTE_KIND", "Unsupported note kind");
  const expectedLength =
    kind === SHIELDED_VALUE_NOTE_KIND
      ? SHIELDED_VALUE_NOTE_PAYLOAD_BYTES
      : kind === SHIELDED_VALUE_WITH_BUDGET_MEMO_KIND
        ? SHIELDED_VALUE_WITH_BUDGET_MEMO_PAYLOAD_BYTES
      : kind === SHIELDED_BUDGET_NOTE_KIND
        ? SHIELDED_BUDGET_NOTE_PAYLOAD_BYTES
        : SHIELDED_POLICY_NOTE_PAYLOAD_BYTES;
  protocolAssert(
    input.length === expectedLength,
    "INVALID_SHIELDED_NOTE_LENGTH",
    "Note payload has invalid length",
  );
  const note = {
    kind:
      kind === SHIELDED_VALUE_NOTE_KIND || kind === SHIELDED_VALUE_WITH_BUDGET_MEMO_KIND
        ? "value"
        : kind === SHIELDED_BUDGET_NOTE_KIND
          ? "budget"
          : "policy",
  };
  let offset = HEADER_BYTES;
  for (const [label, width, maximum] of schema) {
    note[label] = readFixedUint(input, offset, width, maximum, label);
    offset += width;
  }
  if (kind === SHIELDED_VALUE_WITH_BUDGET_MEMO_KIND) {
    const budgetCommitment = readFixedUint(input, offset, 32, MAX_FIELD, "budgetCommitment");
    protocolAssert(
      budgetCommitment !== 0n,
      "ZERO_SHIELDED_BUDGET_COMMITMENT",
      "Memo budget commitment must be nonzero",
    );
    const budgetNote = decodeShieldedNotePayload(input.subarray(offset + 32));
    protocolAssert(
      budgetNote.kind === "budget",
      "INVALID_SHIELDED_BUDGET_MEMO",
      "Value memo must contain a budget note",
    );
    const budgetFields = { ...budgetNote };
    delete budgetFields.kind;
    note.topUpMemo = { budgetCommitment, budgetNote: budgetFields };
  }
  if (kind === SHIELDED_VALUE_NOTE_KIND || kind === SHIELDED_VALUE_WITH_BUDGET_MEMO_KIND) {
    computeShieldedValueNoteCommitment({ ...note, ciphertextHashField: 0n });
  } else if (kind === SHIELDED_BUDGET_NOTE_KIND) {
    const policyCommitment = computeShieldedPolicyCommitment(note);
    const enrollmentCommitment = computeShieldedEnrollmentCommitment({
      policyCommitment,
      heirIdentityCommitment: note.heirIdentityCommitment,
      eligibleFrom: note.eligibleFrom,
      enrollmentSalt: note.enrollmentSalt,
    });
    computeShieldedBudgetNoteCommitment({
      policyCommitment,
      enrollmentCommitment,
      heirOwnerCommitment: note.heirOwnerCommitment,
      amountPerPeriod: note.amountPerPeriod,
      remaining: note.remaining,
      nonce: note.nonce,
      ciphertextHashField: 0n,
    });
  } else {
    const policyCommitment = computeShieldedPolicyCommitment({
      ...note,
      allocationKeyCommitment: computeShieldedAllocationKeyCommitment(note.allocationKey),
    });
    computeShieldedPolicyNoteCommitment({
      policyCommitment,
      nonce: note.nonce,
      ciphertextHashField: 0n,
    });
  }
  return note;
}

/** Recompute a note's commitment from its recovered plaintext and public ciphertext hash. */
export function computeShieldedNoteCommitmentFromPayload(input) {
  const note = decodeShieldedNotePayload(input.payload);
  const ciphertextHashField = bigintFrom(
    input.ciphertextHashField,
    "ciphertextHashField",
    MAX_FIELD,
  );
  if (note.kind === "value") {
    return {
      note,
      noteCommitment: computeShieldedValueNoteCommitment({
        ...note,
        ciphertextHashField,
      }),
    };
  }
  const policyCommitment = computeShieldedPolicyCommitment(
    note.kind === "policy"
      ? {
          ...note,
          allocationKeyCommitment: computeShieldedAllocationKeyCommitment(note.allocationKey),
        }
      : note,
  );
  if (note.kind === "policy") {
    return {
      note,
      policyCommitment,
      noteCommitment: computeShieldedPolicyNoteCommitment({
        policyCommitment,
        nonce: note.nonce,
        ciphertextHashField,
      }),
    };
  }
  const enrollmentCommitment = computeShieldedEnrollmentCommitment({
    policyCommitment,
    heirIdentityCommitment: note.heirIdentityCommitment,
    eligibleFrom: note.eligibleFrom,
    enrollmentSalt: note.enrollmentSalt,
  });
  return {
    note,
    policyCommitment,
    enrollmentCommitment,
    noteCommitment: computeShieldedBudgetNoteCommitment({
      policyCommitment,
      enrollmentCommitment,
      heirOwnerCommitment: note.heirOwnerCommitment,
      amountPerPeriod: note.amountPerPeriod,
      remaining: note.remaining,
      nonce: note.nonce,
      ciphertextHashField,
    }),
  };
}

/** Validate decrypted note bytes against the exact public ciphertext and event commitment. */
export function verifyShieldedNotePayload(input) {
  const result = computeShieldedNoteCommitmentFromPayload({
    payload: input.payload,
    ciphertextHashField: computeShieldedCiphertextHashField(input.ciphertext),
  });
  const expected = bigintFrom(input.noteCommitment, "noteCommitment", MAX_FIELD);
  if (result.noteCommitment !== expected) {
    throw new ProtocolError(
      "SHIELDED_NOTE_COMMITMENT_MISMATCH",
      "Recovered note does not match the on-chain commitment",
    );
  }
  return result;
}

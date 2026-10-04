import { asUint8Array, bigintFrom } from "./bytes.js";
import { MAX_UINT32, MAX_UINT64, MAX_UINT128, SNARK_SCALAR_FIELD } from "./constants.js";
import { ProtocolError, protocolAssert } from "./errors.js";
import { SHIELDED_HPKE_MAX_PAYLOAD_BYTES } from "./shielded-hpke.js";
import {
  computeShieldedBudgetNoteCommitment,
  computeShieldedAllocationKeyCommitment,
  computeShieldedCiphertextHashField,
  computeShieldedEnrollmentCommitment,
  computeShieldedIdentityBudgetNoteCommitment,
  computeShieldedPolicyCommitment,
  computeShieldedValueNoteCommitment,
  getShieldedBudgetCommitments,
  normalizeShieldedScope,
  SHIELDED_CIPHERTEXT_BYTES,
} from "./shielded-inheritance.js";

export const SHIELDED_NOTE_PAYLOAD_VERSION = 2;
export const SHIELDED_VALUE_NOTE_KIND = 1;
export const SHIELDED_BUDGET_NOTE_KIND = 2;
export const SHIELDED_VALUE_WITH_BUDGET_MEMO_KIND = 3;
export const SHIELDED_VALUE_WITH_RULE_MEMO_KIND = 4;
export const SHIELDED_IDENTITY_BUDGET_NOTE_KIND = 5;
export const SHIELDED_VALUE_NOTE_PAYLOAD_BYTES = 86;
export const SHIELDED_BUDGET_NOTE_PAYLOAD_BYTES = 282;
export const SHIELDED_IDENTITY_BUDGET_NOTE_PAYLOAD_BYTES = 218;
export const SHIELDED_VALUE_WITH_IDENTITY_BUDGET_MEMO_PAYLOAD_BYTES = 400;
export const SHIELDED_VALUE_WITH_IDENTITY_RULE_MEMO_PAYLOAD_BYTES = 432;
export const SHIELDED_VALUE_WITH_BUDGET_MEMO_PAYLOAD_BYTES =
  SHIELDED_VALUE_NOTE_PAYLOAD_BYTES + 32 + SHIELDED_BUDGET_NOTE_PAYLOAD_BYTES;

export const SHIELDED_VALUE_WITH_RULE_MEMO_PAYLOAD_BYTES =
  SHIELDED_VALUE_WITH_BUDGET_MEMO_PAYLOAD_BYTES + 32;

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
  ["rootVersionIndex", 8, MAX_UINT64],
  ["policySalt", 32, MAX_FIELD],
  ["allocationKeyCommitment", 32, MAX_FIELD],
  ["heirIdentityCommitment", 32, MAX_FIELD],
  ["eligibleFrom", 8, MAX_UINT64],
  ["enrollmentSalt", 32, MAX_FIELD],
  ["heirOwnerCommitment", 32, MAX_FIELD],
  ["amountPerPeriod", 16, MAX_UINT128],
  ["remaining", 16, MAX_UINT128],
  ["nonce", 32, MAX_FIELD],
  ["periodDays", 4, MAX_UINT32],
];
const identityBudgetSchema = [
  ["rootIdentityCommitment", 32, MAX_FIELD],
  ["rootVersionIndex", 8, MAX_UINT64],
  ["heirIdentityCommitment", 32, MAX_FIELD],
  ["amountPerPeriod", 16, MAX_UINT128],
  ["eligibleFrom", 8, MAX_UINT64],
  ["policyCommitment", 32, MAX_FIELD],
  ["enrollmentCommitment", 32, MAX_FIELD],
  ["remaining", 16, MAX_UINT128],
  ["nonce", 32, MAX_FIELD],
  ["periodDays", 4, MAX_UINT32],
];
// Parent backups retain enrollment as the integrity anchor; policy is recomputed
// from the private rule opening rather than duplicated in the compact memo.
const identityMemoBudgetSchema = identityBudgetSchema.filter(
  ([label]) => label !== "policyCommitment",
);
const IDENTITY_MEMO_BUDGET_BYTES = SHIELDED_IDENTITY_BUDGET_NOTE_PAYLOAD_BYTES - 32;
const ruleOpeningSchema = [
  ["policySalt", 32, MAX_FIELD],
  ["allocationKeyCommitment", 32, MAX_FIELD],
  ["enrollmentSalt", 32, MAX_FIELD],
];
const PRIVATE_BUDGET_FIELDS = [
  "policySalt",
  "enrollmentSalt",
  "allocationKeyCommitment",
  "allocationKey",
  "heirOwnerCommitment",
  "ownerCommitment",
  "ownerSecret",
  "ruleOpening",
  "fundingMemo",
];
const IDENTITY_BUDGET_FIELDS = new Set([
  "binding",
  "kind",
  ...identityBudgetSchema.map(([label]) => label),
]);

function validateIdentityBudget(note, scope) {
  protocolAssert(
    note.binding === "identity",
    "INVALID_SHIELDED_BUDGET_BINDING",
    "Public recovery requires an identity-bound budget",
  );
  protocolAssert(
    PRIVATE_BUDGET_FIELDS.every((label) => note[label] === undefined) &&
      Object.keys(note).every((label) => IDENTITY_BUDGET_FIELDS.has(label)),
    "PRIVATE_SHIELDED_BUDGET_FIELD",
    "An identity budget must not contain private authorization or rule-opening fields",
  );
  const commitments = getShieldedBudgetCommitments(note, scope);
  computeShieldedIdentityBudgetNoteCommitment(
    { ...note, ...commitments, ciphertextHashField: 0n },
    scope,
  );
  return commitments;
}

function validateRuleOpening(note, opening, scope) {
  protocolAssert(
    opening !== undefined && opening !== null,
    "MISSING_SHIELDED_RULE_OPENING",
    "An identity-budget donor backup requires the private rule opening",
  );
  const policyCommitment = computeShieldedPolicyCommitment(
    {
      ...note,
      policySalt: opening.policySalt,
      allocationKeyCommitment: opening.allocationKeyCommitment,
    },
    scope,
  );
  const enrollmentCommitment = computeShieldedEnrollmentCommitment(
    {
      policyCommitment,
      heirIdentityCommitment: note.heirIdentityCommitment,
      eligibleFrom: note.eligibleFrom,
      enrollmentSalt: opening.enrollmentSalt,
    },
    scope,
  );
  protocolAssert(
    policyCommitment === BigInt(note.policyCommitment) &&
      enrollmentCommitment === BigInt(note.enrollmentCommitment),
    "INVALID_SHIELDED_RULE_OPENING",
    "Donor rule opening does not match its identity budget",
  );
}
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
export function encodeShieldedValueNotePayload(note, scope) {
  normalizeShieldedScope(scope);
  // Validate nonzero owner/nonce exactly as the commitment helper does.
  computeShieldedValueNoteCommitment({ ...note, ciphertextHashField: 0n }, scope);
  if (note.fundingMemo === undefined) {
    return encode(SHIELDED_VALUE_NOTE_KIND, note, valueSchema, SHIELDED_VALUE_NOTE_PAYLOAD_BYTES);
  }
  const hasAllocationKey = note.fundingMemo.allocationKey !== undefined;
  const base = encode(
    hasAllocationKey ? SHIELDED_VALUE_WITH_RULE_MEMO_KIND : SHIELDED_VALUE_WITH_BUDGET_MEMO_KIND,
    note,
    valueSchema,
    SHIELDED_VALUE_NOTE_PAYLOAD_BYTES,
  );
  const memoBudget = note.fundingMemo.budgetNote;
  const identityBound = memoBudget.binding === "identity";
  if (identityBound) {
    validateIdentityBudget(memoBudget, scope);
    validateRuleOpening(memoBudget, note.fundingMemo.ruleOpening, scope);
  }
  const budget = identityBound
    ? encode(
        SHIELDED_IDENTITY_BUDGET_NOTE_KIND,
        memoBudget,
        identityMemoBudgetSchema,
        IDENTITY_MEMO_BUDGET_BYTES,
      )
    : encodeShieldedBudgetNotePayload(memoBudget, scope);
  const memoBytes = identityBound
    ? SHIELDED_VALUE_WITH_IDENTITY_BUDGET_MEMO_PAYLOAD_BYTES
    : SHIELDED_VALUE_WITH_BUDGET_MEMO_PAYLOAD_BYTES;
  const output = new Uint8Array(memoBytes + (hasAllocationKey ? 32 : 0));
  try {
    const budgetCommitment = bigintFrom(
      note.fundingMemo.budgetCommitment,
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
    if (identityBound) {
      let offset = SHIELDED_VALUE_NOTE_PAYLOAD_BYTES + 32 + budget.length;
      for (const [label, width, maximum] of ruleOpeningSchema) {
        writeFixedUint(output, offset, note.fundingMemo.ruleOpening[label], width, maximum, label);
        offset += width;
      }
    } else {
      protocolAssert(
        note.fundingMemo.ruleOpening === undefined,
        "INVALID_SHIELDED_RULE_OPENING",
        "An owner-bound budget already contains its rule opening",
      );
    }
    if (hasAllocationKey) {
      const allocationKeyCommitment = identityBound
        ? note.fundingMemo.ruleOpening.allocationKeyCommitment
        : note.fundingMemo.budgetNote.allocationKeyCommitment;
      protocolAssert(
        computeShieldedAllocationKeyCommitment(note.fundingMemo.allocationKey, scope) ===
          BigInt(allocationKeyCommitment),
        "INVALID_SHIELDED_ALLOCATION_KEY",
        "Memo funding key does not match its budget",
      );
      writeFixedUint(
        output,
        memoBytes,
        note.fundingMemo.allocationKey,
        32,
        MAX_FIELD,
        "allocationKey",
      );
    }
    return output;
  } catch (error) {
    output.fill(0);
    throw error;
  } finally {
    base.fill(0);
    budget.fill(0);
  }
}

/** Encode a funded or remaining budget note, including zero remainder. */
export function encodeShieldedBudgetNotePayload(note, scope) {
  normalizeShieldedScope(scope);
  if (note.binding === "identity") {
    validateIdentityBudget(note, scope);
    return encode(
      SHIELDED_IDENTITY_BUDGET_NOTE_KIND,
      note,
      identityBudgetSchema,
      SHIELDED_IDENTITY_BUDGET_NOTE_PAYLOAD_BYTES,
    );
  }
  const { policyCommitment, enrollmentCommitment } = getShieldedBudgetCommitments(note, scope);
  computeShieldedBudgetNoteCommitment(
    {
      policyCommitment,
      enrollmentCommitment,
      heirOwnerCommitment: note.heirOwnerCommitment,
      amountPerPeriod: note.amountPerPeriod,
      remaining: note.remaining,
      nonce: note.nonce,
      ciphertextHashField: 0n,
    },
    scope,
  );
  return encode(SHIELDED_BUDGET_NOTE_KIND, note, budgetSchema, SHIELDED_BUDGET_NOTE_PAYLOAD_BYTES);
}

/** The clear envelope is limited to the new schema; private rule openings never enter it. */
export function encodePublicShieldedBudgetEnvelope(note, scope) {
  normalizeShieldedScope(scope);
  validateIdentityBudget(note, scope);
  const payload = encodeShieldedBudgetNotePayload(note, scope);
  const envelope = new Uint8Array(SHIELDED_CIPHERTEXT_BYTES);
  envelope.set(payload);
  payload.fill(0);
  return envelope;
}

/** Recognize a clear envelope before attempting HPKE, including malformed versions/lengths. */
export function isPublicShieldedBudgetEnvelope(envelope) {
  const bytes = asUint8Array(envelope, "public budget envelope");
  return (
    bytes.length >= HEADER_BYTES &&
    MAGIC.every((byte, index) => bytes[index] === byte) &&
    bytes[5] === SHIELDED_IDENTITY_BUDGET_NOTE_KIND
  );
}

/** Return null for ordinary ciphertexts; recognized malformed public notes throw ProtocolError. */
export function decodePublicShieldedBudgetEnvelope(envelope, scope) {
  normalizeShieldedScope(scope);
  const bytes = asUint8Array(envelope, "public budget envelope");
  if (!isPublicShieldedBudgetEnvelope(bytes)) return null;
  protocolAssert(
    bytes.length === SHIELDED_CIPHERTEXT_BYTES,
    "INVALID_SHIELDED_CIPHERTEXT_LENGTH",
    `public budget envelope must be exactly ${SHIELDED_CIPHERTEXT_BYTES} bytes`,
  );
  protocolAssert(
    bytes.subarray(SHIELDED_IDENTITY_BUDGET_NOTE_PAYLOAD_BYTES).every((byte) => byte === 0),
    "INVALID_SHIELDED_PUBLIC_BUDGET_PADDING",
    "Public budget envelope padding must be zero",
  );
  return decodeShieldedNotePayload(
    bytes.subarray(0, SHIELDED_IDENTITY_BUDGET_NOTE_PAYLOAD_BYTES),
    scope,
  );
}

/** Ten public fund fields in their circuit/contract order, with canonical integer bounds. */
export function getShieldedPublicBudgetFields(note, scope) {
  normalizeShieldedScope(scope);
  validateIdentityBudget(note, scope);
  return identityBudgetSchema.map(([label, , maximum]) => bigintFrom(note[label], label, maximum));
}

/** Decode only exact, versioned, fixed-width payloads; no trailing bytes. */
export function decodeShieldedNotePayload(payload, scope) {
  normalizeShieldedScope(scope);
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
  const isValue = [
    SHIELDED_VALUE_NOTE_KIND,
    SHIELDED_VALUE_WITH_BUDGET_MEMO_KIND,
    SHIELDED_VALUE_WITH_RULE_MEMO_KIND,
  ].includes(kind);
  const schema = isValue
    ? valueSchema
    : kind === SHIELDED_BUDGET_NOTE_KIND
      ? budgetSchema
      : kind === SHIELDED_IDENTITY_BUDGET_NOTE_KIND
        ? identityBudgetSchema
        : null;
  protocolAssert(schema !== null, "UNSUPPORTED_SHIELDED_NOTE_KIND", "Unsupported note kind");
  const expectedLengths =
    kind === SHIELDED_VALUE_NOTE_KIND
      ? [SHIELDED_VALUE_NOTE_PAYLOAD_BYTES]
      : kind === SHIELDED_VALUE_WITH_BUDGET_MEMO_KIND
        ? [
            SHIELDED_VALUE_WITH_BUDGET_MEMO_PAYLOAD_BYTES,
            SHIELDED_VALUE_WITH_IDENTITY_BUDGET_MEMO_PAYLOAD_BYTES,
          ]
        : kind === SHIELDED_VALUE_WITH_RULE_MEMO_KIND
          ? [
              SHIELDED_VALUE_WITH_RULE_MEMO_PAYLOAD_BYTES,
              SHIELDED_VALUE_WITH_IDENTITY_RULE_MEMO_PAYLOAD_BYTES,
            ]
          : kind === SHIELDED_IDENTITY_BUDGET_NOTE_KIND
            ? [SHIELDED_IDENTITY_BUDGET_NOTE_PAYLOAD_BYTES]
            : [SHIELDED_BUDGET_NOTE_PAYLOAD_BYTES];
  protocolAssert(
    expectedLengths.includes(input.length),
    "INVALID_SHIELDED_NOTE_LENGTH",
    "Note payload has invalid length",
  );
  const note = { kind: isValue ? "value" : "budget" };
  if (kind === SHIELDED_IDENTITY_BUDGET_NOTE_KIND) note.binding = "identity";
  let offset = HEADER_BYTES;
  for (const [label, width, maximum] of schema) {
    note[label] = readFixedUint(input, offset, width, maximum, label);
    offset += width;
  }
  if (
    kind === SHIELDED_VALUE_WITH_BUDGET_MEMO_KIND ||
    kind === SHIELDED_VALUE_WITH_RULE_MEMO_KIND
  ) {
    // A value commitment binds ciphertext, not the correctness of optional memos.
    // Ignore malformed backups while retaining the spendable value note.
    try {
      const budgetCommitment = readFixedUint(input, offset, 32, MAX_FIELD, "budgetCommitment");
      protocolAssert(
        budgetCommitment !== 0n,
        "ZERO_SHIELDED_BUDGET_COMMITMENT",
        "Memo budget commitment must be nonzero",
      );
      const budgetStart = offset + 32;
      const identityMemo = input[budgetStart + 5] === SHIELDED_IDENTITY_BUDGET_NOTE_KIND;
      const budgetEnd =
        budgetStart +
        (identityMemo ? IDENTITY_MEMO_BUDGET_BYTES : SHIELDED_BUDGET_NOTE_PAYLOAD_BYTES);
      let budgetFields;
      if (identityMemo) {
        protocolAssert(
          MAGIC.every((byte, index) => input[budgetStart + index] === byte) &&
            input[budgetStart + 4] === SHIELDED_NOTE_PAYLOAD_VERSION,
          "INVALID_SHIELDED_BUDGET_MEMO",
          "Compact identity memo has an invalid header",
        );
        budgetFields = { binding: "identity" };
        let budgetOffset = budgetStart + HEADER_BYTES;
        for (const [label, width, maximum] of identityMemoBudgetSchema) {
          budgetFields[label] = readFixedUint(input, budgetOffset, width, maximum, label);
          budgetOffset += width;
        }
      } else {
        const budgetNote = decodeShieldedNotePayload(input.subarray(budgetStart, budgetEnd), scope);
        protocolAssert(
          budgetNote.kind === "budget" && budgetNote.binding !== "identity",
          "INVALID_SHIELDED_BUDGET_MEMO",
          "Value memo must contain a budget note",
        );
        budgetFields = { ...budgetNote };
        delete budgetFields.kind;
      }
      const fundingMemo = { budgetCommitment, budgetNote: budgetFields };
      let memoEnd = budgetEnd;
      if (identityMemo) {
        fundingMemo.ruleOpening = {};
        for (const [label, width, maximum] of ruleOpeningSchema) {
          fundingMemo.ruleOpening[label] = readFixedUint(input, memoEnd, width, maximum, label);
          memoEnd += width;
        }
        budgetFields.policyCommitment = computeShieldedPolicyCommitment(
          {
            ...budgetFields,
            ...fundingMemo.ruleOpening,
          },
          scope,
        );
        validateIdentityBudget(budgetFields, scope);
        validateRuleOpening(budgetFields, fundingMemo.ruleOpening, scope);
      }
      note.fundingMemo = fundingMemo;
      if (kind === SHIELDED_VALUE_WITH_RULE_MEMO_KIND) {
        // Recovery validates this separately: a bad rule backup must not discard a good budget backup.
        try {
          note.fundingMemo.allocationKey = readFixedUint(
            input,
            memoEnd,
            32,
            MAX_FIELD,
            "allocationKey",
          );
        } catch (error) {
          if (!(error instanceof ProtocolError)) throw error;
        }
      }
    } catch (error) {
      if (!(error instanceof ProtocolError)) throw error;
    }
  }
  if (isValue) {
    computeShieldedValueNoteCommitment({ ...note, ciphertextHashField: 0n }, scope);
  } else if (kind === SHIELDED_IDENTITY_BUDGET_NOTE_KIND) {
    validateIdentityBudget(note, scope);
  } else if (kind === SHIELDED_BUDGET_NOTE_KIND) {
    const commitments = getShieldedBudgetCommitments(note, scope);
    computeShieldedBudgetNoteCommitment(
      { ...note, ...commitments, ciphertextHashField: 0n },
      scope,
    );
  }
  return note;
}

/** Recompute a note's commitment from its recovered plaintext and public ciphertext hash. */
export function computeShieldedNoteCommitmentFromPayload(input, scope) {
  normalizeShieldedScope(scope);
  const note = decodeShieldedNotePayload(input.payload, scope);
  const ciphertextHashField = bigintFrom(
    input.ciphertextHashField,
    "ciphertextHashField",
    MAX_FIELD,
  );
  if (note.kind === "value") {
    return {
      note,
      noteCommitment: computeShieldedValueNoteCommitment(
        {
          ...note,
          ciphertextHashField,
        },
        scope,
      ),
    };
  }
  const commitments = getShieldedBudgetCommitments(note, scope);
  return {
    note,
    ...commitments,
    noteCommitment: (note.binding === "identity"
      ? computeShieldedIdentityBudgetNoteCommitment
      : computeShieldedBudgetNoteCommitment)(
      { ...note, ...commitments, ciphertextHashField },
      scope,
    ),
  };
}

/** Validate decrypted note bytes against the exact public ciphertext and event commitment. */
export function verifyShieldedNotePayload(input, scope) {
  normalizeShieldedScope(scope);
  const result = computeShieldedNoteCommitmentFromPayload(
    {
      payload: input.payload,
      ciphertextHashField: computeShieldedCiphertextHashField(input.ciphertext),
    },
    scope,
  );
  const expected = bigintFrom(input.noteCommitment, "noteCommitment", MAX_FIELD);
  if (result.noteCommitment !== expected) {
    throw new ProtocolError(
      "SHIELDED_NOTE_COMMITMENT_MISMATCH",
      "Recovered note does not match the on-chain commitment",
    );
  }
  return result;
}

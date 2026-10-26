import { asUint8Array, bigintFrom } from "./bytes.js";
import { MAX_UINT128, SNARK_SCALAR_FIELD } from "./constants.js";
import { ProtocolError, protocolAssert } from "./errors.js";
import {
  computeShieldedCiphertextHashField,
  computeShieldedValueNoteCommitment,
  normalizeShieldedScope,
} from "./shielded-inheritance.js";

export const SHIELDED_NOTE_PAYLOAD_VERSION = 1;
export const SHIELDED_VALUE_NOTE_KIND = 1;
export const SHIELDED_VALUE_NOTE_PAYLOAD_BYTES = 86;
const HEADER = Uint8Array.of(
  0x44,
  0x46,
  0x53,
  0x4e,
  SHIELDED_NOTE_PAYLOAD_VERSION,
  SHIELDED_VALUE_NOTE_KIND,
);
const FIELDS = [
  ["ownerCommitment", 32, SNARK_SCALAR_FIELD - 1n],
  ["amount", 16, MAX_UINT128],
  ["nonce", 32, SNARK_SCALAR_FIELD - 1n],
];

/** The value-note encoding carries only its private spending opening. */
export function encodeShieldedValueNotePayload(note, scope) {
  normalizeShieldedScope(scope);
  protocolAssert(
    Object.keys(note).every((name) =>
      ["kind", "ownerCommitment", "amount", "nonce"].includes(name),
    ),
    "INVALID_SHIELDED_NOTE_SCHEMA",
    "Unsupported value-note field",
  );
  computeShieldedValueNoteCommitment({ ...note, ciphertextHashField: 0n }, scope);
  const bytes = new Uint8Array(SHIELDED_VALUE_NOTE_PAYLOAD_BYTES);
  bytes.set(HEADER);
  let offset = HEADER.length;
  for (const [name, width, max] of FIELDS) {
    let value = bigintFrom(note[name], name, max);
    for (let index = offset + width - 1; index >= offset; --index) {
      bytes[index] = Number(value & 255n);
      value >>= 8n;
    }
    offset += width;
  }
  return bytes;
}

export function decodeShieldedNotePayload(payload, scope) {
  normalizeShieldedScope(scope);
  const bytes = asUint8Array(payload, "payload");
  protocolAssert(
    bytes.length === SHIELDED_VALUE_NOTE_PAYLOAD_BYTES &&
      HEADER.every((value, i) => value === bytes[i]),
    "INVALID_SHIELDED_NOTE_SCHEMA",
    "Unsupported or truncated value-note payload",
  );
  const note = { kind: "value" };
  let offset = HEADER.length;
  for (const [name, width, max] of FIELDS) {
    let value = 0n;
    for (const byte of bytes.subarray(offset, offset + width)) value = (value << 8n) | BigInt(byte);
    note[name] = bigintFrom(value, name, max);
    offset += width;
  }
  computeShieldedValueNoteCommitment({ ...note, ciphertextHashField: 0n }, scope);
  return note;
}

/** Authenticate recovered plaintext against its public commitment and exact ciphertext. */
export function computeShieldedNoteCommitmentFromPayload(input, scope) {
  const note = decodeShieldedNotePayload(input.payload, scope);
  return {
    note,
    noteCommitment: computeShieldedValueNoteCommitment(
      { ...note, ciphertextHashField: input.ciphertextHashField },
      scope,
    ),
  };
}

export function verifyShieldedNotePayload(input, scope) {
  const result = computeShieldedNoteCommitmentFromPayload(
    {
      payload: input.payload,
      ciphertextHashField: computeShieldedCiphertextHashField(input.ciphertext),
    },
    scope,
  );
  if (
    result.noteCommitment !==
    bigintFrom(input.noteCommitment, "noteCommitment", SNARK_SCALAR_FIELD - 1n)
  ) {
    throw new ProtocolError(
      "SHIELDED_NOTE_COMMITMENT_MISMATCH",
      "Recovered note does not match the on-chain commitment",
    );
  }
  return result;
}

import { bech32m } from "@scure/base";
import { toBeHex, zeroPadValue, getBytes, sha256, concat, toUtf8Bytes } from "ethers";
import { bytesToHex } from "./bytes.js";
import { SNARK_SCALAR_FIELD } from "./constants.js";
import { protocolAssert } from "./errors.js";
import {
  receiveProofFromWords as snarkjsProof,
  receiveProofWords as proofWords,
} from "./shielded-receive-proof-codec.js";
import { buildShieldedReceiveCodePublicSignals } from "./shielded-signals.js";

export const SHIELDED_RECEIVE_CODE_PREFIX = "dfrecv";
export const SHIELDED_RECEIVE_CODE_VERSION = 1;

const WORD_BYTES = 32;
const PROOF_WORDS = 8;
const HEADER_BYTES = 5;
const PAYLOAD_BYTES = HEADER_BYTES + 3 * WORD_BYTES + PROOF_WORDS * WORD_BYTES;

const word = (value) => getBytes(zeroPadValue(toBeHex(value), WORD_BYTES));

function invalid(condition, message) {
  protocolAssert(condition, "INVALID_SHIELDED_RECEIVE_CODE", message);
}

/** Encode the recipient's payment keys and the snarkjs proof that binds them. */
export function encodeShieldedReceiveCode(input) {
  const [
    identityCommitment,
    ownerCommitment,
    ,
    ,
    keyMode,
    identitySuiteId,
    independentKeySuiteId,
    independentKeyDerivationVersion,
  ] = buildShieldedReceiveCodePublicSignals(input);
  const payload = new Uint8Array(PAYLOAD_BYTES);
  payload.set([
    SHIELDED_RECEIVE_CODE_VERSION,
    Number(keyMode),
    Number(identitySuiteId),
    Number(independentKeySuiteId),
    Number(independentKeyDerivationVersion),
  ]);
  payload.set(word(identityCommitment), HEADER_BYTES);
  payload.set(word(ownerCommitment), HEADER_BYTES + WORD_BYTES);
  payload.set(getBytes(input.viewingKey), HEADER_BYTES + 2 * WORD_BYTES);
  proofWords(input.proof).forEach((value, index) =>
    payload.set(word(value), HEADER_BYTES + (3 + index) * WORD_BYTES),
  );
  return bech32m.encode(SHIELDED_RECEIVE_CODE_PREFIX, bech32m.toWords(payload), false);
}

/**
 * Parse and range-check a receive code. This does not verify the proof: callers
 * must still check the curve points and run Groth16 verification on the result.
 */
export function decodeShieldedReceiveCode(code) {
  protocolAssert(
    typeof code === "string",
    "INVALID_SHIELDED_RECEIVE_CODE_ENCODING",
    "Receive code must be a string",
  );
  let payload;
  try {
    // Codes never contain whitespace; chat apps may wrap long ones.
    const decoded = bech32m.decode(code.replace(/\s+/gu, ""), false);
    if (decoded.prefix !== SHIELDED_RECEIVE_CODE_PREFIX) throw new Error("prefix");
    payload = bech32m.fromWords(decoded.words);
  } catch {
    payload = undefined;
  }
  protocolAssert(
    payload?.length === PAYLOAD_BYTES && payload[0] === SHIELDED_RECEIVE_CODE_VERSION,
    "INVALID_SHIELDED_RECEIVE_CODE_ENCODING",
    "Receive code is incomplete or mistyped",
  );
  const read = (offset) => BigInt(bytesToHex(payload.subarray(offset, offset + WORD_BYTES)));
  const identityCommitment = read(HEADER_BYTES);
  const metadata = {
    keyMode: payload[1],
    identitySuiteId: payload[2],
    independentKeySuiteId: payload[3],
    independentKeyDerivationVersion: payload[4],
    receiveCodeVersion: payload[0],
  };
  const ownerCommitment = read(HEADER_BYTES + WORD_BYTES);
  for (const value of [identityCommitment, ownerCommitment]) {
    invalid(value > 0n && value < SNARK_SCALAR_FIELD, "Receive code commitment is out of range");
  }
  const viewingKey = payload.slice(HEADER_BYTES + 2 * WORD_BYTES, HEADER_BYTES + 3 * WORD_BYTES);
  const words = Array.from({ length: PROOF_WORDS }, (_, index) =>
    read(HEADER_BYTES + (3 + index) * WORD_BYTES),
  );
  const proof = snarkjsProof(words);
  proofWords(proof);
  return {
    identityCommitment,
    ownerCommitment,
    viewingKey,
    ...metadata,
    fingerprint: computeShieldedReceiveCodeFingerprint({
      identityCommitment,
      ownerCommitment,
      viewingKey,
      ...metadata,
    }),
    publicSignals: buildShieldedReceiveCodePublicSignals({
      identityCommitment,
      ownerCommitment,
      viewingKey,
      ...metadata,
    }),
    proof,
  };
}

/** Fingerprint only the canonical, proved payment statement, never randomized proof bytes. */
export function computeShieldedReceiveCodeFingerprint(input) {
  const signals = buildShieldedReceiveCodePublicSignals(input);
  const publicFields = concat(signals.map(word));
  return sha256(concat([toUtf8Bytes("DeepFamily:ReceiveCodeFingerprint:v2"), publicFields]));
}

import { bech32m } from "@scure/base";
import { toBeHex, zeroPadValue, getBytes, sha256, concat, toUtf8Bytes } from "ethers";
import { bytesToHex } from "./bytes.js";
import { SNARK_SCALAR_FIELD } from "./constants.js";
import { protocolAssert } from "./errors.js";
import { buildShieldedReceiveCodePublicSignals } from "./shielded-signals.js";

export const SHIELDED_RECEIVE_CODE_PREFIX = "dfrecv";
export const SHIELDED_RECEIVE_CODE_VERSION = 2;

/** Proof coordinates are canonical elements of the BN254 base field. */
const BN254_BASE_FIELD =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const WORD_BYTES = 32;
const PROOF_WORDS = 8;
const HEADER_BYTES = 5;
const PAYLOAD_BYTES = HEADER_BYTES + 3 * WORD_BYTES + PROOF_WORDS * WORD_BYTES;

const word = (value) => getBytes(zeroPadValue(toBeHex(value), WORD_BYTES));

function invalid(condition, message) {
  protocolAssert(condition, "INVALID_SHIELDED_RECEIVE_CODE", message);
}

function coordinate(value, label) {
  const result = BigInt(value);
  invalid(result >= 0n && result < BN254_BASE_FIELD, `${label} is not a canonical coordinate`);
  return result;
}

/**
 * Proof words, in snarkjs coordinate order: pi_a.x, pi_a.y, pi_b.x.c0,
 * pi_b.x.c1, pi_b.y.c0, pi_b.y.c1, pi_c.x, pi_c.y. The point at infinity
 * is never a valid proof element and is rejected before curve checks.
 */
function proofWords(proof) {
  invalid(
    proof?.pi_a?.length >= 2 && proof?.pi_b?.length >= 2 && proof?.pi_c?.length >= 2,
    "Receive code proof has the wrong shape",
  );
  const a = [proof.pi_a[0], proof.pi_a[1]].map((value) => coordinate(value, "pi_a"));
  const b = [proof.pi_b[0][0], proof.pi_b[0][1], proof.pi_b[1][0], proof.pi_b[1][1]].map((value) =>
    coordinate(value, "pi_b"),
  );
  const c = [proof.pi_c[0], proof.pi_c[1]].map((value) => coordinate(value, "pi_c"));
  if (proof.pi_a.length > 2) invalid(BigInt(proof.pi_a[2]) === 1n, "pi_a must be affine");
  if (proof.pi_c.length > 2) invalid(BigInt(proof.pi_c[2]) === 1n, "pi_c must be affine");
  if (proof.pi_b.length > 2) {
    invalid(
      BigInt(proof.pi_b[2][0]) === 1n && BigInt(proof.pi_b[2][1]) === 0n,
      "pi_b must be affine",
    );
  }
  invalid(a.some(Boolean) && c.some(Boolean) && b.some(Boolean), "Proof point is at infinity");
  return [...a, ...b, ...c];
}

function snarkjsProof(words) {
  const text = words.map(String);
  return {
    pi_a: [text[0], text[1], "1"],
    pi_b: [
      [text[2], text[3]],
      [text[4], text[5]],
      ["1", "0"],
    ],
    pi_c: [text[6], text[7], "1"],
    protocol: "groth16",
    curve: "bn128",
  };
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
    assetSuiteId,
    assetDerivationVersion,
  ] = buildShieldedReceiveCodePublicSignals(input);
  const payload = new Uint8Array(PAYLOAD_BYTES);
  payload.set([
    SHIELDED_RECEIVE_CODE_VERSION,
    Number(keyMode),
    Number(identitySuiteId),
    Number(assetSuiteId),
    Number(assetDerivationVersion),
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
    assetSuiteId: payload[3],
    assetDerivationVersion: payload[4],
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

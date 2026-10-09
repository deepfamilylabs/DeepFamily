import test from "node:test";
import assert from "node:assert/strict";
import { bech32m } from "@scure/base";
import {
  SHIELDED_RECEIVE_CODE_PREFIX,
  decodeShieldedReceiveCode,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedReceiveCode,
  splitShieldedViewPublicKey,
} from "../index.js";

const BASE_FIELD = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Coordinates only need to be canonical here; curve checks and Groth16
// verification happen in the browser verifier.
const proof = {
  pi_a: ["1", "2", "1"],
  pi_b: [
    ["3", "4"],
    ["5", "6"],
    ["1", "0"],
  ],
  pi_c: ["7", "8", "1"],
  protocol: "groth16",
  curve: "bn128",
};

async function sample() {
  const keys = deriveShieldedHeirKeyMaterial(13n);
  return {
    identityCommitment: 19n,
    ownerCommitment: keys.ownerCommitment,
    viewingKey: await deriveShieldedViewPublicKey(keys.hpkeIkm),
    proof,
  };
}

function payloadOf(code) {
  return bech32m.fromWords(bech32m.decode(code, false).words);
}

function codeOf(payload) {
  return bech32m.encode(SHIELDED_RECEIVE_CODE_PREFIX, bech32m.toWords(payload), false);
}

test("a receive code round-trips its keys, public signals and proof", async () => {
  const input = await sample();
  const code = encodeShieldedReceiveCode(input);
  assert.match(code, /^dfrecv1[02-9ac-hj-np-z]+$/u);
  assert.equal(payloadOf(code).length, 357);
  const decoded = decodeShieldedReceiveCode(code);
  const { viewKeyLo, viewKeyHi } = splitShieldedViewPublicKey(input.viewingKey);
  assert.equal(decoded.identityCommitment, 19n);
  assert.equal(decoded.ownerCommitment, input.ownerCommitment);
  assert.deepEqual(decoded.viewingKey, input.viewingKey);
  assert.deepEqual(decoded.publicSignals, [19n, input.ownerCommitment, viewKeyLo, viewKeyHi, 0n, 1n, 1n, 1n, 2n]);
  assert.deepEqual(decoded.proof, proof);
});

test("uppercase and wrapped codes decode like the original", async () => {
  const code = encodeShieldedReceiveCode(await sample());
  const wrapped = `  ${code.slice(0, 100)}\n${code.slice(100, 300)}\r\n${code.slice(300)} `;
  assert.deepEqual(decodeShieldedReceiveCode(code.toUpperCase()), decodeShieldedReceiveCode(code));
  assert.deepEqual(decodeShieldedReceiveCode(wrapped), decodeShieldedReceiveCode(code));
});

test("typos, truncation, other prefixes and versions are encoding errors", async () => {
  const code = encodeShieldedReceiveCode(await sample());
  const encodingError = (error) => error.code === "INVALID_SHIELDED_RECEIVE_CODE_ENCODING";
  const typo = `${code.slice(0, 40)}${code[40] === "q" ? "p" : "q"}${code.slice(41)}`;
  assert.throws(() => decodeShieldedReceiveCode(typo), encodingError);
  assert.throws(() => decodeShieldedReceiveCode(code.slice(0, -1)), encodingError);
  assert.throws(
    () => decodeShieldedReceiveCode(`${code.slice(0, 50)}${code.slice(51)}`),
    encodingError,
  );
  const payload = payloadOf(code);
  assert.throws(
    () => decodeShieldedReceiveCode(bech32m.encode("dfpay", bech32m.toWords(payload), false)),
    encodingError,
  );
  const version = payload.slice();
  version[0] = 1;
  assert.throws(() => decodeShieldedReceiveCode(codeOf(version)), encodingError);
  assert.throws(() => decodeShieldedReceiveCode(codeOf(payload.subarray(0, 352))), encodingError);
  assert.throws(() => decodeShieldedReceiveCode(42), encodingError);
});

test("well-formed codes with out-of-range content are rejected", async () => {
  const payload = payloadOf(encodeShieldedReceiveCode(await sample()));
  const invalid = (error) => error.code === "INVALID_SHIELDED_RECEIVE_CODE";
  const withWord = (index, value) => {
    const copy = payload.slice();
    copy.set(Buffer.from(value.toString(16).padStart(64, "0"), "hex"), 5 + index * 32);
    return codeOf(copy);
  };
  assert.throws(() => decodeShieldedReceiveCode(withWord(0, 0n)), invalid);
  assert.throws(() => decodeShieldedReceiveCode(withWord(1, SCALAR_FIELD)), invalid);
  assert.throws(
    () => decodeShieldedReceiveCode(withWord(2, 0n)),
    (error) => error.code === "ZERO_SHIELDED_VIEW_KEY",
  );
  // Proof words start after the three key words.
  assert.throws(() => decodeShieldedReceiveCode(withWord(3, BASE_FIELD)), invalid);
  const infinity = payload.slice();
  infinity.fill(0, 5 + 3 * 32, 5 + 5 * 32);
  assert.throws(() => decodeShieldedReceiveCode(codeOf(infinity)), invalid);
});

test("encoding rejects projective or non-canonical proofs", async () => {
  const input = await sample();
  assert.throws(
    () => encodeShieldedReceiveCode({ ...input, proof: { ...proof, pi_a: ["1", "2", "3"] } }),
    (error) => error.code === "INVALID_SHIELDED_RECEIVE_CODE",
  );
  assert.throws(
    () =>
      encodeShieldedReceiveCode({
        ...input,
        proof: { ...proof, pi_c: [String(BASE_FIELD), "8", "1"] },
      }),
    (error) => error.code === "INVALID_SHIELDED_RECEIVE_CODE",
  );
});

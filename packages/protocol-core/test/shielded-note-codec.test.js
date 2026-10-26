import test from "node:test";
import assert from "node:assert/strict";
import { SNARK_SCALAR_FIELD } from "../constants.js";
import {
  encodeShieldedValueNotePayload,
  decodeShieldedNotePayload,
  computeShieldedNoteCommitmentFromPayload,
  computeShieldedCiphertextHashField,
  verifyShieldedNotePayload,
} from "../index.js";
const scope = { chainId: 31337n, poolAddress: "0x0000000000000000000000000000000000001234" };
const note = { ownerCommitment: 1n, amount: 2n, nonce: 3n };

test("value payload has one strict, bounded and deterministic encoding", () => {
  const bytes = encodeShieldedValueNotePayload(note, scope);
  assert.equal(bytes.length, 86);
  assert.equal(
    Buffer.from(bytes).toString("hex"),
    "4446534e0101" + "1".padStart(64, "0") + "2".padStart(32, "0") + "3".padStart(64, "0"),
  );
  assert.deepEqual(decodeShieldedNotePayload(bytes, scope), { kind: "value", ...note });
  assert.equal(
    decodeShieldedNotePayload(encodeShieldedValueNotePayload({ ...note, amount: 0n }, scope), scope)
      .amount,
    0n,
  );
  for (const invalid of [
    { ...note, ownerCommitment: 0n },
    { ...note, nonce: 0n },
    { ...note, nonce: SNARK_SCALAR_FIELD },
    { ...note, amount: 1n << 128n },
    { ...note, fundingMemo: {} },
  ])
    assert.throws(() => encodeShieldedValueNotePayload(invalid, scope));
  for (const changed of [
    bytes.subarray(0, 85),
    new Uint8Array([...bytes, 0]),
    Uint8Array.from(bytes, (v, i) => (i === 4 ? 2 : v)),
    Uint8Array.from(bytes, (v, i) => (i === 5 ? 2 : v)),
  ])
    assert.throws(() => decodeShieldedNotePayload(changed, scope));
});

test("recovered plaintext must authenticate the complete emitted ciphertext and commitment", () => {
  const payload = encodeShieldedValueNotePayload(note, scope),
    ciphertext = new Uint8Array(512).fill(7);
  const { noteCommitment } = computeShieldedNoteCommitmentFromPayload(
    { payload, ciphertextHashField: computeShieldedCiphertextHashField(ciphertext) },
    scope,
  );
  assert.deepEqual(verifyShieldedNotePayload({ payload, ciphertext, noteCommitment }, scope).note, {
    kind: "value",
    ...note,
  });
  const bad = ciphertext.slice();
  bad[511] ^= 1;
  assert.throws(() =>
    verifyShieldedNotePayload({ payload, ciphertext: bad, noteCommitment }, scope),
  );
  assert.throws(() =>
    verifyShieldedNotePayload({ payload, ciphertext, noteCommitment: noteCommitment + 1n }, scope),
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  SHIELDED_CIPHERTEXT_BYTES,
  SHIELDED_HPKE_MAX_PAYLOAD_BYTES,
  buildShieldedHpkeAad,
  computeShieldedCiphertextHashField,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  encryptShieldedNote,
  joinShieldedViewPublicKey,
  splitShieldedViewPublicKey,
} from "../index.js";

const POOL = "0x0000000000000000000000000000000000000001";
const OTHER_POOL = "0x0000000000000000000000000000000000000002";
const context = { chainId: 1030n, poolAddress: POOL };

test("existing identity secret deterministically derives an X25519 public key", async () => {
  const { hpkeIkm } = deriveShieldedHeirKeyMaterial(13n);
  const key = await deriveShieldedViewPublicKey(hpkeIkm);
  assert.equal(
    Buffer.from(key).toString("hex"),
    "c89fca5e0978b147dbbabe45e4f1f5427018d7b63029d704b3c7cc4db2df226e",
  );
  const limbs = splitShieldedViewPublicKey(key);
  assert.deepEqual(limbs, {
    viewKeyHi: 266675278854608699523136467037752259906n,
    viewKeyLo: 149002525805011638159125817198076961390n,
  });
  assert.deepEqual(joinShieldedViewPublicKey(limbs), key);
  assert.notDeepEqual(
    key,
    await deriveShieldedViewPublicKey(deriveShieldedHeirKeyMaterial(14n).hpkeIkm),
  );
});

test("HPKE note round-trips with fixed length and randomized ciphertext", async () => {
  const { hpkeIkm } = deriveShieldedHeirKeyMaterial(13n);
  const recipientPublicKey = await deriveShieldedViewPublicKey(hpkeIkm);
  for (const payload of [
    new Uint8Array(),
    new Uint8Array([1, 2, 3]),
    new Uint8Array(SHIELDED_HPKE_MAX_PAYLOAD_BYTES).fill(7),
  ]) {
    const ciphertext = await encryptShieldedNote({ recipientPublicKey, payload, ...context });
    assert.equal(ciphertext.length, SHIELDED_CIPHERTEXT_BYTES);
    assert.deepEqual(await decryptShieldedNote({ hpkeIkm, ciphertext, ...context }), payload);
  }
  const input = { recipientPublicKey, payload: new Uint8Array([1, 2, 3]), ...context };
  const first = await encryptShieldedNote(input);
  const second = await encryptShieldedNote(input);
  assert.notDeepEqual(first, second);
  assert.notEqual(
    computeShieldedCiphertextHashField(first),
    computeShieldedCiphertextHashField(second),
  );
});

test("wrong identity, AAD, ciphertext mutation and truncation fail closed", async () => {
  const { hpkeIkm } = deriveShieldedHeirKeyMaterial(13n);
  const recipientPublicKey = await deriveShieldedViewPublicKey(hpkeIkm);
  const ciphertext = await encryptShieldedNote({
    recipientPublicKey,
    payload: new Uint8Array([1, 2, 3]),
    ...context,
  });
  const wrongKey = deriveShieldedHeirKeyMaterial(14n).hpkeIkm;
  const tampered = ciphertext.slice();
  tampered[tampered.length - 1] ^= 1;
  for (const invalid of [
    { hpkeIkm: wrongKey, ciphertext, ...context },
    { hpkeIkm, ciphertext, chainId: 1031n, poolAddress: POOL },
    { hpkeIkm, ciphertext, chainId: 1030n, poolAddress: OTHER_POOL },
    { hpkeIkm, ciphertext: tampered, ...context },
  ]) {
    await assert.rejects(
      decryptShieldedNote(invalid),
      (error) => error.code === "SHIELDED_DECRYPTION_FAILED",
    );
  }
  await assert.rejects(
    decryptShieldedNote({ hpkeIkm, ciphertext: ciphertext.subarray(1), ...context }),
    (error) => error.code === "INVALID_SHIELDED_CIPHERTEXT_LENGTH",
  );
  await assert.rejects(
    encryptShieldedNote({
      recipientPublicKey,
      payload: new Uint8Array(SHIELDED_HPKE_MAX_PAYLOAD_BYTES + 1),
      ...context,
    }),
    (error) => error.code === "SHIELDED_PAYLOAD_TOO_LARGE",
  );
});

test("AAD is deployment-specific and validates chain/pool identity", () => {
  assert.notDeepEqual(
    buildShieldedHpkeAad(context),
    buildShieldedHpkeAad({ ...context, chainId: 1031n }),
  );
  assert.notDeepEqual(
    buildShieldedHpkeAad(context),
    buildShieldedHpkeAad({ ...context, poolAddress: OTHER_POOL }),
  );
  assert.throws(
    () => buildShieldedHpkeAad({ chainId: 0n, poolAddress: POOL }),
    (error) => error.code === "INVALID_CHAIN_ID",
  );
  assert.throws(
    () =>
      buildShieldedHpkeAad({
        chainId: 1030n,
        poolAddress: "0x0000000000000000000000000000000000000000",
      }),
    (error) => error.code === "INVALID_POOL_ADDRESS",
  );
});

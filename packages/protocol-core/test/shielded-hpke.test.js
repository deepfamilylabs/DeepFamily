import test from "node:test";
import assert from "node:assert/strict";
import { getBytes, keccak256, solidityPacked, toUtf8Bytes } from "ethers";
import {
  SHIELDED_CIPHERTEXT_BYTES,
  SHIELDED_HPKE_MAX_PAYLOAD_BYTES,
  buildShieldedHpkeAad,
  computeShieldedCiphertextHashField,
  decryptShieldedNote,
  deriveShieldedViewPublicKey,
  encryptShieldedNote,
  splitShieldedViewPublicKey,
} from "../index.js";

const testKey = value => ({hpkeIkm: new Uint8Array(32).fill(Number(value))});
const POOL = "0x0000000000000000000000000000000000000001";
const OTHER_POOL = "0x0000000000000000000000000000000000000002";
const context = { chainId: 1030n, poolAddress: POOL };

test("fixed recipient IKM deterministically derives the expected X25519 key", async () => {
  const { hpkeIkm } = testKey(13n);
  const key = await deriveShieldedViewPublicKey(hpkeIkm);
  assert.equal(
    Buffer.from(key).toString("hex"),
    "5804dea1d05a3f22886014cf45bb77d34bf5d17613b0b44222f9b087e45d644c",
  );
  const limbs = splitShieldedViewPublicKey(key);
  assert.deepEqual(limbs, {
    viewKeyHi: 116997348331654895106151299621983057875n,
    viewKeyLo: 100968460792833900495915938141066585164n,
  });
  assert.notDeepEqual(
    key,
    await deriveShieldedViewPublicKey(testKey(14n).hpkeIkm),
  );
});

test("HPKE note round-trips with fixed length and randomized ciphertext", async () => {
  const { hpkeIkm } = testKey(13n);
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
  const { hpkeIkm } = testKey(13n);
  const recipientPublicKey = await deriveShieldedViewPublicKey(hpkeIkm);
  const ciphertext = await encryptShieldedNote({
    recipientPublicKey,
    payload: new Uint8Array([1, 2, 3]),
    ...context,
  });
  const wrongKey = testKey(14n).hpkeIkm;
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
  assert.deepEqual(buildShieldedHpkeAad(context), getBytes(solidityPacked(
    ["bytes32", "uint64", "address"],
    [keccak256(toUtf8Bytes("DeepFamily:ShieldedNoteHPKE:v1")), context.chainId, context.poolAddress],
  )));
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

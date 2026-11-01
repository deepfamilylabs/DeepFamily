import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { assertReceiveWasmExports, getReceiveWasmBackend } from "../shielded-receive-wasm.js";
import {
  decryptShieldedReceivePayload,
  deriveShieldedReceivePublicKey,
  encryptShieldedReceivePayload,
} from "../shielded-receive-encryption.js";
import {
  decryptShieldedNote,
  deriveShieldedViewPublicKey,
  encryptShieldedNote,
} from "../shielded-hpke.js";
import {
  createShieldedLetterEnvelope,
  decryptShieldedLetter,
  encryptShieldedLetter,
} from "../shielded-letters.js";

const encryptionModule = new URL("../shielded-receive-encryption.js", import.meta.url).href;
const unavailable = { code: "SHIELDED_RECEIVE_WASM_UNAVAILABLE" };
const backendExports = [
  "_sodium_init",
  "_malloc",
  "_free",
  "_crypto_core_ristretto255_scalar_reduce",
  "_crypto_core_ristretto255_from_hash",
  "_crypto_scalarmult_ristretto255",
];

function freshProcess(source) {
  return execFileSync(process.execPath, ["--input-type=module", "--eval", source], {
    encoding: "utf8",
    timeout: 20_000,
  });
}

test("receive operations use the pinned WASM-only backend", async () => {
  const first = await getReceiveWasmBackend();
  assert.equal(first, await getReceiveWasmBackend());
  assert.equal(first.implementation, "libsodium-sumo@0.8.4");
  assert.equal(first.execution, "webassembly");
  assert(Object.isFrozen(first));
  const scalar = first.reduceScalar(new Uint8Array(64).fill(7));
  const point = first.hashToGroup(new Uint8Array(64).fill(19));
  assert.equal(first.multiply(scalar, point).length, 32);
  assert.throws(() => first.multiply(new Uint8Array(32), point), {
    code: "SHIELDED_RECEIVE_WASM_OPERATION_FAILED",
  });
});

test("backend verification rejects JavaScript functions even with all expected names", () => {
  const fake = Object.fromEntries(backendExports.map((name) => [name, () => 0]));
  fake.HEAPU8 = new Uint8Array(1024);
  assert.throws(() => assertReceiveWasmExports(fake), unavailable);
  assert.throws(() => assertReceiveWasmExports(null), unavailable);
});

test("malformed secret hex never survives in parameter-validation diagnostics", async () => {
  const seed = new Uint8Array(32).fill(17);
  const badSeed = "0x" + "a1".repeat(32) + "zz";
  const address = await deriveShieldedReceivePublicKey(seed);
  const scope = { chainId: 1030n, poolAddress: "0x1111111111111111111111111111111111111111" };
  const ciphertext = await encryptShieldedNote({
    ...scope,
    recipientPublicKey: address,
    payload: Uint8Array.of(1),
  });
  const letterScope = { chainId: scope.chainId, lettersAddress: scope.poolAddress, messageId: 1n };
  const letter = await encryptShieldedLetter({
    ...letterScope,
    recipientPublicKey: address,
    envelope: createShieldedLetterEnvelope({ body: "synthetic", salt: 1n, authorizationAlias: 9n }),
  });
  for (const pending of [
    () => deriveShieldedReceivePublicKey(badSeed),
    () => deriveShieldedViewPublicKey(badSeed),
    () => decryptShieldedNote({ ...scope, hpkeIkm: badSeed, ciphertext }),
    () => decryptShieldedLetter({ ...letterScope, hpkeIkm: badSeed, ciphertext: letter }),
  ]) {
    await assert.rejects(pending, (error) => {
      assert.equal(error.cause, undefined);
      assert(!JSON.stringify(error).includes(badSeed));
      assert(!error.message.includes(badSeed));
      return true;
    });
  }
});

test("a fresh realm without WebAssembly rejects rather than deriving with JavaScript", () => {
  const output = freshProcess(`
    import assert from 'node:assert/strict';
    globalThis.WebAssembly = undefined;
    const {deriveShieldedReceivePublicKey, initializeShieldedReceiveEncryption, decryptShieldedReceivePayload} = await import(${JSON.stringify(encryptionModule)});
    const seed = new Uint8Array(32).fill(17), d = new Uint8Array(32).fill(19);
    await assert.rejects(deriveShieldedReceivePublicKey(seed, d), ${JSON.stringify(unavailable)});
    await assert.rejects(initializeShieldedReceiveEncryption(), ${JSON.stringify(unavailable)});
    const ciphertext = new Uint8Array(112);
    ciphertext.set(Buffer.from('e2f2ae0a6abc4e71a884a961c500515f58e30b6aa582dd8db6a65945e08d2d76','hex'));
    await assert.rejects(decryptShieldedReceivePayload({viewIkm:seed,ciphertext,aad:new Uint8Array(),info:new Uint8Array()}), ${JSON.stringify(unavailable)});
    assert.equal(seed[0], 17);
    assert.equal(d[0], 19);
    console.log('rejected');
  `);
  assert.equal(output.trim(), "rejected");
});

test("failed WASM initialization never falls back or exposes nested diagnostics", () => {
  const output = freshProcess(`
    import assert from 'node:assert/strict';
    WebAssembly.instantiate = async () => { throw Error('private initialization diagnostic'); };
    const {deriveShieldedReceivePublicKey} = await import(${JSON.stringify(encryptionModule)});
    await assert.rejects(deriveShieldedReceivePublicKey(new Uint8Array(32), new Uint8Array(32)), error => {
      assert.equal(error.code, 'SHIELDED_RECEIVE_WASM_UNAVAILABLE');
      assert.equal(error.cause, undefined);
      assert(!error.message.includes('private initialization diagnostic'));
      return true;
    });
    console.log('rejected');
  `);
  assert.equal(output.trim(), "rejected");
});

test("all receive inputs are snapshotted before awaiting WASM or WebCrypto", async () => {
  const originalSeed = new Uint8Array(32).fill(17);
  const originalD = new Uint8Array(32).fill(19);
  const seed = originalSeed.slice(),
    d = originalD.slice();
  const pendingAddress = deriveShieldedReceivePublicKey(seed, d);
  seed.fill(0);
  d.fill(0);
  const address = await pendingAddress;
  assert.deepEqual(address, await deriveShieldedReceivePublicKey(originalSeed, originalD));

  const publicKey = address.slice();
  const plaintext = Uint8Array.of(3, 4, 5);
  const aad = Uint8Array.of(7, 8),
    info = Uint8Array.of(9, 10);
  const pendingCiphertext = encryptShieldedReceivePayload({
    recipientPublicKey: publicKey,
    plaintext,
    aad,
    info,
  });
  publicKey.fill(0);
  plaintext.fill(0);
  aad.fill(0);
  info.fill(0);
  const ciphertext = await pendingCiphertext;

  const ciphertextInput = ciphertext.slice(),
    seedInput = originalSeed.slice();
  const aadInput = Uint8Array.of(7, 8),
    infoInput = Uint8Array.of(9, 10);
  const pendingPlaintext = decryptShieldedReceivePayload({
    ciphertext: ciphertextInput,
    viewIkm: seedInput,
    aad: aadInput,
    info: infoInput,
  });
  ciphertextInput.fill(0);
  seedInput.fill(0);
  aadInput.fill(0);
  infoInput.fill(0);
  const opened = await pendingPlaintext;
  assert.deepEqual(opened.plaintext, Uint8Array.of(3, 4, 5));
  assert.deepEqual(opened.recipientPublicKey, address);
});

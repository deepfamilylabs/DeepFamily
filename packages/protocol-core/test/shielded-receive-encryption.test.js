import assert from "node:assert/strict";
import test from "node:test";
import { getBytes, hexlify } from "ethers";
import { ristretto255, ristretto255_hasher } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import {
  assertShieldedReceivePublicKey,
  decryptShieldedReceivePayload,
  deriveShieldedReceivePublicKey,
  SHIELDED_RECEIVE_PUBLIC_KEY_BYTES,
} from "../shielded-receive-encryption.js";
import {
  decryptShieldedNote,
  deriveShieldedViewPublicKey,
  encryptShieldedNote,
  splitShieldedViewPublicKey,
} from "../shielded-hpke.js";
import { deriveShieldedHeirKeyMaterial } from "../shielded-inheritance.js";
import { deriveShieldedIndependentKeyMaterial } from "../shielded-independent-key.js";
import {
  createShieldedLetterEnvelope,
  decryptShieldedLetter,
  encryptShieldedLetter,
} from "../shielded-letters.js";
import { independentKeyVector } from "./shielded-independent-key.fixture.js";

const POOL = "0x0000000000000000000000000000000000000001";
const OTHER_POOL = "0x0000000000000000000000000000000000000002";
const scope = { chainId: 1030n, poolAddress: POOL };
const letterScope = { chainId: 1030n, lettersAddress: POOL, messageId: 71n };
const seed = getBytes(deriveShieldedHeirKeyMaterial(13n).hpkeIkm);
const diversifier = new Uint8Array(32).fill(19);
const utf8 = (value) => new TextEncoder().encode(value);
const join = (...parts) => new Uint8Array(Buffer.concat(parts));

test("fresh receive codes have different keys while explicit diversifiers reproduce their address", async () => {
  const first = await deriveShieldedReceivePublicKey(seed);
  const second = await deriveShieldedReceivePublicKey(seed);
  assert.equal(first.length, SHIELDED_RECEIVE_PUBLIC_KEY_BYTES);
  assert.equal(first.length, 64);
  assert.notDeepEqual(first.subarray(0, 32), second.subarray(0, 32));
  assert.notDeepEqual(first.subarray(32), second.subarray(32));
  const deterministic = await deriveShieldedReceivePublicKey(seed, diversifier);
  assert.deepEqual(deterministic.subarray(0, 32), diversifier);
  assert.deepEqual(await deriveShieldedReceivePublicKey(seed, diversifier), deterministic);
  assert.notDeepEqual(
    await deriveShieldedReceivePublicKey(deriveShieldedHeirKeyMaterial(14n).hpkeIkm, diversifier),
    deterministic,
  );
  assert.deepEqual(assertShieldedReceivePublicKey(deterministic), deterministic);
});

test("receive address validation rejects identity points, noncanonical encodings and wrong lengths", async () => {
  const address = await deriveShieldedReceivePublicKey(seed, diversifier);
  const identityPoint = address.slice();
  identityPoint.fill(0, 32);
  const noncanonicalPoint = address.slice();
  noncanonicalPoint.fill(255, 32);
  for (const invalid of [
    identityPoint,
    noncanonicalPoint,
    address.subarray(1),
    new Uint8Array([...address, 0]),
    await deriveShieldedViewPublicKey(seed),
  ]) {
    assert.throws(() => assertShieldedReceivePublicKey(invalid));
    if (invalid.length !== 32) {
      await assert.rejects(
        encryptShieldedNote({ ...scope, recipientPublicKey: invalid, payload: Uint8Array.of(1) }),
      );
    }
  }
  await assert.rejects(deriveShieldedReceivePublicKey(seed.subarray(1), diversifier));
  await assert.rejects(deriveShieldedReceivePublicKey(seed, diversifier.subarray(1)));
});

test("both original recovery paths scan multiple receive addresses without stored codes or diversifiers", async () => {
  const materials = [
    deriveShieldedHeirKeyMaterial(13n),
    await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: independentKeyVector.independentKeyRoot,
      independentKeyIdentitySecret: independentKeyVector.independentKeyIdentitySecret,
    }),
  ];
  for (const material of materials) {
    const ciphertexts = [];
    for (let index = 0; index < 4; index++) {
      const address = await deriveShieldedReceivePublicKey(material.hpkeIkm);
      const payload = Uint8Array.of(1, 2, index);
      ciphertexts.push(
        await encryptShieldedNote({ ...scope, recipientPublicKey: address, payload }),
      );
    }
    // No generated address, diversifier, ephemeral key or code is retained for recovery.
    const restoredSeed = getBytes(material.hpkeIkm);
    for (let index = 0; index < ciphertexts.length; index++) {
      assert.equal(ciphertexts[index].length, 512);
      assert.deepEqual(
        await decryptShieldedNote({
          ...scope,
          hpkeIkm: restoredSeed,
          ciphertext: ciphertexts[index],
        }),
        Uint8Array.of(1, 2, index),
      );
    }
  }
});

test("diversified note framing retains the fixed 512-byte envelope and enforces its payload limit", async () => {
  const address = await deriveShieldedReceivePublicKey(seed);
  for (const payload of [new Uint8Array(), new Uint8Array(397).fill(43)]) {
    const ciphertext = await encryptShieldedNote({
      ...scope,
      recipientPublicKey: address,
      payload,
    });
    assert.equal(ciphertext.length, 512);
    assert.deepEqual(await decryptShieldedNote({ ...scope, hpkeIkm: seed, ciphertext }), payload);
  }
  await assert.rejects(
    encryptShieldedNote({
      ...scope,
      recipientPublicKey: address,
      payload: new Uint8Array(398),
    }),
    { code: "SHIELDED_PAYLOAD_TOO_LARGE" },
  );
});

test("public note bytes do not carry the receive address or its reusable diversifier", async () => {
  const address = await deriveShieldedReceivePublicKey(seed, diversifier);
  const ciphertext = await encryptShieldedNote({
    ...scope,
    recipientPublicKey: address,
    payload: Uint8Array.of(1, 2, 3),
  });
  assert.equal(Buffer.from(ciphertext).includes(diversifier), false);
  assert.equal(Buffer.from(ciphertext).includes(address.subarray(32)), false);
});

test("fresh receive addresses require a cryptographic random source", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
  try {
    await assert.rejects(deriveShieldedReceivePublicKey(seed), {
      code: "SECURE_RANDOM_UNAVAILABLE",
    });
  } finally {
    Object.defineProperty(globalThis, "crypto", descriptor);
  }
});

test("modified diversifiers and valid replacement public points cannot decrypt under the original root", async () => {
  const address = await deriveShieldedReceivePublicKey(seed, diversifier);
  const changedDiversifier = address.slice();
  changedDiversifier[0] ^= 1;
  const otherPoint = await deriveShieldedReceivePublicKey(
    deriveShieldedHeirKeyMaterial(14n).hpkeIkm,
    diversifier,
  );
  const changedPoint = address.slice();
  changedPoint.set(otherPoint.subarray(32), 32);
  for (const modified of [changedDiversifier, changedPoint]) {
    const ciphertext = await encryptShieldedNote({
      ...scope,
      recipientPublicKey: modified,
      payload: Uint8Array.of(7),
    });
    await assert.rejects(decryptShieldedNote({ ...scope, hpkeIkm: seed, ciphertext }), {
      code: "SHIELDED_DECRYPTION_FAILED",
    });
  }
  const originalBinding = splitShieldedViewPublicKey(address);
  assert.notDeepEqual(splitShieldedViewPublicKey(changedDiversifier), originalBinding);
  assert.notDeepEqual(splitShieldedViewPublicKey(changedPoint), originalBinding);
});

test("wrong roots, deployment context and modified ephemeral/ciphertext bytes fail without secret-bearing errors", async () => {
  const address = await deriveShieldedReceivePublicKey(seed);
  const payload = new TextEncoder().encode("private-plaintext-sentinel");
  const ciphertext = await encryptShieldedNote({ ...scope, recipientPublicKey: address, payload });
  const pointChanged = ciphertext.slice();
  pointChanged[0] ^= 1;
  const identityPoint = ciphertext.slice();
  identityPoint.fill(0, 0, 32);
  const bodyChanged = ciphertext.slice();
  bodyChanged[bodyChanged.length - 1] ^= 1;
  const wrongSeed = getBytes(deriveShieldedHeirKeyMaterial(14n).hpkeIkm);
  for (const patch of [
    { hpkeIkm: wrongSeed },
    { chainId: 1031n },
    { poolAddress: OTHER_POOL },
    { ciphertext: pointChanged },
    { ciphertext: identityPoint },
    { ciphertext: bodyChanged },
  ]) {
    await assert.rejects(
      decryptShieldedNote({ ...scope, hpkeIkm: seed, ciphertext, ...patch }),
      (error) => {
        assert.equal(error.code, "SHIELDED_DECRYPTION_FAILED");
        assert.equal(error.cause, undefined);
        assert(!error.message.includes("private-plaintext-sentinel"));
        assert(!error.message.includes(hexlify(seed)));
        return true;
      },
    );
  }
});

test("valid AEAD ciphertexts with a false encrypted ephemeral opening are rejected", async () => {
  const address = await deriveShieldedReceivePublicKey(seed, diversifier);
  const aad = utf8("synthetic authenticated scope");
  const info = utf8("synthetic receive encryption purpose");
  for (const changedField of ["diversifier", "rseed"]) {
    // A malicious sender knows its ephemeral secret and can produce a valid GCM
    // tag around false metadata. This reaches the opening check after decryption.
    const rseed = new Uint8Array(32).fill(changedField === "rseed" ? 41 : 42);
    const wide = sha512(
      join(utf8("DeepFamily:ReceiveEphemeralScalar:v1"), rseed, Uint8Array.of(0)),
    );
    let e = 0n;
    for (let index = wide.length - 1; index >= 0; index--) e = (e << 8n) | BigInt(wide[index]);
    e %= ristretto255.Point.Fn.ORDER;
    assert.notEqual(e, 0n);
    const generator = ristretto255_hasher.hashToCurve(diversifier, {
      DST: "DeepFamily:ReceiveBase:ristretto255_XMD:SHA-512_R255MAP_RO_:v1",
    });
    const ephemeral = generator.multiply(e).toBytes();
    const shared = ristretto255.Point.fromBytes(address.subarray(32)).multiply(e).toBytes();
    const context = sha256(
      join(
        utf8("DeepFamily:ReceiveEncryption:ristretto255:HKDF-SHA256:AES-256-GCM:v1"),
        ephemeral,
        sha256(info),
        sha256(aad),
      ),
    );
    const key = hkdf(sha256, shared, context, utf8("DeepFamily:ReceiveEncryption:Key:v1"), 32);
    const nonce = hkdf(sha256, shared, context, utf8("DeepFamily:ReceiveEncryption:Nonce:v1"), 12);
    const wrongD = diversifier.slice();
    const wrongRseed = rseed.slice();
    (changedField === "diversifier" ? wrongD : wrongRseed)[0] ^= 1;
    const framed = join(wrongD, wrongRseed, utf8("must not return this plaintext"));
    const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
    const sealed = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
      aes,
      framed,
    );
    await assert.rejects(
      decryptShieldedReceivePayload({
        viewIkm: seed,
        ciphertext: join(ephemeral, new Uint8Array(sealed)),
        aad,
        info,
      }),
      (error) => {
        assert.equal(error.code, "SHIELDED_RECEIVE_DECRYPTION_FAILED");
        assert.equal(error.cause, undefined);
        assert(!error.message.includes("must not return this plaintext"));
        return true;
      },
    );
  }
});

test("receive key, address and encryption operations preserve all caller-owned buffers", async () => {
  const originalSeed = seed.slice();
  const originalDiversifier = diversifier.slice();
  const address = await deriveShieldedReceivePublicKey(seed, diversifier);
  const originalAddress = address.slice();
  const normalized = assertShieldedReceivePublicKey(address);
  normalized.fill(0);
  assert.deepEqual(address, originalAddress);
  const payload = Uint8Array.of(9, 8, 7);
  const ciphertext = await encryptShieldedNote({ ...scope, recipientPublicKey: address, payload });
  const originalCiphertext = ciphertext.slice();
  assert.deepEqual(await decryptShieldedNote({ ...scope, hpkeIkm: seed, ciphertext }), payload);
  assert.deepEqual(seed, originalSeed);
  assert.deepEqual(diversifier, originalDiversifier);
  assert.deepEqual(address, originalAddress);
  assert.deepEqual(payload, Uint8Array.of(9, 8, 7));
  assert.deepEqual(ciphertext, originalCiphertext);
});

test("the same root recovers letters sent to independently generated receive public keys", async () => {
  const ciphertexts = [];
  for (let index = 0; index < 3; index++) {
    ciphertexts.push(
      await encryptShieldedLetter({
        ...letterScope,
        recipientPublicKey: await deriveShieldedReceivePublicKey(seed),
        envelope: createShieldedLetterEnvelope({
          authorizationAlias: 9n,
          body: `Letter ${index}`,
          salt: BigInt(index + 1),
        }),
      }),
    );
  }
  for (let index = 0; index < ciphertexts.length; index++) {
    assert.equal(
      (
        await decryptShieldedLetter({
          ...letterScope,
          hpkeIkm: seed,
          ciphertext: ciphertexts[index],
        })
      ).body,
      `Letter ${index}`,
    );
  }
  await assert.rejects(
    encryptShieldedLetter({
      ...letterScope,
      recipientPublicKey: await deriveShieldedViewPublicKey(seed),
      envelope: createShieldedLetterEnvelope({
        authorizationAlias: 9n,
        body: "Budget keys cannot receive letters",
        salt: 1n,
      }),
    }),
  );
});

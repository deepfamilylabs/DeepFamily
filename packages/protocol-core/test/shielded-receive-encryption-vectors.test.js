import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { expand_message_xmd } from "@noble/curves/abstract/hash-to-curve.js";
import { sha512 } from "@noble/hashes/sha2.js";
import {
  assertShieldedReceivePublicKey,
  decryptShieldedReceivePayload,
  deriveShieldedReceivePublicKey,
  encryptShieldedReceivePayload,
} from "../shielded-receive-encryption.js";
import { getReceiveWasmBackend } from "../shielded-receive-wasm.js";
import {
  referenceDecryptReceive,
  referenceEncryptReceive,
  referenceHash,
  referenceReceiveAddress,
  referenceVector,
} from "./fixtures/shielded-receive-encryption.reference.js";

const vectors = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/shielded-receive-encryption.vectors.json", import.meta.url),
    "utf8",
  ),
);
const invalidPoints = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/ristretto255-invalid-encodings.json", import.meta.url),
    "utf8",
  ),
);
const rfcVectors = JSON.parse(
  fs.readFileSync(new URL("./fixtures/ristretto255-rfc-vectors.json", import.meta.url), "utf8"),
);
const fromHexFields = (value) =>
  Object.fromEntries(Object.entries(value).map(([name, hex]) => [name, Buffer.from(hex, "hex")]));
const toHexFields = (value) =>
  Object.fromEntries(
    Object.entries(value).map(([name, bytes]) => [name, Buffer.from(bytes).toString("hex")]),
  );
const utf8 = (value) => Buffer.from(value, "utf8");
const failure = { code: "SHIELDED_RECEIVE_DECRYPTION_FAILED" };

test("frozen receive vectors match an independent reference and the production backend", async () => {
  assert.equal(vectors.version, 1);
  assert.equal(vectors.vectors.length, 3);
  for (const vector of vectors.vectors) {
    const input = fromHexFields(vector.input);
    const expected = fromHexFields(vector.expected);
    assert.deepEqual(
      toHexFields(referenceVector(input)),
      vector.expected,
      `${vector.name}: reference drift`,
    );
    assert.deepEqual(
      Buffer.from(await deriveShieldedReceivePublicKey(input.viewIkm, input.diversifier)),
      expected.recipientPublicKey,
      `${vector.name}: address derivation`,
    );
    const opened = await decryptShieldedReceivePayload({
      ...input,
      ciphertext: expected.ciphertext,
    });
    assert.deepEqual(
      Buffer.from(opened.plaintext),
      input.plaintext,
      `${vector.name}: fixed ciphertext`,
    );
    assert.deepEqual(Buffer.from(opened.recipientPublicKey), expected.recipientPublicKey);
    const referenceOpened = referenceDecryptReceive({ ...input, ciphertext: expected.ciphertext });
    assert.deepEqual(referenceOpened.plaintext, input.plaintext);
    assert.deepEqual(referenceOpened.recipientPublicKey, expected.recipientPublicKey);
  }
});

test("independent implementations agree on derived addresses and both encryption directions", async () => {
  const addresses = new Set();
  for (let index = 0; index < 24; ++index) {
    const viewIkm = referenceHash(utf8(`receive property root ${index}`));
    const diversifier = referenceHash(utf8(`receive property diversifier ${index}`));
    const rseed = referenceHash(utf8(`receive property rseed ${index}`));
    const aad = index % 3 === 0 ? Buffer.alloc(0) : utf8(`authenticated property context ${index}`);
    const info = index % 4 === 0 ? Buffer.alloc(0) : utf8(`property domain ${index}`);
    const size = [0, 1, 3, 31, 32, 127, 397, 400][index % 8];
    const plaintext = Buffer.from(
      Array.from({ length: size }, (_, byte) => (byte * 31 + index) & 255),
    );
    const address = await deriveShieldedReceivePublicKey(viewIkm, diversifier);
    const referenceAddress = referenceReceiveAddress(viewIkm, diversifier);
    assert.deepEqual(Buffer.from(address), referenceAddress);
    assert(!addresses.has(referenceAddress.toString("hex")));
    addresses.add(referenceAddress.toString("hex"));

    const expectedCiphertext = referenceEncryptReceive({
      recipientPublicKey: referenceAddress,
      plaintext,
      aad,
      info,
      rseed,
    }).ciphertext;
    const opened = await decryptShieldedReceivePayload({
      viewIkm,
      ciphertext: expectedCiphertext,
      aad,
      info,
    });
    assert.deepEqual(Buffer.from(opened.plaintext), plaintext);
    assert.deepEqual(Buffer.from(opened.recipientPublicKey), referenceAddress);

    const ciphertext = await encryptShieldedReceivePayload({
      recipientPublicKey: address,
      plaintext,
      aad,
      info,
    });
    const independentlyOpened = referenceDecryptReceive({ ciphertext, viewIkm, aad, info });
    assert.deepEqual(independentlyOpened.plaintext, plaintext);
    assert.deepEqual(independentlyOpened.recipientPublicKey, referenceAddress);
  }
});

test("reference-generated ciphertexts reject other roots and independently changed domains", async () => {
  for (let index = 0; index < 8; ++index) {
    const viewIkm = referenceHash(utf8(`cross-root ${index}`));
    const diversifier = referenceHash(utf8(`cross-root diversifier ${index}`));
    const aad = utf8(`cross-root context ${index}`);
    const info = utf8(`cross-root domain ${index}`);
    const ciphertext = referenceEncryptReceive({
      recipientPublicKey: referenceReceiveAddress(viewIkm, diversifier),
      plaintext: utf8(`authenticated message ${index}`),
      aad,
      info,
      rseed: referenceHash(utf8(`cross-root rseed ${index}`)),
    }).ciphertext;
    for (const changed of [
      { viewIkm: referenceHash(utf8(`cross-root ${index + 1}`)) },
      { aad: Buffer.concat([aad, Uint8Array.of(0)]) },
      { info: Buffer.concat([info, Uint8Array.of(0)]) },
      { aad: info, info: aad },
    ]) {
      await assert.rejects(
        decryptShieldedReceivePayload({ ciphertext, viewIkm, aad, info, ...changed }),
        failure,
      );
    }
  }
});

test("production expansion, hash-to-group and multiplication match RFC 9380 and RFC 9496", async () => {
  // The reference implementation shares this protocol's author; these published values do not.
  const { expandMessageXmd, oneWayMap, multiples } = rfcVectors;
  assert.equal(expandMessageXmd.vectors.length, 7);
  for (const { msg, lenInBytes, uniformBytes } of expandMessageXmd.vectors) {
    const uniform = expand_message_xmd(utf8(msg), expandMessageXmd.dst, lenInBytes, sha512);
    assert.equal(Buffer.from(uniform).toString("hex"), uniformBytes);
  }
  const backend = await getReceiveWasmBackend();
  assert.equal(oneWayMap.vectors.length, 7);
  for (const { input, element } of oneWayMap.vectors) {
    const point = backend.hashToGroup(Buffer.from(input, "hex"));
    assert.equal(Buffer.from(point).toString("hex"), element);
  }
  assert.equal(multiples.encodings.length, 16);
  const generator = Buffer.from(multiples.encodings[1], "hex");
  for (const [k, encoding] of multiples.encodings.entries()) {
    const scalar = new Uint8Array(32);
    scalar[0] = k;
    if (k === 0) {
      // The identity result is rejected rather than encoded.
      assert.throws(() => backend.multiply(scalar, generator), {
        code: "SHIELDED_RECEIVE_WASM_OPERATION_FAILED",
      });
    } else {
      assert.equal(Buffer.from(backend.multiply(scalar, generator)).toString("hex"), encoding);
    }
  }
});

test("all RFC 9496 A.2 invalid encodings are rejected as address and ciphertext points", async () => {
  assert.equal(invalidPoints.encodings.length, 29);
  const vector = vectors.vectors[1];
  const input = fromHexFields(vector.input);
  const expected = fromHexFields(vector.expected);
  for (const invalidHex of [...invalidPoints.encodings, "00".repeat(32)]) {
    const point = Buffer.from(invalidHex, "hex");
    assert.equal(point.length, 32);
    const address = Buffer.concat([input.diversifier, point]);
    assert.throws(() => assertShieldedReceivePublicKey(address), {
      code: "INVALID_SHIELDED_RECEIVE_PUBLIC_KEY",
    });
    await assert.rejects(encryptShieldedReceivePayload({ recipientPublicKey: address, ...input }), {
      code: "INVALID_SHIELDED_RECEIVE_PUBLIC_KEY",
    });
    const ciphertext = Buffer.from(expected.ciphertext);
    ciphertext.set(point, 0);
    await assert.rejects(decryptShieldedReceivePayload({ ...input, ciphertext }), failure);
  }
});

test("every single-bit mutation of the frozen 512-byte ciphertext fails authentication", async () => {
  const vector = vectors.vectors[2];
  const input = fromHexFields(vector.input);
  const ciphertext = Buffer.from(vector.expected.ciphertext, "hex");
  assert.equal(ciphertext.length, 512);
  for (let offset = 0; offset < ciphertext.length; ++offset) {
    for (let bit = 0; bit < 8; ++bit) {
      const changed = Buffer.from(ciphertext);
      changed[offset] ^= 1 << bit;
      await assert.rejects(
        decryptShieldedReceivePayload({ ...input, ciphertext: changed }),
        failure,
        `offset ${offset}, bit ${bit}`,
      );
    }
  }
  const valid = await decryptShieldedReceivePayload({ ...input, ciphertext });
  assert.deepEqual(Buffer.from(valid.plaintext), input.plaintext);
});

test("deterministic malformed-length and multi-byte mutations never produce plaintext", async () => {
  const vector = vectors.vectors[2];
  const input = fromHexFields(vector.input);
  const ciphertext = Buffer.from(vector.expected.ciphertext, "hex");
  for (const length of [0, 1, 31, 32, 63, 64, 95, 111, 112, 127, 255, 511]) {
    await assert.rejects(
      decryptShieldedReceivePayload({ ...input, ciphertext: ciphertext.subarray(0, length) }),
      failure,
    );
  }
  await assert.rejects(
    decryptShieldedReceivePayload({
      ...input,
      ciphertext: Buffer.concat([ciphertext, Uint8Array.of(0)]),
    }),
    failure,
  );
  for (let index = 0; index < 128; ++index) {
    const entropy = referenceHash(utf8(`receive ciphertext mutation ${index}`));
    const changed = Buffer.from(ciphertext);
    // Distinct positions prevent a generated mutation from cancelling itself.
    const positions = new Set();
    for (let byte = 0; byte < 4; ++byte) {
      let offset = entropy.readUInt16BE(byte * 2) % changed.length;
      while (positions.has(offset)) offset = (offset + 1) % changed.length;
      positions.add(offset);
      changed[offset] ^= entropy[8 + byte] || 1;
    }
    await assert.rejects(decryptShieldedReceivePayload({ ...input, ciphertext: changed }), failure);
  }
});

// Test-only reference: curve arithmetic is noble; hashing, HKDF and AEAD are Node crypto.
// Do not import production protocol helpers here: independent framing and domain strings
// intentionally make changes to the protocol fail against the frozen vectors.
import assert from "node:assert/strict";
import { createHash, createCipheriv, createDecipheriv, hkdfSync } from "node:crypto";
import { ristretto255, ristretto255_hasher } from "@noble/curves/ed25519.js";

const Point = ristretto255.Point;
const utf8 = (value) => Buffer.from(value, "utf8");
const join = (...parts) => Buffer.concat(parts.map((part) => Buffer.from(part)));
const digest = (algorithm, ...parts) =>
  createHash(algorithm)
    .update(join(...parts))
    .digest();
const DST = utf8("DeepFamily:ReceiveBase:ristretto255_XMD:SHA-512_R255MAP_RO_:v1");
const VIEW = utf8("DeepFamily:ReceiveViewScalar:v1");
const EPHEMERAL = utf8("DeepFamily:ReceiveEphemeralScalar:v1");
const KDF = utf8("DeepFamily:ReceiveEncryption:ristretto255:HKDF-SHA256:AES-256-GCM:v1");
const KEY = utf8("DeepFamily:ReceiveEncryption:Key:v1");
const NONCE = utf8("DeepFamily:ReceiveEncryption:Nonce:v1");

export const referenceHash = (...parts) => digest("sha256", ...parts);

// RFC 9380 expand_message_xmd, SHA-512, len_in_bytes=64 (one output block).
function expand(diversifier) {
  const dstPrime = join(DST, Uint8Array.of(DST.length));
  const b0 = digest("sha512", Buffer.alloc(128), diversifier, Uint8Array.of(0, 64, 0), dstPrime);
  return digest("sha512", b0, Uint8Array.of(1), dstPrime);
}

function scalar(domain, seed) {
  assert.equal(seed.length, 32);
  for (let counter = 0; counter < 256; ++counter) {
    const wide = digest("sha512", domain, seed, Uint8Array.of(counter));
    let value = 0n;
    for (let i = wide.length - 1; i >= 0; --i) value = (value << 8n) | BigInt(wide[i]);
    value %= Point.Fn.ORDER;
    if (value !== 0n) return value;
  }
  throw Error("Reference nonzero scalar derivation exhausted");
}

function scalarBytes(value) {
  const bytes = Buffer.alloc(32);
  for (let i = 0; i < bytes.length; ++i) {
    bytes[i] = Number(value & 255n);
    value >>= 8n;
  }
  return bytes;
}

function base(diversifier) {
  assert.equal(diversifier.length, 32);
  // This maps the independently expanded 64 bytes via RFC 9496 element derivation.
  const point = ristretto255_hasher.deriveToCurve(expand(diversifier));
  assert(!point.equals(Point.ZERO));
  return point;
}

function decode(bytes) {
  const point = Point.fromBytes(bytes);
  assert(!point.equals(Point.ZERO));
  return point;
}

function material(shared, ephemeral, aad, info) {
  const context = digest("sha256", KDF, ephemeral, digest("sha256", info), digest("sha256", aad));
  return {
    context,
    key: Buffer.from(hkdfSync("sha256", shared, context, KEY, 32)),
    nonce: Buffer.from(hkdfSync("sha256", shared, context, NONCE, 12)),
  };
}

export function referenceReceiveAddress(viewIkm, diversifier) {
  const v = scalar(VIEW, viewIkm);
  const generator = base(diversifier);
  return join(diversifier, generator.multiply(v).toBytes());
}

export function referenceEncryptReceive({ recipientPublicKey, plaintext, aad, info, rseed }) {
  assert.equal(recipientPublicKey.length, 64);
  const d = recipientPublicKey.subarray(0, 32);
  const generator = base(d);
  const e = scalar(EPHEMERAL, rseed);
  const ephemeral = Buffer.from(generator.multiply(e).toBytes());
  const shared = Buffer.from(decode(recipientPublicKey.subarray(32)).multiply(e).toBytes());
  const { context, key, nonce } = material(shared, ephemeral, aad, info);
  const framed = join(d, rseed, plaintext);
  const aes = createCipheriv("aes-256-gcm", key, nonce);
  aes.setAAD(aad);
  const sealed = join(aes.update(framed), aes.final(), aes.getAuthTag());
  return {
    generator: Buffer.from(generator.toBytes()),
    ephemeralScalar: scalarBytes(e),
    ephemeral,
    shared,
    context,
    key,
    nonce,
    ciphertext: join(ephemeral, sealed),
  };
}

export function referenceDecryptReceive({ ciphertext, viewIkm, aad, info }) {
  assert(ciphertext.length >= 112);
  const ephemeral = ciphertext.subarray(0, 32);
  const v = scalar(VIEW, viewIkm);
  const shared = Buffer.from(decode(ephemeral).multiply(v).toBytes());
  const { key, nonce } = material(shared, ephemeral, aad, info);
  const aes = createDecipheriv("aes-256-gcm", key, nonce);
  aes.setAAD(aad);
  aes.setAuthTag(ciphertext.subarray(-16));
  const framed = join(aes.update(ciphertext.subarray(32, -16)), aes.final());
  const d = framed.subarray(0, 32);
  const rseed = framed.subarray(32, 64);
  const generator = base(d);
  assert.deepEqual(
    Buffer.from(generator.multiply(scalar(EPHEMERAL, rseed)).toBytes()),
    Buffer.from(ephemeral),
  );
  return {
    plaintext: framed.subarray(64),
    recipientPublicKey: join(d, generator.multiply(v).toBytes()),
  };
}

export function referenceVector(inputs) {
  const recipientPublicKey = referenceReceiveAddress(inputs.viewIkm, inputs.diversifier);
  return {
    viewingScalar: scalarBytes(scalar(VIEW, inputs.viewIkm)),
    recipientPublicKey,
    ...referenceEncryptReceive({ ...inputs, recipientPublicKey }),
  };
}

import { ristretto255, ristretto255_hasher } from "@noble/curves/ed25519.js";
import { expand_message_xmd } from "@noble/curves/abstract/hash-to-curve.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { toUtf8Bytes } from "ethers";
import { concatBytes, copyBytes, equalBytesConstantTime, wipeBytes } from "./bytes.js";
import { ProtocolError, protocolAssert } from "./errors.js";
import { getReceiveWasmBackend } from "./shielded-receive-wasm.js";

export const SHIELDED_RECEIVE_PUBLIC_KEY_BYTES = 64;
export const SHIELDED_RECEIVE_METADATA_BYTES = 64;
const Point = ristretto255.Point;
const BASE_DST = "DeepFamily:ReceiveBase:ristretto255_XMD:SHA-512_R255MAP_RO_:v1";
const VIEW_DOMAIN = toUtf8Bytes("DeepFamily:ReceiveViewScalar:v1");
const EPHEMERAL_DOMAIN = toUtf8Bytes("DeepFamily:ReceiveEphemeralScalar:v1");
const KDF_DOMAIN = toUtf8Bytes(
  "DeepFamily:ReceiveEncryption:ristretto255:HKDF-SHA256:AES-256-GCM:v1",
);
const KEY_LABEL = toUtf8Bytes("DeepFamily:ReceiveEncryption:Key:v1");
const NONCE_LABEL = toUtf8Bytes("DeepFamily:ReceiveEncryption:Nonce:v1");
// Every caller already propagates this fixed code; it also covers missing WebCrypto AES-GCM.
const RUNTIME_UNAVAILABLE = "SHIELDED_RECEIVE_WASM_UNAVAILABLE";

/** The WASM curve backend and WebCrypto AES-GCM are both required; neither has a fallback. */
async function getReceiveRuntime() {
  // Browsers expose WebCrypto only in secure contexts. Its absence must not read as a foreign record.
  const subtle = globalThis.crypto?.subtle;
  protocolAssert(
    typeof subtle?.importKey === "function" &&
      typeof subtle.encrypt === "function" &&
      typeof subtle.decrypt === "function",
    RUNTIME_UNAVAILABLE,
    "WebCrypto AES-GCM is unavailable",
  );
  return { backend: await getReceiveWasmBackend(), subtle };
}

/** Initialize before a wallet scan so an unavailable local runtime cannot look like an empty wallet. */
export async function initializeShieldedReceiveEncryption() {
  await getReceiveRuntime();
}

function bytes32(value, label) {
  let bytes;
  try {
    bytes = copyBytes(value, label);
  } catch (error) {
    // Hex parser causes can embed the complete input seed.
    throw new ProtocolError(
      error instanceof ProtocolError ? error.code : "INVALID_BYTES",
      `${label} must be bytes or 0x-prefixed hex`,
    );
  }
  if (bytes.length !== 32) {
    wipeBytes(bytes);
    throw new ProtocolError("INVALID_SHIELDED_KEY_LENGTH", `${label} must be 32 bytes`);
  }
  return bytes;
}

function random32() {
  protocolAssert(
    typeof globalThis.crypto?.getRandomValues === "function",
    "SECURE_RANDOM_UNAVAILABLE",
    "A cryptographic random source is required",
  );
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

function isZero(bytes) {
  let combined = 0;
  for (let index = 0; index < bytes.length; index++) combined |= bytes[index];
  return combined === 0;
}

function scalar(backend, domain, seed) {
  // Wide reduction has negligible bias; the counter specifies the zero retry.
  for (let counter = 0; counter < 256; counter++) {
    let input, wide, value;
    try {
      input = concatBytes(domain, seed, Uint8Array.of(counter));
      wide = sha512(input);
      value = backend.reduceScalar(wide);
      if (!isZero(value)) return value;
      wipeBytes(value);
    } finally {
      wipeBytes(input);
      wipeBytes(wide);
    }
  }
  throw new ProtocolError(
    "SHIELDED_RECEIVE_KEY_DERIVATION_FAILED",
    "Receive key derivation failed",
  );
}

function publicBase(diversifier) {
  const point = ristretto255_hasher.hashToCurve(diversifier, { DST: BASE_DST });
  protocolAssert(
    !point.equals(Point.ZERO),
    "INVALID_SHIELDED_RECEIVE_PUBLIC_KEY",
    "Invalid receive key diversifier",
  );
  return point;
}

function base(backend, diversifier) {
  const uniform = expand_message_xmd(diversifier, BASE_DST, 64, sha512);
  try {
    const point = backend.hashToGroup(uniform);
    protocolAssert(
      !isZero(point),
      "INVALID_SHIELDED_RECEIVE_PUBLIC_KEY",
      "Invalid receive key diversifier",
    );
    return point;
  } finally {
    wipeBytes(uniform);
  }
}

function decodePoint(bytes) {
  const point = Point.fromBytes(bytes);
  protocolAssert(
    !point.equals(Point.ZERO),
    "INVALID_SHIELDED_RECEIVE_PUBLIC_KEY",
    "Receive points must be nonzero",
  );
  return point;
}

/** Canonical address: diversifier (32 bytes) followed by a nonidentity Ristretto point. */
export function assertShieldedReceivePublicKey(value) {
  let bytes;
  try {
    bytes = copyBytes(value, "receivePublicKey");
    protocolAssert(
      bytes.length === SHIELDED_RECEIVE_PUBLIC_KEY_BYTES,
      "INVALID_SHIELDED_RECEIVE_PUBLIC_KEY",
      "Receive public key must be 64 bytes",
    );
    publicBase(bytes.subarray(0, 32));
    decodePoint(bytes.subarray(32));
    return bytes;
  } catch {
    wipeBytes(bytes);
    throw new ProtocolError(
      "INVALID_SHIELDED_RECEIVE_PUBLIC_KEY",
      "Invalid diversified receive public key",
    );
  }
}

/** Same view seed, fresh public key. No issued-code state is needed for decryption. */
export async function deriveShieldedReceivePublicKey(viewIkm, diversifier) {
  let seed, d, viewScalar;
  try {
    seed = bytes32(viewIkm, "viewIkm");
    d = diversifier === undefined ? random32() : bytes32(diversifier, "diversifier");
    const backend = await getReceiveWasmBackend();
    viewScalar = scalar(backend, VIEW_DOMAIN, seed);
    const publicPoint = backend.multiply(viewScalar, base(backend, d));
    return concatBytes(d, publicPoint);
  } finally {
    wipeBytes(seed);
    wipeBytes(d);
    wipeBytes(viewScalar);
  }
}

function keyMaterial(shared, ephemeral, aad, info) {
  // Scan-time context intentionally excludes the yet-encrypted diversifier/address.
  const context = sha256(concatBytes(KDF_DOMAIN, ephemeral, sha256(info), sha256(aad)));
  return {
    key: hkdf(sha256, shared, context, KEY_LABEL, 32),
    nonce: hkdf(sha256, shared, context, NONCE_LABEL, 12),
  };
}

/** Internal note/letter primitive. Not RFC 9180 HPKE; uses a diversified DH base. */
export async function encryptShieldedReceivePayload(input) {
  let address, plaintext, aad, info, rseed, ephemeralScalar, shared, framed, key, nonce;
  try {
    address = assertShieldedReceivePublicKey(input.recipientPublicKey);
    plaintext = copyBytes(input.plaintext, "plaintext");
    aad = copyBytes(input.aad, "aad");
    info = copyBytes(input.info, "info");
    rseed = random32();
    const { backend, subtle } = await getReceiveRuntime();
    ephemeralScalar = scalar(backend, EPHEMERAL_DOMAIN, rseed);
    const ephemeral = backend.multiply(ephemeralScalar, base(backend, address.subarray(0, 32)));
    shared = backend.multiply(ephemeralScalar, address.subarray(32));
    ({ key, nonce } = keyMaterial(shared, ephemeral, aad, info));
    framed = concatBytes(address.subarray(0, 32), rseed, plaintext);
    const aes = await subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
    const sealed = await subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
      aes,
      framed,
    );
    return concatBytes(ephemeral, new Uint8Array(sealed));
  } finally {
    for (const bytes of [
      address,
      plaintext,
      aad,
      info,
      rseed,
      ephemeralScalar,
      shared,
      framed,
      key,
      nonce,
    ])
      wipeBytes(bytes);
  }
}

/** Scan with just the restored view seed; return data only after ephemeral consistency checks. */
export async function decryptShieldedReceivePayload(input) {
  let ciphertext, seed, aad, info, viewScalar, ephemeralScalar, shared, framed, key, nonce;
  try {
    ciphertext = copyBytes(input.ciphertext, "ciphertext");
    seed = bytes32(input.viewIkm, "viewIkm");
    aad = copyBytes(input.aad, "aad");
    info = copyBytes(input.info, "info");
    protocolAssert(
      ciphertext.length >= 32 + SHIELDED_RECEIVE_METADATA_BYTES + 16,
      "SHIELDED_RECEIVE_DECRYPTION_FAILED",
      "Receive ciphertext is incomplete",
    );
    const ephemeral = ciphertext.subarray(0, 32);
    decodePoint(ephemeral);
    const { backend, subtle } = await getReceiveRuntime();
    viewScalar = scalar(backend, VIEW_DOMAIN, seed);
    shared = backend.multiply(viewScalar, ephemeral);
    ({ key, nonce } = keyMaterial(shared, ephemeral, aad, info));
    const aes = await subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
    framed = new Uint8Array(
      await subtle.decrypt(
        { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
        aes,
        ciphertext.subarray(32),
      ),
    );
    const d = framed.subarray(0, 32);
    const rseed = framed.subarray(32, 64);
    const generator = base(backend, d);
    ephemeralScalar = scalar(backend, EPHEMERAL_DOMAIN, rseed);
    const expectedEphemeral = backend.multiply(ephemeralScalar, generator);
    protocolAssert(
      equalBytesConstantTime(expectedEphemeral, ephemeral),
      "SHIELDED_RECEIVE_DECRYPTION_FAILED",
      "Receive ephemeral key does not match its encrypted opening",
    );
    return {
      plaintext: framed.slice(SHIELDED_RECEIVE_METADATA_BYTES),
      recipientPublicKey: concatBytes(d, backend.multiply(viewScalar, generator)),
    };
  } catch (error) {
    // Never serialize AEAD/library diagnostics, plaintext, seed or nested causes.
    if (error instanceof ProtocolError && error.code === RUNTIME_UNAVAILABLE) {
      throw new ProtocolError(RUNTIME_UNAVAILABLE, "The receive encryption runtime is unavailable");
    }
    throw new ProtocolError(
      "SHIELDED_RECEIVE_DECRYPTION_FAILED",
      "Could not decrypt diversified receive payload",
    );
  } finally {
    for (const bytes of [
      ciphertext,
      seed,
      aad,
      info,
      viewScalar,
      ephemeralScalar,
      shared,
      framed,
      key,
      nonce,
    ])
      wipeBytes(bytes);
  }
}

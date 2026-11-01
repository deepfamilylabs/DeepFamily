import { ristretto255, ristretto255_hasher } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { toUtf8Bytes } from "ethers";
import { concatBytes, copyBytes, equalBytesConstantTime, wipeBytes } from "./bytes.js";
import { ProtocolError, protocolAssert } from "./errors.js";

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

function bytes32(value, label) {
  const bytes = copyBytes(value, label);
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

function scalar(domain, seed) {
  // Wide reduction has negligible bias; the counter specifies the zero retry.
  for (let counter = 0; counter < 256; counter++) {
    const wide = sha512(concatBytes(domain, seed, Uint8Array.of(counter)));
    let value = 0n;
    for (let i = wide.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(wide[i]);
    wipeBytes(wide);
    value %= Point.Fn.ORDER;
    if (value !== 0n) return value;
  }
  throw new ProtocolError(
    "SHIELDED_RECEIVE_KEY_DERIVATION_FAILED",
    "Receive key derivation failed",
  );
}

function base(diversifier) {
  const point = ristretto255_hasher.hashToCurve(diversifier, { DST: BASE_DST });
  protocolAssert(
    !point.equals(Point.ZERO),
    "INVALID_SHIELDED_RECEIVE_PUBLIC_KEY",
    "Invalid receive key diversifier",
  );
  return point;
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
    base(bytes.subarray(0, 32));
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
  let seed, d;
  try {
    seed = bytes32(viewIkm, "viewIkm");
    d = diversifier === undefined ? random32() : bytes32(diversifier, "diversifier");
    const publicPoint = base(d).multiply(scalar(VIEW_DOMAIN, seed));
    return concatBytes(d, publicPoint.toBytes());
  } finally {
    wipeBytes(seed);
    wipeBytes(d);
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
  let address, plaintext, aad, info, rseed, shared, framed, key, nonce;
  try {
    address = assertShieldedReceivePublicKey(input.recipientPublicKey);
    plaintext = copyBytes(input.plaintext, "plaintext");
    aad = copyBytes(input.aad, "aad");
    info = copyBytes(input.info, "info");
    rseed = random32();
    const ephemeralScalar = scalar(EPHEMERAL_DOMAIN, rseed);
    const ephemeral = base(address.subarray(0, 32)).multiply(ephemeralScalar).toBytes();
    shared = decodePoint(address.subarray(32)).multiply(ephemeralScalar).toBytes();
    ({ key, nonce } = keyMaterial(shared, ephemeral, aad, info));
    framed = concatBytes(address.subarray(0, 32), rseed, plaintext);
    const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
    const sealed = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
      aes,
      framed,
    );
    return concatBytes(ephemeral, new Uint8Array(sealed));
  } finally {
    for (const bytes of [address, plaintext, aad, info, rseed, shared, framed, key, nonce])
      wipeBytes(bytes);
  }
}

/** Scan with just the restored view seed; return data only after ephemeral consistency checks. */
export async function decryptShieldedReceivePayload(input) {
  let ciphertext, seed, aad, info, shared, framed, key, nonce;
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
    const viewScalar = scalar(VIEW_DOMAIN, seed);
    shared = decodePoint(ephemeral).multiply(viewScalar).toBytes();
    ({ key, nonce } = keyMaterial(shared, ephemeral, aad, info));
    const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
    framed = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
        aes,
        ciphertext.subarray(32),
      ),
    );
    const d = framed.subarray(0, 32);
    const rseed = framed.subarray(32, 64);
    const generator = base(d);
    const expectedEphemeral = generator.multiply(scalar(EPHEMERAL_DOMAIN, rseed)).toBytes();
    protocolAssert(
      equalBytesConstantTime(expectedEphemeral, ephemeral),
      "SHIELDED_RECEIVE_DECRYPTION_FAILED",
      "Receive ephemeral key does not match its encrypted opening",
    );
    return {
      plaintext: framed.slice(SHIELDED_RECEIVE_METADATA_BYTES),
      recipientPublicKey: concatBytes(d, generator.multiply(viewScalar).toBytes()),
    };
  } catch {
    // Never serialize AEAD/library diagnostics, plaintext, seed or nested causes.
    throw new ProtocolError(
      "SHIELDED_RECEIVE_DECRYPTION_FAILED",
      "Could not decrypt diversified receive payload",
    );
  } finally {
    for (const bytes of [ciphertext, seed, aad, info, shared, framed, key, nonce]) wipeBytes(bytes);
  }
}

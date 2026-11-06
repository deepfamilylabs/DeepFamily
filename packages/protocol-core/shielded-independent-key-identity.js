import { argon2id } from "hash-wasm";
import { getBytes, sha256 } from "ethers";
import { concatBytes, utf8Bytes, wipeBytes } from "./bytes.js";
import { UNICODE_WHITE_SPACE_VERSION } from "./canonical.js";
import { protocolAssert } from "./errors.js";
import { normalizeIdentityFields, normalizePassphrase } from "./identity.js";

// The independent-key KDF has its own domain and parameters. Text preparation
// shares the same trim-only rules as every person identity and file KDF.
export const SHIELDED_INDEPENDENT_KEY_UNICODE_VERSION = UNICODE_WHITE_SPACE_VERSION;
export const INDEPENDENT_KEY_ARGON2ID_PROFILE = Object.freeze({
  status: "candidate-awaiting-device-benchmark",
  provisional: true,
  algorithm: "Argon2id",
  version: 0x13,
  memoryKiB: 65_536,
  iterations: 3,
  parallelism: 1,
  outputBytes: 32,
  saltBytes: 16,
});
const PASSWORD_DOMAIN = "DeepFamily:IndependentKeyIdentityPassword:v1";
const SALT_DOMAIN = "DeepFamily:IndependentKeyIdentitySalt:v1";
/** Share person identity validation and preserve every interior name character. */
export function normalizeShieldedIndependentKeyIdentity(input) {
  return normalizeIdentityFields(input);
}

/** uint16 name length, UTF-8 name, uint8 gender/BC, uint16 year, uint8 month/day. */
export function encodeShieldedIndependentKeyIdentity(input) {
  const identity = normalizeShieldedIndependentKeyIdentity(input);
  const name = utf8Bytes(identity.fullName);
  try {
    const bytes = new Uint8Array(2 + name.length + 6);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, name.length, false);
    bytes.set(name, 2);
    const offset = 2 + name.length;
    bytes[offset] = identity.gender;
    bytes[offset + 1] = identity.isBirthBC ? 1 : 0;
    view.setUint16(offset + 2, identity.birthYear, false);
    bytes[offset + 4] = identity.birthMonth;
    bytes[offset + 5] = identity.birthDay;
    return bytes;
  } finally {
    wipeBytes(name);
  }
}

/** Use the common trim-only rule, then require a nonempty asset credential. */
export function normalizeShieldedIndependentKeyPassphrase(rawPassphrase) {
  const normalized = normalizePassphrase(rawPassphrase);
  protocolAssert(
    normalized.length > 0,
    "INDEPENDENT_KEY_PASSPHRASE_REQUIRED",
    "Independent-key credentials require a nonblank passphrase",
  );
  return normalized;
}

/** Password bytes owned by the caller, who must wipe them after use. */
export function buildShieldedIndependentKeyPasswordBytes(rawPassphrase) {
  const normalizedBytes = utf8Bytes(normalizeShieldedIndependentKeyPassphrase(rawPassphrase));
  try {
    return concatBytes(utf8Bytes(PASSWORD_DOMAIN), Uint8Array.of(0), normalizedBytes);
  } finally {
    wipeBytes(normalizedBytes);
  }
}

export function deriveShieldedIndependentKeyIdentitySalt(identity) {
  const encoded = encodeShieldedIndependentKeyIdentity(identity);
  const input = concatBytes(utf8Bytes(SALT_DOMAIN), Uint8Array.of(0), encoded);
  let digest;
  try {
    digest = getBytes(sha256(input));
    return digest.slice(0, INDEPENDENT_KEY_ARGON2ID_PROFILE.saltBytes);
  } finally {
    wipeBytes(encoded);
    wipeBytes(input);
    wipeBytes(digest);
  }
}

/** Dedicated asset-Worker entry point. The returned secret is caller-owned. */
export async function deriveShieldedIndependentKeyIdentitySecret(input) {
  let password;
  let salt;
  let output;
  try {
    salt = deriveShieldedIndependentKeyIdentitySalt(input?.identity);
    password = buildShieldedIndependentKeyPasswordBytes(input?.rawPassphrase);
    // hash-wasm 4.12.0 fixes Argon2 version 0x13 and empty associated data;
    // each call owns its temporary WASM work memory, released when it returns.
    output = await argon2id({
      password,
      salt,
      secret: new Uint8Array(),
      parallelism: INDEPENDENT_KEY_ARGON2ID_PROFILE.parallelism,
      iterations: INDEPENDENT_KEY_ARGON2ID_PROFILE.iterations,
      memorySize: INDEPENDENT_KEY_ARGON2ID_PROFILE.memoryKiB,
      hashLength: INDEPENDENT_KEY_ARGON2ID_PROFILE.outputBytes,
      outputType: "binary",
    });
    protocolAssert(
      output instanceof Uint8Array && output.length === 32,
      "INVALID_ARGON2_OUTPUT",
      "Independent-key Argon2id returned an unexpected output length",
    );
    const ownedOutput = output;
    output = undefined;
    return ownedOutput;
  } finally {
    wipeBytes(password);
    wipeBytes(salt);
    wipeBytes(output);
  }
}

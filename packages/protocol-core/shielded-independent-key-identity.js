import { argon2id } from "hash-wasm";
import { getBytes, sha256 } from "ethers";
import {
  assertUnicodeScalarString,
  bigintFrom,
  concatBytes,
  utf8Bytes,
  wipeBytes,
} from "./bytes.js";
import { protocolAssert } from "./errors.js";
import { assertFreeformClass } from "./precis.js";
import {
  mapNonAsciiSpacesToAscii,
  normalizeUnicodeNfc,
  normalizeUnicodeNfkc,
} from "./unicode-normalization.js";

// These are independent-key protocol constants, independent of identity suites, current
// Unicode defaults and device performance. Release still requires device review.
export const SHIELDED_INDEPENDENT_KEY_UNICODE_VERSION = "17.0.0";
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
const WHITE_SPACE_RUN =
  /[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu;
const WHITE_SPACE_ONLY =
  /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/u;

function smallUnsigned(value, maximum, label) {
  return Number(bigintFrom(value, label, BigInt(maximum)));
}

/** Frozen independent-key validation; never first normalize through an identity suite. */
export function normalizeShieldedIndependentKeyIdentity(input) {
  protocolAssert(
    input && typeof input === "object",
    "INVALID_IDENTITY",
    "Independent-key identity fields are required",
  );
  protocolAssert(
    typeof input.fullName === "string",
    "INVALID_FULL_NAME",
    "fullName must be a string",
  );
  assertUnicodeScalarString(input.fullName, "fullName");
  const fullName = normalizeUnicodeNfkc(input.fullName, "fullName")
    .replace(WHITE_SPACE_RUN, " ")
    .replace(/^ +| +$/gu, "");
  const nameBytes = utf8Bytes(fullName);
  try {
    protocolAssert(
      nameBytes.length > 0,
      "EMPTY_FULL_NAME",
      "Canonical independent-key fullName cannot be empty",
    );
    protocolAssert(
      nameBytes.length <= 256,
      "FULL_NAME_TOO_LARGE",
      "Canonical independent-key fullName exceeds 256 UTF-8 bytes",
    );
  } finally {
    wipeBytes(nameBytes);
  }
  protocolAssert(
    typeof input.isBirthBC === "boolean",
    "INVALID_BOOLEAN",
    "isBirthBC must be boolean",
  );
  return {
    fullName,
    gender: smallUnsigned(input.gender, 255, "gender"),
    birthYear: smallUnsigned(input.birthYear, 65_535, "birthYear"),
    birthMonth: smallUnsigned(input.birthMonth, 12, "birthMonth"),
    birthDay: smallUnsigned(input.birthDay, 31, "birthDay"),
    isBirthBC: input.isBirthBC,
  };
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

/** Unicode 17 PRECIS FreeformClass, non-ASCII Zs mapping, NFC, no trim/case map. */
export function normalizeShieldedIndependentKeyPassphrase(rawPassphrase) {
  protocolAssert(
    typeof rawPassphrase === "string",
    "INVALID_PASSPHRASE",
    "Passphrase must be a string",
  );
  assertFreeformClass(rawPassphrase, "passphrase");
  const normalized = normalizeUnicodeNfc(
    mapNonAsciiSpacesToAscii(rawPassphrase, "passphrase"),
    "passphrase",
  );
  assertFreeformClass(normalized, "passphrase");
  protocolAssert(
    !WHITE_SPACE_ONLY.test(normalized),
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

import { bech32m } from "@scure/base";
import { concat, getBytes, sha256, toUtf8Bytes } from "ethers";
import { poseidon3 } from "poseidon-lite";
import { bigintFrom, bytesToHex, copyBytes } from "./bytes.js";
import { MAX_UINT64, SNARK_SCALAR_FIELD } from "./constants.js";
import { protocolAssert } from "./errors.js";
import {
  SHIELDED_RECEIVE_PUBLIC_KEY_BYTES,
  deriveShieldedReceiveOwnerNonce,
  splitShieldedViewPublicKey,
} from "./shielded-hpke.js";
import { receiveProofFromWords, receiveProofWords } from "./shielded-receive-proof-codec.js";

export const SHIELDED_RECEIVE_CREDENTIAL_VERSION = 1;
export const SHIELDED_AUTHORIZATION_ALIAS_DOMAIN = 202610210001n;
export const SHIELDED_RECEIVE_CREDENTIAL_PUBLIC_SIGNAL_COUNTS = Object.freeze({
  receive: 8,
  fund: 9,
});
const PREFIX = Object.freeze({ receive: "dfrecv", fund: "dffund" });
const MAX_FIELD = SNARK_SCALAR_FIELD - 1n;
const field = (value, label) => bigintFrom(value, label, MAX_FIELD);
const invalid = (condition, message) =>
  protocolAssert(condition, "INVALID_SHIELDED_RECEIVE_CREDENTIAL", message);

function nonzeroField(value, label) {
  const result = field(value, label);
  invalid(result !== 0n, `${label} must be nonzero`);
  return result;
}

function purposeOf(value = "receive") {
  invalid(value === "receive" || value === "fund", "Unsupported credential purpose");
  return value;
}

function fixed(value, width) {
  let remaining = BigInt(value);
  const bytes = new Uint8Array(width);
  for (let index = width - 1; index >= 0; index--) {
    bytes[index] = Number(remaining & 255n);
    remaining >>= 8n;
  }
  invalid(remaining === 0n, "Credential integer exceeds its encoding");
  return bytes;
}

/** Ordinary receive addresses carry two uint64 values and 128 fresh random bits. */
export function createShieldedReceiveDiversifier(authorizationCounter, expiresAt, randomness16) {
  const counter = bigintFrom(authorizationCounter, "authorizationCounter", MAX_UINT64);
  const expiry = bigintFrom(expiresAt, "expiresAt", MAX_UINT64);
  invalid(expiry > 0n, "expiresAt must be nonzero");
  const diversifier = new Uint8Array(32);
  diversifier.set(fixed(counter, 8));
  diversifier.set(fixed(expiry, 8), 8);
  if (randomness16 === undefined) {
    protocolAssert(
      typeof globalThis.crypto?.getRandomValues === "function",
      "SECURE_RANDOM_UNAVAILABLE",
      "A cryptographic random source is required",
    );
    globalThis.crypto.getRandomValues(diversifier.subarray(16));
  } else {
    const random = copyBytes(randomness16, "receive diversifier randomness");
    invalid(random.length === 16, "Receive diversifier randomness must be 16 bytes");
    diversifier.set(random, 16);
  }
  return diversifier;
}

/** Read transport metadata only; the address point and issuer proof are not verified here. */
export function readShieldedReceiveAddressMetadata(viewingKey) {
  const address = getBytes(viewingKey);
  invalid(
    address.length === SHIELDED_RECEIVE_PUBLIC_KEY_BYTES,
    "A diversified receive address is required",
  );
  return {
    authorizationCounter: BigInt(bytesToHex(address.subarray(0, 8))),
    expiresAt: BigInt(bytesToHex(address.subarray(8, 16))),
  };
}

/** Canonical across key modes and purposes; never enters spending or HPKE derivation. */
export function computeShieldedAuthorizationAlias(input) {
  return poseidon3([
    SHIELDED_AUTHORIZATION_ALIAS_DOMAIN,
    nonzeroField(input.identityCommitment, "identityCommitment"),
    nonzeroField(input.derivedSecretField, "derivedSecretField"),
  ]);
}

/** Exact issuer statement, including the circuit's first output R. */
export function buildShieldedReceiveCredentialPublicSignals(input) {
  const purpose = purposeOf(input.purpose);
  const alias = nonzeroField(input.authorizationAlias, "authorizationAlias");
  const counter = bigintFrom(input.authorizationCounter, "authorizationCounter", MAX_UINT64);
  const expiry = bigintFrom(input.expiresAt, "expiresAt", MAX_UINT64);
  invalid(expiry > 0n, "expiresAt must be nonzero");
  const owner = nonzeroField(input.ownerCommitment, "ownerCommitment");
  const viewingKey = getBytes(input.viewingKey);
  invalid(
    viewingKey.length === (purpose === "receive" ? SHIELDED_RECEIVE_PUBLIC_KEY_BYTES : 32),
    "Viewing key does not match the credential purpose",
  );
  const { viewKeyLo, viewKeyHi } = splitShieldedViewPublicKey(viewingKey);
  invalid(viewKeyLo !== 0n || viewKeyHi !== 0n, "Viewing key must be nonzero");
  if (purpose === "receive") {
    const metadata = readShieldedReceiveAddressMetadata(viewingKey);
    invalid(
      metadata.authorizationCounter === counter && metadata.expiresAt === expiry,
      "Receive authorization counter and expiry must match its address",
    );
    deriveShieldedReceiveOwnerNonce(viewingKey);
  }
  const mode = bigintFrom(input.keyMode ?? 0, "keyMode", 1n);
  const version = bigintFrom(
    input.receiveCodeVersion ?? SHIELDED_RECEIVE_CREDENTIAL_VERSION,
    "receiveCodeVersion",
    255n,
  );
  invalid(
    version === BigInt(SHIELDED_RECEIVE_CREDENTIAL_VERSION),
    "Unsupported credential version",
  );
  const identity =
    purpose === "fund" ? [nonzeroField(input.identityCommitment, "identityCommitment")] : [];
  invalid(
    purpose === "fund" || input.identityCommitment === undefined,
    "Receive credentials must not include an identity commitment",
  );
  return [alias, counter, expiry, ...identity, owner, viewKeyLo, viewKeyHi, mode, version];
}

export function computeShieldedReceiveCredentialFingerprint(input) {
  const purpose = purposeOf(input.purpose);
  return sha256(
    concat([
      toUtf8Bytes(
        `DeepFamily:ReceiveCredential:${purpose}:v${SHIELDED_RECEIVE_CREDENTIAL_VERSION}`,
      ),
      ...buildShieldedReceiveCredentialPublicSignals(input).map((value) => fixed(value, 32)),
    ]),
  );
}

/** The two purposes use distinct prefixes and distinct issuer verification keys. */
export function encodeShieldedReceiveCredential(input) {
  const purpose = purposeOf(input.purpose);
  const signals = buildShieldedReceiveCredentialPublicSignals(input);
  const offset = purpose === "fund" ? 1 : 0;
  const payload = getBytes(
    concat([
      Uint8Array.of((SHIELDED_RECEIVE_CREDENTIAL_VERSION << 1) | Number(signals[6 + offset])),
      fixed(signals[0], 32),
      ...(purpose === "fund" ? [fixed(signals[1], 8), fixed(signals[2], 8)] : []),
      ...(offset ? [fixed(signals[3], 32)] : []),
      fixed(signals[3 + offset], 32),
      getBytes(input.viewingKey),
      ...receiveProofWords(input.proof).map((value) => fixed(value, 32)),
    ]),
  );
  return bech32m.encode(PREFIX[purpose], bech32m.toWords(payload), false);
}

/** Parse and range-check only. The fixed issuer key must still verify the proof. */
export function decodeShieldedReceiveCredential(code) {
  let bytes, purpose;
  try {
    const decoded = bech32m.decode(code.replace(/\s+/gu, ""), false);
    purpose = Object.keys(PREFIX).find((key) => PREFIX[key] === decoded.prefix);
    bytes = bech32m.fromWords(decoded.words);
    const version = bytes[0] >> 1;
    if (
      !purpose ||
      version !== SHIELDED_RECEIVE_CREDENTIAL_VERSION ||
      bytes.length !== (purpose === "receive" ? 385 : 401)
    )
      throw new Error();
  } catch {
    protocolAssert(
      false,
      "INVALID_SHIELDED_RECEIVE_CREDENTIAL_ENCODING",
      "Credential is incomplete or mistyped",
    );
  }
  let offset = 1;
  const read = (width) => {
    const value = BigInt(bytesToHex(bytes.subarray(offset, offset + width)));
    offset += width;
    return value;
  };
  const viewingKeyBytes = purpose === "receive" ? SHIELDED_RECEIVE_PUBLIC_KEY_BYTES : 32;
  const authorizationAlias = read(32);
  const fundMetadata = purpose === "fund"
    ? { authorizationCounter: read(8), expiresAt: read(8), identityCommitment: read(32) }
    : undefined;
  const ownerCommitment = read(32);
  const viewingKey = bytes.slice(offset, offset + viewingKeyBytes);
  const statement = {
    purpose,
    authorizationAlias,
    ...(fundMetadata ?? readShieldedReceiveAddressMetadata(viewingKey)),
    ownerCommitment,
    viewingKey,
    keyMode: bytes[0] & 1,
    receiveCodeVersion: SHIELDED_RECEIVE_CREDENTIAL_VERSION,
  };
  offset += viewingKeyBytes;
  const proof = receiveProofFromWords(Array.from({ length: 8 }, () => read(32)));
  receiveProofWords(proof);
  const publicSignals = buildShieldedReceiveCredentialPublicSignals(statement);
  return {
    ...statement,
    proof,
    publicSignals,
    fingerprint: computeShieldedReceiveCredentialFingerprint(statement),
  };
}

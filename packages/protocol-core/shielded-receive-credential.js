import { bech32m } from "@scure/base";
import { concat, getBytes, sha256, toUtf8Bytes } from "ethers";
import { poseidon3 } from "poseidon-lite";
import { bigintFrom, bytesToHex } from "./bytes.js";
import { MAX_UINT64, SNARK_SCALAR_FIELD } from "./constants.js";
import { protocolAssert } from "./errors.js";
import { splitShieldedViewPublicKey } from "./shielded-hpke.js";
import { receiveProofFromWords, receiveProofWords } from "./shielded-receive-proof-codec.js";

export const SHIELDED_RECEIVE_CREDENTIAL_VERSION = 2;
export const SHIELDED_AUTHORIZATION_ALIAS_DOMAIN = 202610210001n;
export const SHIELDED_RECEIVE_CREDENTIAL_PUBLIC_SIGNAL_COUNTS = Object.freeze({
  anonymous: 11,
  fund: 12,
});
const PREFIX = Object.freeze({ anonymous: "dfrecv", fund: "dffund" });
const MAX_FIELD = SNARK_SCALAR_FIELD - 1n;
const field = (value, label) => bigintFrom(value, label, MAX_FIELD);
const invalid = (condition, message) =>
  protocolAssert(condition, "INVALID_SHIELDED_RECEIVE_CREDENTIAL", message);

function nonzeroField(value, label) {
  const result = field(value, label);
  invalid(result !== 0n, `${label} must be nonzero`);
  return result;
}

function disclosureOf(value = "anonymous") {
  invalid(value === "anonymous" || value === "fund", "Unsupported credential disclosure");
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

/** Canonical across key modes and disclosures; never enters spending or HPKE derivation. */
export function computeShieldedAuthorizationAlias(input) {
  return poseidon3([
    SHIELDED_AUTHORIZATION_ALIAS_DOMAIN,
    nonzeroField(input.identityCommitment, "identityCommitment"),
    nonzeroField(input.derivedSecretField, "derivedSecretField"),
  ]);
}

/** Exact issuer statement, including the circuit's first output R. */
export function buildShieldedReceiveCredentialPublicSignals(input) {
  const disclosure = disclosureOf(input.disclosure);
  const alias = nonzeroField(input.authorizationAlias, "authorizationAlias");
  const counter = bigintFrom(input.authorizationCounter, "authorizationCounter", MAX_UINT64);
  const expiry = bigintFrom(input.expiresAt, "expiresAt", MAX_UINT64);
  invalid(expiry > 0n, "expiresAt must be nonzero");
  const owner = nonzeroField(input.ownerCommitment, "ownerCommitment");
  const { viewKeyLo, viewKeyHi } = splitShieldedViewPublicKey(input.viewingKey);
  invalid(viewKeyLo !== 0n || viewKeyHi !== 0n, "Viewing key must be nonzero");
  const mode = bigintFrom(input.keyMode ?? 0, "keyMode", 1n);
  const metadata = [
    input.identitySuiteId ?? 1,
    input.independentKeySuiteId ?? 1,
    input.independentKeyDerivationVersion ?? 1,
    input.receiveCodeVersion ?? 2,
  ].map((value, index) => bigintFrom(value, `credentialMetadata[${index}]`, 255n));
  invalid(
    metadata.every((value, index) => value === (index === 3 ? 2n : 1n)),
    "Unsupported credential suite",
  );
  const identity =
    disclosure === "fund" ? [nonzeroField(input.identityCommitment, "identityCommitment")] : [];
  invalid(
    disclosure === "fund" || input.identityCommitment === undefined,
    "Anonymous credentials must not include an identity commitment",
  );
  return [alias, counter, expiry, ...identity, owner, viewKeyLo, viewKeyHi, mode, ...metadata];
}

export function computeShieldedReceiveCredentialFingerprint(input) {
  const disclosure = disclosureOf(input.disclosure);
  return sha256(
    concat([
      toUtf8Bytes(`DeepFamily:ReceiveCredential:${disclosure}:v2`),
      ...buildShieldedReceiveCredentialPublicSignals(input).map((value) => fixed(value, 32)),
    ]),
  );
}

/** The two disclosures use distinct prefixes and distinct issuer verification keys. */
export function encodeShieldedReceiveCredential(input) {
  const disclosure = disclosureOf(input.disclosure);
  const signals = buildShieldedReceiveCredentialPublicSignals(input);
  const offset = disclosure === "fund" ? 1 : 0;
  const payload = getBytes(
    concat([
      Uint8Array.of(2, Number(signals[6 + offset]), 1, 1, 1),
      fixed(signals[0], 32),
      fixed(signals[1], 8),
      fixed(signals[2], 8),
      ...(offset ? [fixed(signals[3], 32)] : []),
      fixed(signals[3 + offset], 32),
      getBytes(input.viewingKey),
      ...receiveProofWords(input.proof).map((value) => fixed(value, 32)),
    ]),
  );
  return bech32m.encode(PREFIX[disclosure], bech32m.toWords(payload), false);
}

/** Parse and range-check only. The fixed issuer key must still verify the proof. */
export function decodeShieldedReceiveCredential(code) {
  let bytes, disclosure;
  try {
    const decoded = bech32m.decode(code.replace(/\s+/gu, ""), false);
    disclosure = Object.keys(PREFIX).find((key) => PREFIX[key] === decoded.prefix);
    bytes = bech32m.fromWords(decoded.words);
    if (!disclosure || bytes[0] !== 2 || bytes.length !== (disclosure === "fund" ? 405 : 373))
      throw new Error();
  } catch {
    protocolAssert(
      false,
      "INVALID_SHIELDED_RECEIVE_CREDENTIAL_ENCODING",
      "Credential is incomplete or mistyped",
    );
  }
  let offset = 5;
  const read = (width) => {
    const value = BigInt(bytesToHex(bytes.subarray(offset, offset + width)));
    offset += width;
    return value;
  };
  const statement = {
    disclosure,
    authorizationAlias: read(32),
    authorizationCounter: read(8),
    expiresAt: read(8),
    ...(disclosure === "fund" ? { identityCommitment: read(32) } : {}),
    ownerCommitment: read(32),
    viewingKey: bytes.slice(offset, offset + 32),
    keyMode: bytes[1],
    identitySuiteId: bytes[2],
    independentKeySuiteId: bytes[3],
    independentKeyDerivationVersion: bytes[4],
    receiveCodeVersion: 2,
  };
  offset += 32;
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

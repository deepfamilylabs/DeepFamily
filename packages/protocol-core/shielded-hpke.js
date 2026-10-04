import { Aes128Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { getBytes, keccak256, solidityPacked, toUtf8Bytes } from "ethers";
import {
  asUint8Array,
  bigintFrom,
  bytesToHex,
  concatBytes,
  copyBytes,
  wipeBytes,
} from "./bytes.js";
import { MAX_UINT64 } from "./constants.js";
import { ProtocolError, protocolAssert } from "./errors.js";
import { assertAddress } from "./identity.js";
import { SHIELDED_CIPHERTEXT_BYTES } from "./shielded-inheritance.js";

export const SHIELDED_HPKE_ENCAPSULATED_BYTES = 32;
export const SHIELDED_HPKE_PLAINTEXT_BYTES = 464;
export const SHIELDED_HPKE_MAX_PAYLOAD_BYTES = SHIELDED_HPKE_PLAINTEXT_BYTES - 3;
export const SHIELDED_HPKE_ENVELOPE_VERSION = 2;

const AAD_DOMAIN = keccak256(toUtf8Bytes("DeepFamily:ShieldedNoteHPKE:v2"));
const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes128Gcm(),
});

function bytes32(value, label) {
  const result = copyBytes(value, label);
  protocolAssert(result.length === 32, "INVALID_SHIELDED_KEY_LENGTH", `${label} must be 32 bytes`);
  return result;
}

/** Split the X25519 public key as big-endian high and low uint128 limbs. */
export function splitShieldedViewPublicKey(publicKey) {
  const bytes = bytes32(publicKey, "viewPublicKey");
  return {
    viewKeyHi: BigInt(bytesToHex(bytes.subarray(0, 16))),
    viewKeyLo: BigInt(bytesToHex(bytes.subarray(16, 32))),
  };
}

/**
 * RFC 9180 DeriveKeyPair with high-entropy IKM derived from the existing
 * identity secret. The receive code includes its public key without sharing IKM.
 */
export async function deriveShieldedViewPublicKey(hpkeIkm) {
  const ikm = bytes32(hpkeIkm, "hpkeIkm");
  try {
    const pair = await suite.kem.deriveKeyPair(ikm);
    return new Uint8Array(await suite.kem.serializePublicKey(pair.publicKey));
  } finally {
    wipeBytes(ikm);
  }
}

/** AAD binds each encrypted note to this chain and pool deployment. */
export function buildShieldedHpkeAad(input) {
  const chainId = bigintFrom(input.chainId, "chainId", MAX_UINT64);
  protocolAssert(chainId > 0n, "INVALID_CHAIN_ID", "chainId must be nonzero");
  const poolAddress = assertAddress(input.poolAddress, "poolAddress");
  protocolAssert(BigInt(poolAddress) !== 0n, "INVALID_POOL_ADDRESS", "poolAddress must be nonzero");
  return getBytes(
    solidityPacked(["bytes32", "uint64", "address"], [AAD_DOMAIN, chainId, poolAddress]),
  );
}

/**
 * Encrypt opaque note bytes into exactly 512 bytes: 32-byte enc + 464-byte
 * padded plaintext + 16-byte AEAD tag. The caller must publish these exact
 * bytes and bind their keccak field hash into the output note commitment.
 */
export async function encryptShieldedNote(input) {
  const publicKey = bytes32(input.recipientPublicKey, "recipientPublicKey");
  const payload = asUint8Array(input.payload, "payload");
  protocolAssert(
    payload.length <= SHIELDED_HPKE_MAX_PAYLOAD_BYTES,
    "SHIELDED_PAYLOAD_TOO_LARGE",
    `payload must be at most ${SHIELDED_HPKE_MAX_PAYLOAD_BYTES} bytes`,
  );
  const aad = buildShieldedHpkeAad(input);
  const plaintext = new Uint8Array(SHIELDED_HPKE_PLAINTEXT_BYTES);
  try {
    protocolAssert(
      typeof globalThis.crypto?.getRandomValues === "function",
      "SECURE_RANDOM_UNAVAILABLE",
      "A cryptographic random source is required",
    );
    globalThis.crypto.getRandomValues(plaintext);
    plaintext[0] = SHIELDED_HPKE_ENVELOPE_VERSION;
    plaintext[1] = payload.length >>> 8;
    plaintext[2] = payload.length & 255;
    plaintext.set(payload, 3);
    const recipientPublicKey = await suite.kem.deserializePublicKey(publicKey);
    const sender = await suite.createSenderContext({ recipientPublicKey });
    const body = new Uint8Array(await sender.seal(plaintext, aad));
    const result = concatBytes(new Uint8Array(sender.enc), body);
    protocolAssert(
      result.length === SHIELDED_CIPHERTEXT_BYTES,
      "INVALID_SHIELDED_CIPHERTEXT_LENGTH",
      "HPKE produced an unexpected ciphertext length",
    );
    return result;
  } finally {
    wipeBytes(plaintext);
  }
}

/** Decrypt and authenticate a note; failures reveal no payload data. */
export async function decryptShieldedNote(input) {
  const ciphertext = asUint8Array(input.ciphertext, "ciphertext");
  protocolAssert(
    ciphertext.length === SHIELDED_CIPHERTEXT_BYTES,
    "INVALID_SHIELDED_CIPHERTEXT_LENGTH",
    `ciphertext must be exactly ${SHIELDED_CIPHERTEXT_BYTES} bytes`,
  );
  const aad = buildShieldedHpkeAad(input);
  const ikm = bytes32(input.hpkeIkm, "hpkeIkm");
  let plaintext;
  try {
    const pair = await suite.kem.deriveKeyPair(ikm);
    const recipient = await suite.createRecipientContext({
      recipientKey: pair.privateKey,
      enc: ciphertext.subarray(0, SHIELDED_HPKE_ENCAPSULATED_BYTES),
    });
    plaintext = new Uint8Array(
      await recipient.open(ciphertext.subarray(SHIELDED_HPKE_ENCAPSULATED_BYTES), aad),
    );
    protocolAssert(
      plaintext.length === SHIELDED_HPKE_PLAINTEXT_BYTES &&
        plaintext[0] === SHIELDED_HPKE_ENVELOPE_VERSION,
      "INVALID_SHIELDED_ENVELOPE",
      "Decrypted note has an invalid envelope",
    );
    const length = (plaintext[1] << 8) | plaintext[2];
    protocolAssert(
      length <= SHIELDED_HPKE_MAX_PAYLOAD_BYTES,
      "INVALID_SHIELDED_ENVELOPE",
      "Decrypted note has an invalid payload length",
    );
    return plaintext.slice(3, 3 + length);
  } catch (error) {
    throw new ProtocolError("SHIELDED_DECRYPTION_FAILED", "Could not decrypt shielded note", {
      cause: error,
    });
  } finally {
    wipeBytes(ikm);
    wipeBytes(plaintext);
  }
}

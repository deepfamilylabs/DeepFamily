import { Aes128Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { getBytes, keccak256, sha256, solidityPacked, toUtf8Bytes } from "ethers";
import {
  asUint8Array,
  bigintFrom,
  bytesToHex,
  concatBytes,
  copyBytes,
  wipeBytes,
} from "./bytes.js";
import { MAX_UINT64, SNARK_SCALAR_FIELD } from "./constants.js";
import { ProtocolError, protocolAssert } from "./errors.js";
import { assertAddress } from "./identity.js";
import { SHIELDED_CIPHERTEXT_BYTES } from "./shielded-inheritance.js";
import {
  assertShieldedReceivePublicKey,
  encryptShieldedReceivePayload,
  decryptShieldedReceivePayload,
  SHIELDED_RECEIVE_PUBLIC_KEY_BYTES,
  SHIELDED_RECEIVE_METADATA_BYTES,
} from "./shielded-receive-encryption.js";
export {
  initializeShieldedReceiveEncryption,
  deriveShieldedReceivePublicKey,
  assertShieldedReceivePublicKey,
  SHIELDED_RECEIVE_PUBLIC_KEY_BYTES,
} from "./shielded-receive-encryption.js";

export const SHIELDED_HPKE_ENCAPSULATED_BYTES = 32;
export const SHIELDED_HPKE_PLAINTEXT_BYTES = 464;
export const SHIELDED_HPKE_MAX_PAYLOAD_BYTES = SHIELDED_HPKE_PLAINTEXT_BYTES - 3;
export const SHIELDED_RECEIVE_MAX_PAYLOAD_BYTES =
  SHIELDED_HPKE_MAX_PAYLOAD_BYTES - SHIELDED_RECEIVE_METADATA_BYTES;
export const SHIELDED_HPKE_ENVELOPE_VERSION = 1;

const AAD_DOMAIN = keccak256(
  toUtf8Bytes(`DeepFamily:ShieldedNoteHPKE:v${SHIELDED_HPKE_ENVELOPE_VERSION}`),
);
const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes128Gcm(),
});

function bytes32(value, label) {
  let result;
  try {
    result = copyBytes(value, label);
  } catch (error) {
    throw new ProtocolError(
      error instanceof ProtocolError ? error.code : "INVALID_BYTES",
      `${label} must be bytes or 0x-prefixed hex`,
    );
  }
  if (result.length !== 32) {
    wipeBytes(result);
    throw new ProtocolError("INVALID_SHIELDED_KEY_LENGTH", `${label} must be 32 bytes`);
  }
  return result;
}

/** Bind an entire diversified address, or the fixed budget HPKE key, to two uint128 limbs. */
export function splitShieldedViewPublicKey(publicKey) {
  let bytes = copyBytes(publicKey, "viewPublicKey");
  if (bytes.length === SHIELDED_RECEIVE_PUBLIC_KEY_BYTES) {
    const address = assertShieldedReceivePublicKey(bytes);
    bytes = getBytes(
      sha256(concatBytes(toUtf8Bytes("DeepFamily:ReceivePublicKeyCommitment:v1"), address)),
    );
  } else {
    protocolAssert(
      bytes.length === 32,
      "INVALID_SHIELDED_KEY_LENGTH",
      "Viewing key must be a budget key or diversified receive address",
    );
  }
  return {
    viewKeyHi: BigInt(bytesToHex(bytes.subarray(0, 16))),
    viewKeyLo: BigInt(bytesToHex(bytes.subarray(16, 32))),
  };
}

/** The complete receive address already authenticates this recoverable VALUE ownership nonce. */
export function deriveShieldedReceiveOwnerNonce(publicKey) {
  protocolAssert(
    getBytes(publicKey).length === SHIELDED_RECEIVE_PUBLIC_KEY_BYTES,
    "INVALID_SHIELDED_RECEIVE_PUBLIC_KEY",
    "A diversified receive address is required",
  );
  const { viewKeyLo, viewKeyHi } = splitShieldedViewPublicKey(publicKey);
  const nonce = (viewKeyLo + (viewKeyHi << 128n)) % SNARK_SCALAR_FIELD;
  protocolAssert(
    nonce !== 0n,
    "INVALID_SHIELDED_RECEIVE_OWNER_NONCE",
    "Receive ownership nonce must be nonzero",
  );
  return nonce;
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
  const publicKey = copyBytes(input.recipientPublicKey, "recipientPublicKey");
  const diversified = publicKey.length === SHIELDED_RECEIVE_PUBLIC_KEY_BYTES;
  protocolAssert(
    diversified || publicKey.length === 32,
    "INVALID_SHIELDED_KEY_LENGTH",
    "Invalid note recipient key length",
  );
  const payload = asUint8Array(input.payload, "payload");
  protocolAssert(
    payload.length <=
      (diversified ? SHIELDED_RECEIVE_MAX_PAYLOAD_BYTES : SHIELDED_HPKE_MAX_PAYLOAD_BYTES),
    "SHIELDED_PAYLOAD_TOO_LARGE",
    "Payload exceeds the recipient encryption envelope capacity",
  );
  const aad = buildShieldedHpkeAad(input);
  const plaintext = new Uint8Array(
    SHIELDED_HPKE_PLAINTEXT_BYTES - (diversified ? SHIELDED_RECEIVE_METADATA_BYTES : 0),
  );
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
    if (diversified) {
      return await encryptShieldedReceivePayload({
        recipientPublicKey: publicKey,
        plaintext,
        aad,
        info: toUtf8Bytes("DeepFamily:ReceiveNote:v1"),
      });
    }
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
  const ciphertext = copyBytes(input.ciphertext, "ciphertext");
  protocolAssert(
    ciphertext.length === SHIELDED_CIPHERTEXT_BYTES,
    "INVALID_SHIELDED_CIPHERTEXT_LENGTH",
    `ciphertext must be exactly ${SHIELDED_CIPHERTEXT_BYTES} bytes`,
  );
  const aad = buildShieldedHpkeAad(input);
  const ikm = bytes32(input.hpkeIkm, "hpkeIkm");
  let plaintext;
  try {
    // Both are current formats: fixed HPKE for budgets/self notes, diversified DH for receive-code transfers.
    try {
      const pair = await suite.kem.deriveKeyPair(ikm);
      const recipient = await suite.createRecipientContext({
        recipientKey: pair.privateKey,
        enc: ciphertext.subarray(0, SHIELDED_HPKE_ENCAPSULATED_BYTES),
      });
      plaintext = new Uint8Array(
        await recipient.open(ciphertext.subarray(SHIELDED_HPKE_ENCAPSULATED_BYTES), aad),
      );
    } catch {
      ({ plaintext } = await decryptShieldedReceivePayload({
        viewIkm: ikm,
        ciphertext,
        aad,
        info: toUtf8Bytes("DeepFamily:ReceiveNote:v1"),
      }));
    }
    protocolAssert(
      (plaintext.length === SHIELDED_HPKE_PLAINTEXT_BYTES ||
        plaintext.length === SHIELDED_HPKE_PLAINTEXT_BYTES - SHIELDED_RECEIVE_METADATA_BYTES) &&
        plaintext[0] === SHIELDED_HPKE_ENVELOPE_VERSION,
      "INVALID_SHIELDED_ENVELOPE",
      "Decrypted note has an invalid envelope",
    );
    const length = (plaintext[1] << 8) | plaintext[2];
    protocolAssert(
      length <= plaintext.length - 3,
      "INVALID_SHIELDED_ENVELOPE",
      "Decrypted note has an invalid payload length",
    );
    return plaintext.slice(3, 3 + length);
  } catch (error) {
    if (error instanceof ProtocolError && error.code === "SHIELDED_RECEIVE_WASM_UNAVAILABLE")
      throw error;
    throw new ProtocolError("SHIELDED_DECRYPTION_FAILED", "Could not decrypt shielded note");
  } finally {
    wipeBytes(ikm);
    wipeBytes(plaintext);
    wipeBytes(ciphertext);
  }
}

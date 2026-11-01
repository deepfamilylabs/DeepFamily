import { getBytes, keccak256, solidityPacked, toUtf8Bytes } from "ethers";
import {
  asUint8Array,
  bigintFrom,
  bytesToHex,
  concatBytes,
  copyBytes,
  equalBytesConstantTime,
  readUint32BE,
  utf8Bytes,
  wipeBytes,
  writeUint32BE,
} from "./bytes.js";
import { MAX_UINT64, SNARK_SCALAR_FIELD } from "./constants.js";
import { ProtocolError, protocolAssert } from "./errors.js";
import { assertAddress } from "./identity.js";
import { generateShieldedRandomField } from "./shielded-inheritance.js";
import {
  assertShieldedReceivePublicKey,
  encryptShieldedReceivePayload,
  decryptShieldedReceivePayload,
  SHIELDED_RECEIVE_METADATA_BYTES,
} from "./shielded-receive-encryption.js";
import { computeShieldedReceiveRecipientBinding } from "./shielded-receive-presentation.js";

export const SHIELDED_LETTER_ENVELOPE_VERSION = 1;
export const SHIELDED_LETTER_HPKE_ENCAPSULATED_BYTES = 32;

const MAX_FIELD = SNARK_SCALAR_FIELD - 1n;
const ENVELOPE_MAGIC = Uint8Array.of(0x44, 0x46, 0x4c, 0x45); // DFLE
const CIPHERTEXT_PREFIX = Uint8Array.of(0x44, 0x46, 0x4c, 0x43, 1); // DFLC, version 1
const ENVELOPE_HEADER_BYTES = 80;
const AEAD_TAG_BYTES = 16;
const ENCAPSULATED_OFFSET = CIPHERTEXT_PREFIX.length;
const SEALED_OFFSET = ENCAPSULATED_OFFSET + SHIELDED_LETTER_HPKE_ENCAPSULATED_BYTES;
const AAD_DOMAIN = keccak256(toUtf8Bytes("DeepFamily:PrivateLetterHPKE:v1"));
const HPKE_INFO = toUtf8Bytes("DeepFamily:PrivateLetterHPKE:v1");

function field(value, label, nonzero = false) {
  const result = bigintFrom(value, label, MAX_FIELD);
  protocolAssert(
    !nonzero || result > 0n,
    "INVALID_SHIELDED_LETTER_FIELD",
    `${label} must be nonzero`,
  );
  return result;
}

function nonzeroAddress(value, label) {
  const address = assertAddress(value, label);
  protocolAssert(
    BigInt(address) > 0n,
    "INVALID_SHIELDED_LETTER_ADDRESS",
    `${label} must be nonzero`,
  );
  return address;
}

function chainId(value) {
  const result = bigintFrom(value, "chainId", MAX_UINT64);
  protocolAssert(result > 0n, "INVALID_CHAIN_ID", "chainId must be nonzero");
  return result;
}

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

function writeUint64BE(bytes, offset, value) {
  const parsed = bigintFrom(value, "uint64", MAX_UINT64);
  writeUint32BE(bytes, offset, parsed >> 32n);
  writeUint32BE(bytes, offset + 4, parsed & 0xffff_ffffn);
}

function readUint64BE(bytes, offset) {
  return (BigInt(readUint32BE(bytes, offset)) << 32n) | BigInt(readUint32BE(bytes, offset + 4));
}

function decodeBody(bytes) {
  try {
    // This is text inside a binary envelope, so U+FEFF is a body character.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new ProtocolError("INVALID_UTF8", "Letter body is not valid UTF-8");
  }
}

function writeField(bytes, offset, value) {
  let remaining = value;
  for (let index = offset + 31; index >= offset; index -= 1) {
    bytes[index] = Number(remaining & 255n);
    remaining >>= 8n;
  }
}

function normalizeEnvelope(input, generateSalt = false) {
  protocolAssert(
    input !== null && typeof input === "object" && !Array.isArray(input),
    "INVALID_SHIELDED_LETTER_ENVELOPE",
    "A letter envelope is required",
  );
  protocolAssert(
    input.version === undefined || input.version === SHIELDED_LETTER_ENVELOPE_VERSION,
    "UNSUPPORTED_SHIELDED_LETTER_VERSION",
    "Unsupported letter envelope version",
  );
  let body;
  try {
    body = utf8Bytes(input.body);
    protocolAssert(
      body.length > 0,
      "EMPTY_SHIELDED_LETTER_BODY",
      "Letter body must be nonempty plain text",
    );
  } finally {
    wipeBytes(body);
  }
  return {
    version: SHIELDED_LETTER_ENVELOPE_VERSION,
    body: input.body,
    salt:
      generateSalt && input.salt === undefined
        ? generateShieldedRandomField()
        : field(input.salt, "salt", true),
    authorizationAlias: field(input.authorizationAlias, "authorizationAlias", true),
  };
}

/** Letter deployments have their own scope; they never use a personHash or Story key. */
export function normalizeShieldedLetterScope(input) {
  protocolAssert(
    input !== null && typeof input === "object",
    "MISSING_SHIELDED_LETTER_SCOPE",
    "A chain and letter contract context is required",
  );
  return {
    chainId: chainId(input.chainId),
    lettersAddress: nonzeroAddress(input.lettersAddress, "lettersAddress"),
  };
}

/**
 * Prepare once before encryption. Salt is the existing message/proof salt, kept
 * inside the encrypted envelope; it is not an additional recovery secret.
 */
export function createShieldedLetterEnvelope(input) {
  return normalizeEnvelope(input, true);
}

/**
 * Canonical binary envelope: DFLE, version, three zero reserved bytes, 32-byte
 * salt, 32-byte authorization alias, uint64 UTF-8 length, then the exact UTF-8 body. No application-level
 * text size cap.
 */
export function encodeShieldedLetterEnvelope(input) {
  const envelope = normalizeEnvelope(input);
  const body = utf8Bytes(envelope.body);
  try {
    const bytes = new Uint8Array(ENVELOPE_HEADER_BYTES + body.length);
    bytes.set(ENVELOPE_MAGIC);
    bytes[4] = SHIELDED_LETTER_ENVELOPE_VERSION;
    writeField(bytes, 8, envelope.salt);
    writeField(bytes, 40, envelope.authorizationAlias);
    writeUint64BE(bytes, 72, BigInt(body.length));
    bytes.set(body, ENVELOPE_HEADER_BYTES);
    return bytes;
  } finally {
    wipeBytes(body);
  }
}

/** Reject noncanonical lengths, reserved bytes and UTF-8. */
export function decodeShieldedLetterEnvelope(value) {
  const bytes = asUint8Array(value, "letter envelope");
  protocolAssert(
    bytes.length >= ENVELOPE_HEADER_BYTES &&
      equalBytesConstantTime(bytes.subarray(0, 4), ENVELOPE_MAGIC),
    "INVALID_SHIELDED_LETTER_ENVELOPE",
    "Letter envelope is incomplete or has invalid magic",
  );
  protocolAssert(
    bytes[4] === SHIELDED_LETTER_ENVELOPE_VERSION,
    "UNSUPPORTED_SHIELDED_LETTER_VERSION",
    "Unsupported letter envelope version",
  );
  protocolAssert(
    bytes[5] === 0 && bytes[6] === 0 && bytes[7] === 0,
    "INVALID_SHIELDED_LETTER_ENVELOPE",
    "Letter envelope has invalid reserved bytes",
  );
  protocolAssert(
    readUint64BE(bytes, 72) === BigInt(bytes.length - ENVELOPE_HEADER_BYTES),
    "INVALID_SHIELDED_LETTER_ENVELOPE",
    "Letter envelope has an invalid body length",
  );
  return normalizeEnvelope({
    version: bytes[4],
    salt: BigInt(bytesToHex(bytes.subarray(8, 40))),
    authorizationAlias: BigInt(bytesToHex(bytes.subarray(40, 72))),
    body: decodeBody(bytes.subarray(ENVELOPE_HEADER_BYTES)),
  });
}

/** AAD authenticates this message number, chain and exact letter contract. */
export function buildShieldedLetterHpkeAad(input) {
  const scope = normalizeShieldedLetterScope(input);
  const messageId = field(input.messageId, "messageId", true);
  return getBytes(
    solidityPacked(
      ["bytes32", "uint64", "address", "uint256"],
      [AAD_DOMAIN, scope.chainId, scope.lettersAddress, messageId],
    ),
  );
}

function assertCiphertext(value) {
  const bytes = asUint8Array(value, "ciphertext");
  protocolAssert(
    bytes.length >=
      SEALED_OFFSET +
        SHIELDED_RECEIVE_METADATA_BYTES +
        ENVELOPE_HEADER_BYTES +
        1 +
        AEAD_TAG_BYTES &&
      equalBytesConstantTime(bytes.subarray(0, CIPHERTEXT_PREFIX.length), CIPHERTEXT_PREFIX),
    "INVALID_SHIELDED_LETTER_CIPHERTEXT",
    "Letter ciphertext is incomplete or has an unsupported format",
  );
  return bytes;
}

/** Hash the exact variable-length bytes archived by the verified letter contract. */
export function computeShieldedLetterCiphertextHash(ciphertext) {
  return keccak256(assertCiphertext(ciphertext));
}

export function computeShieldedLetterCiphertextHashField(ciphertext) {
  return BigInt(computeShieldedLetterCiphertextHash(ciphertext)) % SNARK_SCALAR_FIELD;
}

/** Preserve all 256 hash bits for the delivery proof's public uint128 limbs. */
export function splitShieldedLetterCiphertextHash(ciphertext) {
  const hash = BigInt(computeShieldedLetterCiphertextHash(ciphertext));
  return { cipherLo: hash & ((1n << 128n) - 1n), cipherHi: hash >> 128n };
}

/**
 * Encrypt the prepared envelope with the existing receiving HPKE key. Unlike
 * fixed-size money notes, letters use a single variable-length HPKE message;
 * Archive segmentation is applied to the resulting authenticated bytes.
 */
export async function encryptShieldedLetter(input) {
  normalizeShieldedLetterScope(input);
  const envelope = normalizeEnvelope(input.envelope);
  const aad = buildShieldedLetterHpkeAad(input);
  const publicKey = assertShieldedReceivePublicKey(input.recipientPublicKey);
  const plaintext = encodeShieldedLetterEnvelope(envelope);
  try {
    const body = await encryptShieldedReceivePayload({
      recipientPublicKey: publicKey,
      plaintext,
      aad,
      info: HPKE_INFO,
    });
    protocolAssert(
      body.length ===
        SHIELDED_LETTER_HPKE_ENCAPSULATED_BYTES +
          SHIELDED_RECEIVE_METADATA_BYTES +
          plaintext.length +
          AEAD_TAG_BYTES,
      "INVALID_SHIELDED_LETTER_CIPHERTEXT",
      "HPKE produced an unexpected letter ciphertext length",
    );
    return concatBytes(CIPHERTEXT_PREFIX, body);
  } finally {
    wipeBytes(plaintext);
    wipeBytes(publicKey);
  }
}

/**
 * Decrypt using either existing key mode's hpkeIkm. Code expiry/counters
 * deliberately do not participate in historical recovery.
 */
export async function decryptShieldedLetter(input) {
  // Snapshot before the first await: hash checking and HPKE must use the same
  // bytes even if the caller reuses its archive download buffer concurrently.
  const ciphertext = copyBytes(assertCiphertext(input.ciphertext));
  const aad = buildShieldedLetterHpkeAad(input);
  if (input.expectedCiphertextHash !== undefined) {
    const expectedHash = copyBytes(input.expectedCiphertextHash, "expectedCiphertextHash");
    protocolAssert(
      expectedHash.length === 32 &&
        equalBytesConstantTime(
          expectedHash,
          getBytes(computeShieldedLetterCiphertextHash(ciphertext)),
        ),
      "SHIELDED_LETTER_CIPHERTEXT_HASH_MISMATCH",
      "Letter ciphertext does not match the verified archive hash",
    );
  }
  const ikm = bytes32(input.hpkeIkm, "hpkeIkm");
  let plaintext, recipientPublicKey;
  try {
    // Snapshot trusted expectations before asynchronous crypto. Payload aliases
    // alone are not authority: the binding must also open to the local owner,
    // key mode and public key reconstructed from this wallet's viewing seed.
    const expected =
      input.expectedRecipient === undefined
        ? undefined
        : {
            ownerCommitment: field(
              input.expectedRecipient.ownerCommitment,
              "ownerCommitment",
              true,
            ),
            keyMode: bigintFrom(input.expectedRecipient.keyMode, "keyMode", 1n),
            recipientBinding: field(
              input.expectedRecipient.recipientBinding,
              "recipientBinding",
              true,
            ),
            ...(input.expectedRecipient.authorizationAlias === undefined
              ? {}
              : {
                  authorizationAlias: field(
                    input.expectedRecipient.authorizationAlias,
                    "authorizationAlias",
                    true,
                  ),
                }),
          };
    ({ plaintext, recipientPublicKey } = await decryptShieldedReceivePayload({
      viewIkm: ikm,
      ciphertext: ciphertext.subarray(ENCAPSULATED_OFFSET),
      aad,
      info: HPKE_INFO,
    }));
    const envelope = decodeShieldedLetterEnvelope(plaintext);
    if (expected) {
      const binding = computeShieldedReceiveRecipientBinding({
        authorizationAlias: envelope.authorizationAlias,
        ownerCommitment: expected.ownerCommitment,
        keyMode: expected.keyMode,
        viewingKey: recipientPublicKey,
        salt: envelope.salt,
      });
      protocolAssert(
        binding === expected.recipientBinding &&
          (expected.authorizationAlias === undefined ||
            expected.authorizationAlias === envelope.authorizationAlias),
        "SHIELDED_LETTER_RECIPIENT_BINDING_MISMATCH",
        "Letter authorization does not match the receiving wallet",
      );
    }
    return envelope;
  } catch (error) {
    if (error instanceof ProtocolError && error.code === "SHIELDED_RECEIVE_WASM_UNAVAILABLE")
      throw error;
    // Do not propagate library or decoder details that could contain plaintext.
    throw new ProtocolError(
      "SHIELDED_LETTER_DECRYPTION_FAILED",
      "Could not decrypt private letter",
    );
  } finally {
    wipeBytes(ikm);
    wipeBytes(plaintext);
    wipeBytes(recipientPublicKey);
  }
}

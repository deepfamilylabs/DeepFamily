import { Aes128Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { getBytes, keccak256, solidityPacked, toUtf8Bytes } from "ethers";
import { poseidon3 } from "poseidon-lite";
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

export const SHIELDED_LETTER_ENVELOPE_VERSION = 1;
export const SHIELDED_LETTER_RELATION_DOMAIN = 202610210401n;
export const SHIELDED_LETTER_HPKE_ENCAPSULATED_BYTES = 32;

const MAX_FIELD = SNARK_SCALAR_FIELD - 1n;
const ENVELOPE_MAGIC = Uint8Array.of(0x44, 0x46, 0x4c, 0x45); // DFLE
const CIPHERTEXT_PREFIX = Uint8Array.of(0x44, 0x46, 0x4c, 0x43, 1); // DFLC, version 1
const ENVELOPE_HEADER_BYTES = 48;
const ATTACHMENT_BYTES = 60;
const AEAD_TAG_BYTES = 16;
const ENCAPSULATED_OFFSET = CIPHERTEXT_PREFIX.length;
const SEALED_OFFSET = ENCAPSULATED_OFFSET + SHIELDED_LETTER_HPKE_ENCAPSULATED_BYTES;
const AAD_DOMAIN = keccak256(toUtf8Bytes("DeepFamily:PrivateLetterHPKE:v1"));
const HPKE_INFO = toUtf8Bytes("DeepFamily:PrivateLetterHPKE:v1");
const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes128Gcm(),
});

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
  const result = copyBytes(value, label);
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

function normalizeAttachment(value) {
  if (value === undefined || value === null) return null;
  protocolAssert(
    typeof value === "object" && !Array.isArray(value),
    "INVALID_SHIELDED_LETTER_ATTACHMENT",
    "A structured private Fund budget reference is required",
  );
  return {
    chainId: chainId(value.chainId),
    poolAddress: nonzeroAddress(value.poolAddress, "attachment.poolAddress"),
    budgetCommitment: field(value.budgetCommitment, "attachment.budgetCommitment", true),
  };
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
    attachment: normalizeAttachment(input.attachment),
  };
}

function assertAttachmentChain(envelope, scope) {
  protocolAssert(
    envelope.attachment === null || envelope.attachment.chainId === scope.chainId,
    "SHIELDED_LETTER_ATTACHMENT_CHAIN_MISMATCH",
    "Letter attachment belongs to another chain",
  );
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
 * Canonical binary envelope: DFLE, version, attachment flag, two zero reserved
 * bytes, 32-byte salt, uint64 UTF-8 length, optional uint64 chain/address/Fr
 * Fund reference, then the exact UTF-8 body. No application-level text size cap.
 */
export function encodeShieldedLetterEnvelope(input) {
  const envelope = normalizeEnvelope(input);
  const body = utf8Bytes(envelope.body);
  try {
    const bodyOffset =
      ENVELOPE_HEADER_BYTES + (envelope.attachment === null ? 0 : ATTACHMENT_BYTES);
    const bytes = new Uint8Array(bodyOffset + body.length);
    bytes.set(ENVELOPE_MAGIC);
    bytes[4] = SHIELDED_LETTER_ENVELOPE_VERSION;
    bytes[5] = envelope.attachment === null ? 0 : 1;
    writeField(bytes, 8, envelope.salt);
    writeUint64BE(bytes, 40, BigInt(body.length));
    if (envelope.attachment !== null) {
      writeUint64BE(bytes, ENVELOPE_HEADER_BYTES, envelope.attachment.chainId);
      bytes.set(getBytes(envelope.attachment.poolAddress), ENVELOPE_HEADER_BYTES + 8);
      writeField(bytes, ENVELOPE_HEADER_BYTES + 28, envelope.attachment.budgetCommitment);
    }
    bytes.set(body, bodyOffset);
    return bytes;
  } finally {
    wipeBytes(body);
  }
}

/** Reject noncanonical flags, lengths, reserved bytes, references and UTF-8. */
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
    bytes[5] <= 1 && bytes[6] === 0 && bytes[7] === 0,
    "INVALID_SHIELDED_LETTER_ENVELOPE",
    "Letter envelope has invalid flags or reserved bytes",
  );
  const bodyOffset = ENVELOPE_HEADER_BYTES + (bytes[5] === 0 ? 0 : ATTACHMENT_BYTES);
  protocolAssert(
    bytes.length >= bodyOffset && readUint64BE(bytes, 40) === BigInt(bytes.length - bodyOffset),
    "INVALID_SHIELDED_LETTER_ENVELOPE",
    "Letter envelope has an invalid body length",
  );
  return normalizeEnvelope({
    version: bytes[4],
    salt: BigInt(bytesToHex(bytes.subarray(8, 40))),
    attachment:
      bytes[5] === 0
        ? null
        : {
            chainId: readUint64BE(bytes, ENVELOPE_HEADER_BYTES),
            poolAddress: bytesToHex(
              bytes.subarray(ENVELOPE_HEADER_BYTES + 8, ENVELOPE_HEADER_BYTES + 28),
            ),
            budgetCommitment: BigInt(
              bytesToHex(bytes.subarray(ENVELOPE_HEADER_BYTES + 28, bodyOffset)),
            ),
          },
    body: decodeBody(bytes.subarray(bodyOffset)),
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
    bytes.length >= SEALED_OFFSET + ENVELOPE_HEADER_BYTES + 1 + AEAD_TAG_BYTES &&
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
 * Research-aligned relation: H3(H3(tag,pool,FundCommitment),binding,salt).
 * The verified operation binding authenticates chain, contract, recipient,
 * ciphertext hash and message id. It must come from the verified delivery,
 * never from the decrypted sender-controlled envelope. Null means standalone.
 */
export function computeShieldedLetterRelationCommitment(input) {
  const attachment = normalizeAttachment(input.attachment);
  const salt = field(input.salt, "salt", true);
  if (attachment === null) return 0n;
  return poseidon3([
    poseidon3([
      SHIELDED_LETTER_RELATION_DOMAIN,
      BigInt(attachment.poolAddress),
      attachment.budgetCommitment,
    ]),
    field(input.binding, "binding"),
    salt,
  ]);
}

/**
 * Encrypt the prepared envelope with the existing receiving HPKE key. Unlike
 * fixed-size money notes, letters use a single variable-length HPKE message;
 * Archive segmentation is applied to the resulting authenticated bytes.
 */
export async function encryptShieldedLetter(input) {
  const scope = normalizeShieldedLetterScope(input);
  const envelope = normalizeEnvelope(input.envelope);
  assertAttachmentChain(envelope, scope);
  const aad = buildShieldedLetterHpkeAad(input);
  const publicKey = bytes32(input.recipientPublicKey, "recipientPublicKey");
  const plaintext = encodeShieldedLetterEnvelope(envelope);
  try {
    const recipientPublicKey = await suite.kem.deserializePublicKey(publicKey);
    const sender = await suite.createSenderContext({ recipientPublicKey, info: HPKE_INFO });
    const body = new Uint8Array(await sender.seal(plaintext, aad));
    protocolAssert(
      sender.enc.byteLength === SHIELDED_LETTER_HPKE_ENCAPSULATED_BYTES &&
        body.length === plaintext.length + AEAD_TAG_BYTES,
      "INVALID_SHIELDED_LETTER_CIPHERTEXT",
      "HPKE produced an unexpected letter ciphertext length",
    );
    return concatBytes(CIPHERTEXT_PREFIX, new Uint8Array(sender.enc), body);
  } finally {
    wipeBytes(plaintext);
    wipeBytes(publicKey);
  }
}

/**
 * Decrypt using the wallet hpkeIkm, then authenticate the
 * attachment against the verified contract result before returning any body.
 * Code expiry does not prevent historical recovery.
 */
export async function decryptShieldedLetter(input) {
  const scope = normalizeShieldedLetterScope(input);
  // Snapshot before the first await: hash checking and HPKE must use the same
  // bytes even if the caller reuses its archive download buffer concurrently.
  const ciphertext = copyBytes(assertCiphertext(input.ciphertext));
  const aad = buildShieldedLetterHpkeAad(input);
  const expectedRelation = field(input.relationCommitment, "relationCommitment");
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
  let plaintext;
  try {
    const pair = await suite.kem.deriveKeyPair(ikm);
    const recipient = await suite.createRecipientContext({
      recipientKey: pair.privateKey,
      enc: ciphertext.subarray(ENCAPSULATED_OFFSET, SEALED_OFFSET),
      info: HPKE_INFO,
    });
    plaintext = new Uint8Array(await recipient.open(ciphertext.subarray(SEALED_OFFSET), aad));
    const envelope = decodeShieldedLetterEnvelope(plaintext);
    assertAttachmentChain(envelope, scope);
    const relation = computeShieldedLetterRelationCommitment({
      attachment: envelope.attachment,
      salt: envelope.salt,
      binding: input.expectedBinding,
    });
    protocolAssert(
      relation === expectedRelation &&
        (envelope.attachment === null ? expectedRelation === 0n : expectedRelation !== 0n),
      "SHIELDED_LETTER_RELATION_MISMATCH",
      "Letter reference does not match its verified attachment relation",
    );
    return envelope;
  } catch (error) {
    if (
      error instanceof ProtocolError &&
      (error.code === "SHIELDED_LETTER_RELATION_MISMATCH" ||
        error.code === "SHIELDED_LETTER_ATTACHMENT_CHAIN_MISMATCH")
    ) {
      throw error;
    }
    // Do not propagate library or decoder details that could contain plaintext.
    throw new ProtocolError(
      "SHIELDED_LETTER_DECRYPTION_FAILED",
      "Could not decrypt private letter",
    );
  } finally {
    wipeBytes(ikm);
    wipeBytes(plaintext);
  }
}

import { getBytes, keccak256 } from "ethers";
import {
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BYTES,
  AES_KEY_BYTES,
  CIPHER_SUITE_AES_256_GCM,
  COMPRESSION_SUITE_GZIP_V1,
  DFM1_COMMON_PREFIX_BYTES,
  DFM1_FORMAT_1,
  DFM1_FORMAT_1_HEADER_BYTES,
  DFM1_FORMAT_1_OVERHEAD_BYTES,
  DFM1_MAGIC_BYTES,
  DFM1_MAX_CONTENT_CIPHERTEXT_BYTES,
  DFM1_MAX_ENVELOPE_BYTES,
  FILE_KDF_SUITE_ARGON2ID_CANDIDATE_1,
  FILE_SALT_BYTES,
  IDENTITY_SUITE_CANDIDATE_1,
  PLAINTEXT_CODEC_CANONICAL_JSON_V1,
} from "./constants.js";
import {
  asUint8Array,
  concatBytes,
  copyBytes,
  equalBytesConstantTime,
  readUint16BE,
  readUint32BE,
  wipeBytes,
  writeUint16BE,
  writeUint32BE,
} from "./bytes.js";
import { computeFormat1Aad } from "./aad.js";
import {
  assertFileKdfSuiteSupported,
  assertIdentitySuiteSupported,
  deriveFileKekBytes,
} from "./identity.js";
import { ProtocolError, UnsupportedProtocolError, protocolAssert } from "./errors.js";

function bytesOfLength(value, length, label) {
  const bytes = copyBytes(value, label);
  protocolAssert(
    bytes.length === length,
    "INVALID_FIELD_LENGTH",
    `${label} must be ${length} bytes`,
  );
  return bytes;
}

function format1Selectors() {
  return {
    formatVersion: DFM1_FORMAT_1,
    plaintextCodec: PLAINTEXT_CODEC_CANONICAL_JSON_V1,
    compressionSuite: COMPRESSION_SUITE_GZIP_V1,
    cipherSuite: CIPHER_SUITE_AES_256_GCM,
    kdfSuite: FILE_KDF_SUITE_ARGON2ID_CANDIDATE_1,
  };
}

export function parseEnvelopeCommonPrefix(envelope) {
  const bytes = asUint8Array(envelope, "metadata envelope");
  protocolAssert(
    bytes.length >= DFM1_COMMON_PREFIX_BYTES,
    "TRUNCATED_ENVELOPE_PREFIX",
    `Metadata envelope must contain the ${DFM1_COMMON_PREFIX_BYTES}-byte common prefix`,
  );
  protocolAssert(
    bytes.length <= DFM1_MAX_ENVELOPE_BYTES,
    "ENVELOPE_TOO_LARGE",
    `Metadata envelope exceeds ${DFM1_MAX_ENVELOPE_BYTES} bytes`,
  );
  protocolAssert(
    equalBytesConstantTime(bytes.subarray(0, 4), DFM1_MAGIC_BYTES),
    "INVALID_ENVELOPE_MAGIC",
    "Metadata envelope magic must be DFM1",
  );
  const formatVersion = bytes[4];
  const identitySuiteId = readUint32BE(bytes, 0x10);
  protocolAssert(formatVersion !== 0, "ZERO_FORMAT_VERSION", "formatVersion must be nonzero");
  protocolAssert(identitySuiteId !== 0, "ZERO_IDENTITY_SUITE", "identitySuiteId must be nonzero");
  return Object.freeze({
    magic: "DFM1",
    formatVersion,
    identitySuiteId,
    envelopeLength: bytes.length,
  });
}

export function parseFormat1Envelope(envelope) {
  const bytes = asUint8Array(envelope, "metadata envelope");
  const prefix = parseEnvelopeCommonPrefix(bytes);
  if (prefix.formatVersion !== DFM1_FORMAT_1) {
    throw new UnsupportedProtocolError(
      "UNSUPPORTED_ENVELOPE_FORMAT",
      `Unsupported metadata envelope format ${prefix.formatVersion}`,
    );
  }
  protocolAssert(
    bytes.length >= DFM1_FORMAT_1_OVERHEAD_BYTES + 1,
    "TRUNCATED_FORMAT_1_ENVELOPE",
    "DFM1 format 1 envelope is truncated",
  );
  const flags = bytes[0x05];
  const plaintextCodec = bytes[0x06];
  const compressionSuite = bytes[0x07];
  const cipherSuite = bytes[0x08];
  const kdfSuite = bytes[0x09];
  const headerLength = readUint16BE(bytes, 0x0a);
  const contentCiphertextLength = readUint32BE(bytes, 0x0c);
  const reserved = readUint32BE(bytes, 0x14);
  protocolAssert(flags === 0, "NONZERO_ENVELOPE_FLAGS", "DFM1 format 1 flags must be zero");
  protocolAssert(
    plaintextCodec === PLAINTEXT_CODEC_CANONICAL_JSON_V1,
    "UNSUPPORTED_PLAINTEXT_CODEC",
    `Unsupported plaintext codec ${plaintextCodec}`,
  );
  protocolAssert(
    compressionSuite === COMPRESSION_SUITE_GZIP_V1,
    "UNSUPPORTED_COMPRESSION_SUITE",
    `Unsupported compression suite ${compressionSuite}`,
  );
  protocolAssert(
    cipherSuite === CIPHER_SUITE_AES_256_GCM,
    "UNSUPPORTED_CIPHER_SUITE",
    `Unsupported cipher suite ${cipherSuite}`,
  );
  protocolAssert(
    headerLength === DFM1_FORMAT_1_HEADER_BYTES,
    "INVALID_HEADER_LENGTH",
    `DFM1 format 1 headerLength must be ${DFM1_FORMAT_1_HEADER_BYTES}`,
  );
  protocolAssert(reserved === 0, "NONZERO_ENVELOPE_RESERVED", "Reserved bytes must be zero");
  protocolAssert(
    contentCiphertextLength >= 1 && contentCiphertextLength <= DFM1_MAX_CONTENT_CIPHERTEXT_BYTES,
    "INVALID_CONTENT_CIPHERTEXT_LENGTH",
    "DFM1 format 1 content ciphertext length is out of range",
  );
  protocolAssert(
    bytes.length === DFM1_FORMAT_1_OVERHEAD_BYTES + contentCiphertextLength,
    "ENVELOPE_LENGTH_MISMATCH",
    "Envelope length does not match contentCiphertextLength",
  );

  // Format dispatch and all structural checks happen before either suite is
  // selected. These calls are intentionally before any password processing or
  // KDF invocation in the production decrypt path.
  assertIdentitySuiteSupported(prefix.identitySuiteId);
  assertFileKdfSuiteSupported(kdfSuite);

  return Object.freeze({
    ...prefix,
    flags,
    plaintextCodec,
    compressionSuite,
    cipherSuite,
    kdfSuite,
    headerLength,
    contentCiphertextLength,
    reserved,
    fileSalt: bytes.slice(0x18, 0x28),
    wrapIV: bytes.slice(0x28, 0x34),
    contentIV: bytes.slice(0x34, 0x40),
    wrappedDEK: bytes.slice(0x40, 0x60),
    wrappedDEKTag: bytes.slice(0x60, 0x70),
    contentCiphertext: bytes.slice(0x70, 0x70 + contentCiphertextLength),
    contentTag: bytes.slice(0x70 + contentCiphertextLength),
  });
}

export function parseMetadataEnvelope(envelope) {
  const prefix = parseEnvelopeCommonPrefix(envelope);
  if (prefix.formatVersion === DFM1_FORMAT_1) return parseFormat1Envelope(envelope);
  throw new UnsupportedProtocolError(
    "UNSUPPORTED_ENVELOPE_FORMAT",
    `Unsupported metadata envelope format ${prefix.formatVersion}`,
  );
}

export function assembleFormat1Envelope(input) {
  const identitySuiteId = assertIdentitySuiteSupported(
    input.identitySuiteId ?? IDENTITY_SUITE_CANDIDATE_1,
  );
  const fileSalt = bytesOfLength(input.fileSalt, FILE_SALT_BYTES, "fileSalt");
  const wrapIV = bytesOfLength(input.wrapIV, AES_GCM_IV_BYTES, "wrapIV");
  const contentIV = bytesOfLength(input.contentIV, AES_GCM_IV_BYTES, "contentIV");
  const wrappedDEK = bytesOfLength(input.wrappedDEK, AES_KEY_BYTES, "wrappedDEK");
  const wrappedDEKTag = bytesOfLength(input.wrappedDEKTag, AES_GCM_TAG_BYTES, "wrappedDEKTag");
  const contentCiphertext = copyBytes(input.contentCiphertext, "contentCiphertext");
  const contentTag = bytesOfLength(input.contentTag, AES_GCM_TAG_BYTES, "contentTag");
  protocolAssert(
    contentCiphertext.length >= 1 && contentCiphertext.length <= DFM1_MAX_CONTENT_CIPHERTEXT_BYTES,
    "INVALID_CONTENT_CIPHERTEXT_LENGTH",
    "DFM1 format 1 content ciphertext length is out of range",
  );
  const envelope = new Uint8Array(DFM1_FORMAT_1_OVERHEAD_BYTES + contentCiphertext.length);
  envelope.set(DFM1_MAGIC_BYTES, 0);
  envelope[0x04] = DFM1_FORMAT_1;
  envelope[0x05] = 0;
  envelope[0x06] = PLAINTEXT_CODEC_CANONICAL_JSON_V1;
  envelope[0x07] = COMPRESSION_SUITE_GZIP_V1;
  envelope[0x08] = CIPHER_SUITE_AES_256_GCM;
  envelope[0x09] = FILE_KDF_SUITE_ARGON2ID_CANDIDATE_1;
  writeUint16BE(envelope, 0x0a, DFM1_FORMAT_1_HEADER_BYTES);
  writeUint32BE(envelope, 0x0c, contentCiphertext.length);
  writeUint32BE(envelope, 0x10, identitySuiteId);
  writeUint32BE(envelope, 0x14, 0);
  envelope.set(fileSalt, 0x18);
  envelope.set(wrapIV, 0x28);
  envelope.set(contentIV, 0x34);
  envelope.set(wrappedDEK, 0x40);
  envelope.set(wrappedDEKTag, 0x60);
  envelope.set(contentCiphertext, 0x70);
  envelope.set(contentTag, 0x70 + contentCiphertext.length);
  protocolAssert(
    envelope.length <= DFM1_MAX_ENVELOPE_BYTES,
    "ENVELOPE_TOO_LARGE",
    `Metadata envelope exceeds ${DFM1_MAX_ENVELOPE_BYTES} bytes`,
  );
  parseFormat1Envelope(envelope);
  return envelope;
}

function getWebCrypto() {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle || typeof crypto.getRandomValues !== "function") {
    throw new ProtocolError(
      "WEB_CRYPTO_UNAVAILABLE",
      "Web Crypto AES-GCM and CSPRNG support are required",
    );
  }
  return crypto;
}

function secureRandomBytes(length) {
  const bytes = new Uint8Array(length);
  getWebCrypto().getRandomValues(bytes);
  return bytes;
}

function takeRandomBytes(randomBytes, length, label) {
  const source = asUint8Array(randomBytes(length), label);
  try {
    protocolAssert(
      source.length === length,
      "INVALID_RANDOM_SOURCE",
      `${label} must be ${length} bytes`,
    );
    return new Uint8Array(source);
  } finally {
    // A random source must return a fresh disposable buffer. Clear that source
    // buffer immediately; the owned return value is cleared by the encryptor.
    wipeBytes(source);
  }
}

async function aesGcmEncrypt(keyBytes, iv, additionalData, plaintext) {
  const crypto = getWebCrypto();
  const key = await crypto.subtle.importKey(
    "raw",
    asUint8Array(keyBytes),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const combined = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: asUint8Array(iv),
        additionalData: asUint8Array(additionalData),
        tagLength: 128,
      },
      key,
      asUint8Array(plaintext),
    ),
  );
  return {
    ciphertext: combined.slice(0, -AES_GCM_TAG_BYTES),
    tag: combined.slice(-AES_GCM_TAG_BYTES),
  };
}

async function aesGcmDecrypt(keyBytes, iv, additionalData, ciphertext, tag, label) {
  const crypto = getWebCrypto();
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      asUint8Array(keyBytes),
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: asUint8Array(iv),
          additionalData: asUint8Array(additionalData),
          tagLength: 128,
        },
        key,
        concatBytes(ciphertext, tag),
      ),
    );
  } catch (error) {
    throw new ProtocolError(
      "AES_GCM_AUTHENTICATION_FAILED",
      `${label} AES-GCM authentication failed`,
      { cause: error },
    );
  }
}

export async function encryptFormat1Compressed(input) {
  const compressedPlaintext = copyBytes(input.compressedPlaintext, "compressed plaintext");
  let dek;
  let fileSalt;
  let wrapIV;
  let contentIV;
  let kek;
  try {
    protocolAssert(
      compressedPlaintext.length >= 1 &&
        compressedPlaintext.length <= DFM1_MAX_CONTENT_CIPHERTEXT_BYTES,
      "INVALID_COMPRESSED_LENGTH",
      "Compressed plaintext cannot fit in a DFM1 format 1 envelope",
    );
    const identitySuiteId = assertIdentitySuiteSupported(
      input.identitySuiteId ?? IDENTITY_SUITE_CANDIDATE_1,
    );
    const selectors = format1Selectors();
    const aad = computeFormat1Aad({ context: input.context, identitySuiteId, ...selectors });
    const randomBytes = input.randomBytes ?? secureRandomBytes;
    protocolAssert(
      typeof randomBytes === "function",
      "INVALID_RANDOM_SOURCE",
      "randomBytes must be a function",
    );

    // The call order is part of deterministic reference-vector generation.
    dek = takeRandomBytes(randomBytes, AES_KEY_BYTES, "DEK");
    fileSalt = takeRandomBytes(randomBytes, FILE_SALT_BYTES, "fileSalt");
    wrapIV = takeRandomBytes(randomBytes, AES_GCM_IV_BYTES, "wrapIV");
    contentIV = takeRandomBytes(randomBytes, AES_GCM_IV_BYTES, "contentIV");
    kek = await deriveFileKekBytes({
      rawPassphrase: input.rawPassphrase,
      fileSalt,
      kdfSuite: selectors.kdfSuite,
    });
    const wrapped = await aesGcmEncrypt(kek, wrapIV, aad.wrapAAD, dek);
    const content = await aesGcmEncrypt(dek, contentIV, aad.contentAAD, compressedPlaintext);
    const envelope = assembleFormat1Envelope({
      identitySuiteId,
      fileSalt,
      wrapIV,
      contentIV,
      wrappedDEK: wrapped.ciphertext,
      wrappedDEKTag: wrapped.tag,
      contentCiphertext: content.ciphertext,
      contentTag: content.tag,
    });
    return {
      envelope,
      payloadHash: keccak256(envelope),
      header: parseFormat1Envelope(envelope),
    };
  } finally {
    wipeBytes(kek);
    wipeBytes(dek);
    wipeBytes(fileSalt);
    wipeBytes(wrapIV);
    wipeBytes(contentIV);
    wipeBytes(compressedPlaintext);
  }
}

export async function decryptFormat1Compressed(input) {
  // This strict parse performs format dispatch and rejects unknown format,
  // identity suite, file KDF suite, or selectors before touching passphrase
  // bytes or invoking Argon2.
  const parsed = parseFormat1Envelope(input.envelope);
  const aad = computeFormat1Aad({
    context: input.context,
    identitySuiteId: parsed.identitySuiteId,
    formatVersion: parsed.formatVersion,
    plaintextCodec: parsed.plaintextCodec,
    compressionSuite: parsed.compressionSuite,
    cipherSuite: parsed.cipherSuite,
    kdfSuite: parsed.kdfSuite,
  });
  let kek;
  let dek;
  try {
    kek = await deriveFileKekBytes({
      rawPassphrase: input.rawPassphrase,
      fileSalt: parsed.fileSalt,
      kdfSuite: parsed.kdfSuite,
    });
    dek = await aesGcmDecrypt(
      kek,
      parsed.wrapIV,
      aad.wrapAAD,
      parsed.wrappedDEK,
      parsed.wrappedDEKTag,
      "Wrapped DEK",
    );
    protocolAssert(dek.length === AES_KEY_BYTES, "INVALID_DEK", "Unwrapped DEK must be 32 bytes");
    const compressedPlaintext = await aesGcmDecrypt(
      dek,
      parsed.contentIV,
      aad.contentAAD,
      parsed.contentCiphertext,
      parsed.contentTag,
      "Metadata content",
    );
    return { compressedPlaintext, header: parsed };
  } finally {
    wipeBytes(kek);
    wipeBytes(dek);
  }
}

export function computePayloadHash(envelope) {
  const bytes = asUint8Array(envelope, "metadata envelope");
  protocolAssert(bytes.length > 0, "EMPTY_ENVELOPE", "Metadata envelope cannot be empty");
  return keccak256(bytes);
}

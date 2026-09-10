import { AbiCoder, getBytes, hexlify, keccak256 } from "ethers";
import {
  COMPRESSION_SUITE_GZIP_V1,
  MAX_UINT64,
  PLAINTEXT_CODEC_CANONICAL_JSON_V1,
  STORY_BIOGRAPHY_SCHEMA_ID,
  STORY_CHUNK_SCHEMA,
  STORY_CHUNK_SCHEMA_ID,
  STORY_DEFAULT_COMPRESSION_SUITE,
  STORY_ENVELOPE_FORMAT_1,
  STORY_ENVELOPE_HEADER_BYTES,
  STORY_ENVELOPE_MAGIC_BYTES,
  STORY_HEAD_DOMAIN,
  STORY_MAX_CANONICAL_JSON_BYTES,
  STORY_MAX_ATTACHMENT_CID_BYTES,
  STORY_RECORD_DOMAIN,
  ZERO_BYTES32,
} from "./constants.js";
import { normalizeBytes32 } from "./aad.js";
import {
  asUint8Array,
  assertUnicodeScalarString,
  bigintFrom,
  decodeUtf8Fatal,
  equalBytesConstantTime,
  readUint32BE,
  utf8Bytes,
  writeUint32BE,
} from "./bytes.js";
import { escapeCanonicalJsonString } from "./canonical.js";
import { assertAddress } from "./identity.js";
import { readArchiveBlob } from "./archive.js";
import { ProtocolError, protocolAssert } from "./errors.js";
import { gunzipV1Strict, gzipV1 } from "./gzip.js";

// Freeze ECMAScript String.trim WhiteSpace + LineTerminator membership, instead
// of inheriting a future host Unicode table. U+0085 is not in this set; FEFF is.
const DFS1_TRIM_ONLY =
  /^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$/u;
const DFS1_TRIM_EDGE =
  /^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$/u;
const INPUT_KEYS = ["content", "chunkType", "attachmentCID"];
const CANONICAL_KEYS = ["schema", ...INPUT_KEYS];

function validateStoryRecord(input) {
  protocolAssert(
    input !== null &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(input)),
    "INVALID_STORY_OBJECT",
    "DFS1 record must be a plain object",
  );
  const keys = Object.keys(input);
  const expected = Object.hasOwn(input, "schema") ? CANONICAL_KEYS : INPUT_KEYS;
  protocolAssert(
    Object.getOwnPropertySymbols(input).length === 0 &&
      keys.length === expected.length &&
      expected.every((key) => Object.hasOwn(input, key)),
    "INVALID_STORY_KEYS",
    "DFS1 record has missing or unknown keys",
  );
  protocolAssert(
    !Object.hasOwn(input, "schema") || input.schema === STORY_CHUNK_SCHEMA,
    "UNSUPPORTED_STORY_SCHEMA",
    `DFS1 schema must be ${STORY_CHUNK_SCHEMA}`,
  );
  assertUnicodeScalarString(input.content, "content");
  protocolAssert(
    !DFS1_TRIM_ONLY.test(input.content),
    "EMPTY_STORY_CONTENT",
    "Story content must not be empty or whitespace-only",
  );
  protocolAssert(
    typeof input.chunkType === "number" &&
      Number.isInteger(input.chunkType) &&
      input.chunkType >= 0 &&
      input.chunkType <= 255 &&
      !Object.is(input.chunkType, -0),
    "INVALID_STORY_CHUNK_TYPE",
    "chunkType must be an integer from 0 through 255",
  );
  assertUnicodeScalarString(input.attachmentCID, "attachmentCID");
  protocolAssert(
    !DFS1_TRIM_EDGE.test(input.attachmentCID),
    "STORY_ATTACHMENT_WHITESPACE",
    "attachmentCID must not have leading or trailing whitespace",
  );
  protocolAssert(
    utf8Bytes(input.attachmentCID).length <= STORY_MAX_ATTACHMENT_CID_BYTES,
    "STORY_ATTACHMENT_TOO_LARGE",
    "attachmentCID must not exceed 256 UTF-8 bytes",
  );
  return {
    schema: STORY_CHUNK_SCHEMA,
    content: input.content,
    chunkType: input.chunkType,
    attachmentCID: input.attachmentCID,
  };
}

/**
 * DFS1 fixes key order and UTF-8, uses short escapes for \b/\t/\n/\f/\r,
 * lowercase \u00xx for other C0 controls, and only escapes quote/backslash
 * otherwise. Unicode scalar text (including slash, emoji and U+2028/2029) is
 * emitted literally. Integers use unsigned decimal without exponent or zeros.
 */
export function encodeCanonicalStoryRecord(input) {
  const record = validateStoryRecord(input);
  const bytes = utf8Bytes(
    `{"schema":${escapeCanonicalJsonString(record.schema)}` +
      `,"content":${escapeCanonicalJsonString(record.content)}` +
      `,"chunkType":${record.chunkType}` +
      `,"attachmentCID":${escapeCanonicalJsonString(record.attachmentCID)}}`,
  );
  protocolAssert(
    bytes.length <= STORY_MAX_CANONICAL_JSON_BYTES,
    "STORY_PLAINTEXT_TOO_LARGE",
    `Story JSON exceeds ${STORY_MAX_CANONICAL_JSON_BYTES} bytes`,
  );
  return bytes;
}

export function decodeCanonicalStoryRecord(payload) {
  const bytes = asUint8Array(payload, "DFS1 payload");
  protocolAssert(
    bytes.length <= STORY_MAX_CANONICAL_JSON_BYTES,
    "STORY_PLAINTEXT_TOO_LARGE",
    `Story JSON exceeds ${STORY_MAX_CANONICAL_JSON_BYTES} bytes`,
  );
  const text = decodeUtf8Fatal(bytes);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ProtocolError("INVALID_STORY_JSON", "DFS1 payload is not valid JSON", {
      cause: error,
    });
  }
  const record = validateStoryRecord(parsed);
  // Also rejects duplicate keys, alternate escapes, omitted schema, numeric
  // exponents, reordered keys, BOM and all insignificant JSON whitespace.
  protocolAssert(
    equalBytesConstantTime(bytes, encodeCanonicalStoryRecord(record)),
    "NON_CANONICAL_STORY_JSON",
    "DFS1 bytes do not match their canonical encoding",
  );
  return record;
}

/**
 * DFSE v1: magic[4], version[1], codec[1], compression[1], flags[1],
 * originalLength[8, big endian], originalKeccak256[32], compressed body.
 * Suite numbers are permanent protocol identifiers, independent of the
 * application's configured writer suite. No size-dependent fallback occurs.
 */
export function encodeStoryRecord(input, options = {}) {
  const compressionSuite = options.compressionSuite ?? STORY_DEFAULT_COMPRESSION_SUITE;
  protocolAssert(
    compressionSuite === COMPRESSION_SUITE_GZIP_V1,
    "UNSUPPORTED_STORY_COMPRESSION",
    `Unsupported configured story compression suite: ${compressionSuite}`,
  );
  const plaintext = encodeCanonicalStoryRecord(input);
  const compressed = gzipV1(plaintext, {
    maximumInputBytes: STORY_MAX_CANONICAL_JSON_BYTES,
  });
  const payload = new Uint8Array(STORY_ENVELOPE_HEADER_BYTES + compressed.length);
  payload.set(STORY_ENVELOPE_MAGIC_BYTES);
  payload[4] = STORY_ENVELOPE_FORMAT_1;
  payload[5] = PLAINTEXT_CODEC_CANONICAL_JSON_V1;
  payload[6] = compressionSuite;
  writeUint32BE(payload, 8, BigInt(plaintext.length) >> 32n);
  writeUint32BE(payload, 12, BigInt(plaintext.length) & 0xffff_ffffn);
  payload.set(getBytes(keccak256(plaintext)), 16);
  payload.set(compressed, STORY_ENVELOPE_HEADER_BYTES);
  return payload;
}

/** Inspect supported DFSE metadata before allocating decompressed output. */
export function inspectStoryEnvelope(payload) {
  const bytes = asUint8Array(payload, "DFSE payload");
  protocolAssert(bytes.length >= 8, "TRUNCATED_STORY_ENVELOPE", "DFSE prefix is truncated");
  protocolAssert(
    equalBytesConstantTime(bytes.subarray(0, 4), STORY_ENVELOPE_MAGIC_BYTES),
    "INVALID_STORY_ENVELOPE_MAGIC",
    "Story envelope must start with DFSE",
  );
  protocolAssert(
    bytes[4] === STORY_ENVELOPE_FORMAT_1,
    "UNSUPPORTED_STORY_ENVELOPE_VERSION",
    `Unsupported story envelope version: ${bytes[4]}`,
  );
  protocolAssert(
    bytes[5] === PLAINTEXT_CODEC_CANONICAL_JSON_V1,
    "UNSUPPORTED_STORY_PLAINTEXT_CODEC",
    `Unsupported story plaintext codec: ${bytes[5]}`,
  );
  protocolAssert(
    bytes[6] === COMPRESSION_SUITE_GZIP_V1,
    "UNSUPPORTED_STORY_COMPRESSION",
    `Unsupported story compression suite: ${bytes[6]}`,
  );
  protocolAssert(
    bytes[7] === 0,
    "UNSUPPORTED_STORY_ENVELOPE_FLAGS",
    `Unsupported story envelope flags: ${bytes[7]}`,
  );
  protocolAssert(
    bytes.length >= STORY_ENVELOPE_HEADER_BYTES,
    "TRUNCATED_STORY_ENVELOPE",
    "DFSE header is truncated",
  );
  const originalLength = (BigInt(readUint32BE(bytes, 8)) << 32n) | BigInt(readUint32BE(bytes, 12));
  protocolAssert(
    originalLength > 0n && originalLength <= BigInt(STORY_MAX_CANONICAL_JSON_BYTES),
    "STORY_PLAINTEXT_TOO_LARGE",
    `Story plaintext length must be 1 through ${STORY_MAX_CANONICAL_JSON_BYTES} bytes`,
  );
  return {
    formatVersion: bytes[4],
    plaintextCodec: bytes[5],
    compressionSuite: bytes[6],
    flags: bytes[7],
    originalLength: Number(originalLength),
    originalHash: hexlify(bytes.subarray(16, 48)),
    body: bytes.subarray(STORY_ENVELOPE_HEADER_BYTES),
  };
}

export function decodeStoryRecord(payload) {
  const envelope = inspectStoryEnvelope(payload);
  const plaintext = gunzipV1Strict(envelope.body, {
    maximumOutputBytes: envelope.originalLength,
  });
  protocolAssert(
    plaintext.length === envelope.originalLength,
    "STORY_PLAINTEXT_LENGTH_MISMATCH",
    "Decompressed story length does not match its envelope",
  );
  protocolAssert(
    keccak256(plaintext) === envelope.originalHash,
    "STORY_PLAINTEXT_HASH_MISMATCH",
    "Decompressed story hash does not match its envelope",
  );
  return decodeCanonicalStoryRecord(plaintext);
}

const UNSUPPORTED_ENVELOPE_CODES = new Set([
  "UNSUPPORTED_STORY_ENVELOPE_VERSION",
  "UNSUPPORTED_STORY_PLAINTEXT_CODEC",
  "UNSUPPORTED_STORY_COMPRESSION",
  "UNSUPPORTED_STORY_ENVELOPE_FLAGS",
]);

/** Unknown schemas are returned as verified raw records with decoded: null. */
export async function readStoryRecord(input) {
  const { recordRef } = input;
  protocolAssert(
    recordRef && typeof recordRef === "object",
    "INVALID_STORY_REF",
    "StoryRecordRef is required",
  );
  const schemaId = normalizeBytes32(recordRef.schemaId, "schemaId");
  protocolAssert(schemaId !== ZERO_BYTES32, "ZERO_STORY_SCHEMA", "Story schemaId must be nonzero");
  const author = assertAddress(recordRef.author, "author");
  const timestamp = bigintFrom(recordRef.timestamp, "timestamp", MAX_UINT64);
  const blob = await readArchiveBlob({
    // ethers Result exposes named tuple fields through getters, so spreading a
    // contract result would copy positional keys and silently lose the ref.
    pointer: recordRef.blob.pointer,
    payloadHash: recordRef.blob.payloadHash,
    payloadLength: recordRef.blob.payloadLength,
    segmentCount: recordRef.blob.segmentCount,
    getCode: input.getCode,
    concurrency: input.concurrency,
    blockTag: input.blockTag,
  });
  let decoded = null;
  let unsupportedReason;
  if (schemaId === STORY_CHUNK_SCHEMA_ID || schemaId === STORY_BIOGRAPHY_SCHEMA_ID) {
    try {
      decoded = decodeStoryRecord(blob.payload);
    } catch (error) {
      if (!UNSUPPORTED_ENVELOPE_CODES.has(error.code)) throw error;
      unsupportedReason = error.code;
    }
    if (decoded !== null) {
      protocolAssert(
        (schemaId === STORY_BIOGRAPHY_SCHEMA_ID) === (decoded.chunkType === 0),
        "STORY_RECORD_TYPE_SCHEMA_MISMATCH",
        "Type 0 must use the biography schema; ordinary stories must use types 1 through 255",
      );
    }
  } else {
    unsupportedReason = "UNSUPPORTED_STORY_SCHEMA";
  }
  return {
    ...blob,
    schemaId,
    author,
    timestamp,
    decoded,
    ...(unsupportedReason ? { unsupportedReason } : {}),
  };
}

const abi = AbiCoder.defaultAbiCoder();

/** Semantic commitment intentionally excludes pointer, segments and manifest. */
export function computeStoryRecordHash(input) {
  return keccak256(
    abi.encode(
      [
        "bytes32",
        "uint256",
        "address",
        "uint256",
        "uint64",
        "bytes32",
        "bytes32",
        "uint64",
        "address",
        "uint64",
      ],
      [
        STORY_RECORD_DOMAIN,
        bigintFrom(input.chainId, "chainId"),
        assertAddress(input.archive, "archive"),
        bigintFrom(input.tokenId, "tokenId"),
        bigintFrom(input.index, "index", MAX_UINT64),
        normalizeBytes32(input.schemaId, "schemaId"),
        normalizeBytes32(input.payloadHash, "payloadHash"),
        bigintFrom(input.payloadLength, "payloadLength", MAX_UINT64),
        assertAddress(input.author, "author"),
        bigintFrom(input.timestamp, "timestamp", MAX_UINT64),
      ],
    ),
  );
}

/** Initial previousHead is ZERO_BYTES32; every append commits to all history. */
export function computeStoryHead(input) {
  return keccak256(
    abi.encode(
      ["bytes32", "bytes32", "bytes32"],
      [
        STORY_HEAD_DOMAIN,
        normalizeBytes32(input.previousHead, "previousHead"),
        normalizeBytes32(input.recordHash, "recordHash"),
      ],
    ),
  );
}

import { AbiCoder, keccak256 } from "ethers";
import {
  MAX_UINT64,
  STORY_CHUNK_SCHEMA,
  STORY_CHUNK_SCHEMA_ID,
  STORY_HEAD_DOMAIN,
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
  utf8Bytes,
} from "./bytes.js";
import { escapeCanonicalJsonString } from "./canonical.js";
import { assertAddress } from "./identity.js";
import { readArchiveBlob } from "./archive.js";
import { ProtocolError, protocolAssert } from "./errors.js";

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
export function encodeStoryRecord(input) {
  const record = validateStoryRecord(input);
  return utf8Bytes(
    `{"schema":${escapeCanonicalJsonString(record.schema)}` +
      `,"content":${escapeCanonicalJsonString(record.content)}` +
      `,"chunkType":${record.chunkType}` +
      `,"attachmentCID":${escapeCanonicalJsonString(record.attachmentCID)}}`,
  );
}

export function decodeStoryRecord(payload) {
  const bytes = asUint8Array(payload, "DFS1 payload");
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
    equalBytesConstantTime(bytes, encodeStoryRecord(record)),
    "NON_CANONICAL_STORY_JSON",
    "DFS1 bytes do not match their canonical encoding",
  );
  return record;
}

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
  return {
    ...blob,
    schemaId,
    author,
    timestamp,
    decoded: schemaId === STORY_CHUNK_SCHEMA_ID ? decodeStoryRecord(blob.payload) : null,
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

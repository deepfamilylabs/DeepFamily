import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getBytes, hexlify, keccak256 } from "ethers";
import {
  STORY_CHUNK_SCHEMA,
  STORY_CHUNK_SCHEMA_ID,
  STORY_RECORD_DOMAIN,
  STORY_HEAD_DOMAIN,
  ZERO_BYTES32,
  computeStoryRecordHash,
  computeStoryHead,
  decodeStoryRecord,
  encodeStoryRecord,
  utf8Bytes,
} from "../index.js";

const vector = JSON.parse(
  fs.readFileSync(
    new URL("../../../protocol-vectors/archive-story-v1.json", import.meta.url),
    "utf8",
  ),
);
const input = { content: "  原文😀 e\u0301\n ", chunkType: 3, attachmentCID: "ipfs://abc" };

test("DFS1 shared golden bytes, schema hash and multiple-record semantic head match", () => {
  assert.equal(STORY_CHUNK_SCHEMA_ID, vector.schemaId);
  assert.equal(STORY_RECORD_DOMAIN, vector.recordDomain);
  assert.equal(STORY_HEAD_DOMAIN, vector.headDomain);
  assert.equal(vector.initialHead, ZERO_BYTES32);
  let previousHead = ZERO_BYTES32;
  for (const record of vector.records) {
    const payload = encodeStoryRecord(record.input);
    assert.equal(hexlify(payload), record.canonicalHex);
    assert.equal(new TextDecoder().decode(payload), record.canonicalJson);
    assert.equal(keccak256(payload), record.commitment.payloadHash);
    assert.equal(payload.length, Number(record.commitment.payloadLength));
    assert.deepEqual(decodeStoryRecord(payload), { schema: STORY_CHUNK_SCHEMA, ...record.input });
    assert.equal(computeStoryRecordHash(record.commitment), record.recordHash);
    assert.equal(previousHead, record.previousHead);
    previousHead = computeStoryHead({ previousHead, recordHash: record.recordHash });
    assert.equal(previousHead, record.newHead);
  }
  assert.equal(previousHead, vector.finalHead);
});

test("DFS1 preserves exact content without trimming or Unicode normalization", () => {
  assert.equal(decodeStoryRecord(encodeStoryRecord(input)).content, input.content);
  assert.notEqual(
    keccak256(encodeStoryRecord(input)),
    keccak256(encodeStoryRecord({ ...input, content: input.content.trim() })),
  );
  assert.notEqual(
    keccak256(encodeStoryRecord(input)),
    keccak256(encodeStoryRecord({ ...input, content: input.content.normalize("NFC") })),
  );
  for (const whitespace of [
    "",
    " \r\n\t",
    "\ufeff",
    "\u00a0\u1680\u2000\u200a\u2028\u2029\u202f\u205f\u3000",
  ]) {
    assert.throws(
      () => encodeStoryRecord({ ...input, content: whitespace }),
      (error) => error.code === "EMPTY_STORY_CONTENT",
    );
  }
  // The trim set is explicitly ECMAScript's set, not Unicode White_Space.
  assert.equal(
    decodeStoryRecord(encodeStoryRecord({ ...input, content: "\u0085" })).content,
    "\u0085",
  );
});

test("DFS1 chunkType and attachment field bounds and whitespace are strict", () => {
  for (const chunkType of [-1, 256, 3.5, "3", 3n, null, NaN, Infinity, -0]) {
    assert.throws(
      () => encodeStoryRecord({ ...input, chunkType }),
      (error) => error.code === "INVALID_STORY_CHUNK_TYPE",
    );
  }
  for (const chunkType of [0, 255])
    assert.equal(
      decodeStoryRecord(encodeStoryRecord({ ...input, chunkType })).chunkType,
      chunkType,
    );
  for (const attachmentCID of ["", "a".repeat(256), "😀".repeat(64)]) {
    assert.equal(
      decodeStoryRecord(encodeStoryRecord({ ...input, attachmentCID })).attachmentCID,
      attachmentCID,
    );
  }
  for (const attachmentCID of ["a".repeat(257), "😀".repeat(65)]) {
    assert.throws(
      () => encodeStoryRecord({ ...input, attachmentCID }),
      (error) => error.code === "STORY_ATTACHMENT_TOO_LARGE",
    );
  }
  for (const attachmentCID of [" x", "x\n", "\ufeffx", "x\u3000"]) {
    assert.throws(
      () => encodeStoryRecord({ ...input, attachmentCID }),
      (error) => error.code === "STORY_ATTACHMENT_WHITESPACE",
    );
  }
});

test("DFS1 rejects extra/missing fields, unsupported schema and non-scalar strings", () => {
  for (const record of [
    { ...input, extra: 1 },
    { ...input, schema: "other" },
    { content: "x", chunkType: 3 },
    { ...input, [Symbol("x")]: 1 },
    { ...input, content: "\ud800" },
    { ...input, attachmentCID: "\udfff" },
  ])
    assert.throws(() => encodeStoryRecord(record));
});

test("DFS1 rejects every alternate JSON spelling, duplicate keys, BOM and invalid UTF8", () => {
  const canonical = new TextDecoder().decode(
    encodeStoryRecord({ content: "中/\n", chunkType: 3, attachmentCID: "" }),
  );
  for (const text of [
    canonical + "\n",
    " " + canonical,
    canonical.replace('"content":', '"content": '),
    canonical.replace("中", "\\u4e2d"),
    canonical.replace("/", "\\/"),
    canonical.replace("\\n", "\\u000a"),
    canonical.replace('"chunkType":3', '"chunkType":3.0'),
    canonical.replace('"chunkType":3', '"chunkType":3e0'),
    canonical.replace('"chunkType":3', '"chunkType":-0'),
    canonical.replace('"chunkType":3', '"chunkType":3,"chunkType":3'),
    canonical.replace('"attachmentCID":""', '"attachmentCID":"","extra":false'),
    canonical.replace('"attachmentCID":""', '"attachmentCID":"\\ud800"'),
    canonical.replace('{"schema":"deepfamily/story-chunk@1.0",', "{"),
    '{"content":"中/\\n","schema":"deepfamily/story-chunk@1.0","chunkType":3,"attachmentCID":""}',
    "\ufeff" + canonical,
  ])
    assert.throws(() => decodeStoryRecord(utf8Bytes(text)), text);
  assert.throws(
    () => decodeStoryRecord(Uint8Array.of(0xc0, 0xaf)),
    (error) => error.code === "INVALID_UTF8",
  );
});

test("every semantic commitment field changes record hash and final historical head", () => {
  const record = vector.records[0];
  const mutations = {
    chainId: "31338",
    archive: "0x4444444444444444444444444444444444444444",
    tokenId: "8",
    index: "1",
    schemaId: `0x${"44".repeat(32)}`,
    payloadHash: `0x${"55".repeat(32)}`,
    payloadLength: String(Number(record.commitment.payloadLength) + 1),
    author: "0x5555555555555555555555555555555555555555",
    timestamp: "1700000001",
  };
  for (const [field, value] of Object.entries(mutations)) {
    const recordHash = computeStoryRecordHash({ ...record.commitment, [field]: value });
    assert.notEqual(recordHash, record.recordHash, field);
    const firstHead = computeStoryHead({ previousHead: ZERO_BYTES32, recordHash });
    assert.notEqual(
      computeStoryHead({ previousHead: firstHead, recordHash: vector.records[1].recordHash }),
      vector.finalHead,
      field,
    );
  }
  assert.equal(
    computeStoryRecordHash({ ...record.commitment, pointer: "ignored", segmentCount: 99 }),
    record.recordHash,
  );
  assert.throws(() => computeStoryRecordHash({ ...record.commitment, index: 2n ** 64n }));
  assert.deepEqual(getBytes(record.canonicalHex), encodeStoryRecord(record.input));
});

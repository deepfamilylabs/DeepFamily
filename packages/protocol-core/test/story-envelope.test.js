import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { hexlify, keccak256 } from "ethers";
import {
  encodeStoryRecord,
  decodeStoryRecord,
  encodeCanonicalStoryRecord,
  inspectStoryEnvelope,
  readStoryRecord,
  STORY_CHUNK_SCHEMA_ID,
  STORY_BIOGRAPHY_SCHEMA_ID,
} from "../index.js";

const input = {
  content: '  中文\r\n\n😀 e\u0301 "引号" \\路径\t  ',
  chunkType: 1,
  attachmentCID: "ipfs://test",
};
test("public writes always gzip, including a short record that grows; exact source survives", () => {
  const payload = encodeStoryRecord(input);
  const header = inspectStoryEnvelope(payload);
  assert.equal(header.compressionSuite, 1);
  assert.equal(header.originalHash, keccak256(encodeCanonicalStoryRecord(input)));
  assert.equal(header.originalLength, encodeCanonicalStoryRecord(input).length);
  assert.deepEqual(decodeStoryRecord(payload), { schema: "deepfamily/story-chunk@1.0", ...input });
  assert.throws(
    () => encodeStoryRecord(input, { compressionSuite: 0 }),
    (error) => error.code === "UNSUPPORTED_STORY_COMPRESSION",
  );
  assert.throws(() => encodeStoryRecord(input, { compressionSuite: 2 }));
});
test("public envelope rejects corruption, truncation, false original lengths and hashes", () => {
  const payload = encodeStoryRecord(input);
  for (const offset of [0, 8, 15, 16, 47, payload.length - 1]) {
    const changed = payload.slice();
    changed[offset] ^= 1;
    assert.throws(() => decodeStoryRecord(changed), `offset ${offset}`);
  }
  for (const length of [0, 7, 20, 47, payload.length - 1])
    assert.throws(() => decodeStoryRecord(payload.slice(0, length)));
  const extra = new Uint8Array(payload.length + 1);
  extra.set(payload);
  assert.throws(() => decodeStoryRecord(extra));
});
test("public records have their own resource bound and can exceed private metadata's 1 MiB", () => {
  const record = { ...input, content: "长传记".repeat(120_000) };
  const payload = encodeStoryRecord(record);
  assert.ok(inspectStoryEnvelope(payload).originalLength > 1_048_576);
  assert.equal(decodeStoryRecord(payload).content, record.content);
  const large = payload.slice();
  new DataView(large.buffer).setBigUint64(8, 16_777_217n);
  assert.throws(
    () => decodeStoryRecord(large),
    (error) => error.code === "STORY_PLAINTEXT_TOO_LARGE",
  );
});
const pointer = "0x1111111111111111111111111111111111111111";
async function read(payload, schemaId = STORY_CHUNK_SCHEMA_ID) {
  return readStoryRecord({
    recordRef: {
      schemaId,
      author: pointer,
      timestamp: 1,
      blob: {
        pointer,
        payloadLength: payload.length,
        segmentCount: 1,
        payloadHash: keccak256(payload),
      },
    },
    getCode: async () => `0x00${hexlify(payload).slice(2)}`,
  });
}
test("unknown future compression/format stays verified raw; reserved biography source is enforced", async () => {
  const payload = encodeStoryRecord(input);
  for (const offset of [4, 5, 6, 7]) {
    const future = payload.slice();
    future[offset] = 99;
    const result = await read(future);
    assert.equal(result.decoded, null);
    assert.ok(result.unsupportedReason);
    assert.deepEqual(result.payload, future);
  }
  const biography = encodeStoryRecord({ ...input, chunkType: 0 });
  assert.equal((await read(biography, STORY_BIOGRAPHY_SCHEMA_ID)).decoded.chunkType, 0);
  await assert.rejects(
    read(biography),
    (error) => error.code === "STORY_RECORD_TYPE_SCHEMA_MISMATCH",
  );
  await assert.rejects(
    read(payload, STORY_BIOGRAPHY_SCHEMA_ID),
    (error) => error.code === "STORY_RECORD_TYPE_SCHEMA_MISMATCH",
  );
});
test("a gzip body crossing physical segment boundaries reassembles before decompression", async () => {
  const record = { ...input, content: randomBytes(40_000).toString("base64") };
  const payload = encodeStoryRecord(record);
  assert.ok(payload.length > 16_384);
  // Exercise the codec with boundaries through the gzip stream, not Unicode slicing.
  const restored = new Uint8Array(payload.length);
  for (let offset = 0; offset < payload.length; offset += 16_384)
    restored.set(payload.slice(offset, offset + 16_384), offset);
  assert.deepEqual(decodeStoryRecord(restored), {
    schema: "deepfamily/story-chunk@1.0",
    ...record,
  });
});

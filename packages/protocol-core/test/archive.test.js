import test from "node:test";
import assert from "node:assert/strict";
import { AbiCoder, getBytes, hexlify, keccak256 } from "ethers";
import {
  ARCHIVE_MAX_SEGMENT_PAYLOAD_LENGTH,
  MAX_UINT64,
  ZERO_ADDRESS,
  decodeStoryRecord,
  encodeStoryRecord,
  parseMetadataEnvelope,
  predictArchiveSegmentCount,
  readArchiveBlob,
  readMetadataEnvelopeFromRef,
  readStoryRecord,
  STORY_CHUNK_SCHEMA_ID,
  writeUint32BE,
} from "../index.js";

const address = (index) => `0x${index.toString(16).padStart(40, "0")}`;
const uint64 = (bytes, offset, value) => {
  writeUint32BE(bytes, offset, BigInt(value) >> 32n);
  writeUint32BE(bytes, offset + 4, BigInt(value) & 0xffff_ffffn);
};

function archiveFixture(payload) {
  const count = Math.ceil(payload.length / 16384);
  const ref = {
    payloadHash: keccak256(payload),
    payloadLength: payload.length,
    segmentCount: count,
    pointer: address(1),
  };
  const codes = new Map();
  const segmentPointers = Array.from({ length: count }, (_, index) => address(index + 2));
  for (let index = 0; index < count; index += 1) {
    const part = payload.subarray(index * 16384, (index + 1) * 16384);
    const code = new Uint8Array(part.length + 1);
    code.set(part, 1);
    codes.set(segmentPointers[index], code);
  }
  const pagePointers = Array.from({ length: Math.ceil(count / 1024) }, (_, index) =>
    address(1_000_000 + index),
  );
  if (count === 1) {
    ref.pointer = segmentPointers[0];
  } else {
    ref.pointer = pagePointers[0];
    for (let page = 0; page < pagePointers.length; page += 1) {
      const entries = segmentPointers.slice(page * 1024, (page + 1) * 1024);
      const code = new Uint8Array(86 + 20 * entries.length);
      code.set([0, 0x44, 0x46, 0x42, 0x50, 1]);
      writeUint32BE(code, 6, page);
      writeUint32BE(code, 10, pagePointers.length);
      writeUint32BE(code, 14, page * 1024);
      writeUint32BE(code, 18, entries.length);
      code.set(getBytes(pagePointers[page + 1] ?? ZERO_ADDRESS), 22);
      uint64(code, 42, payload.length);
      writeUint32BE(code, 50, count);
      code.set(getBytes(ref.payloadHash), 54);
      entries.forEach((pointer, index) => code.set(getBytes(pointer), 86 + index * 20));
      codes.set(pagePointers[page], code);
    }
  }
  return {
    ref,
    codes,
    segmentPointers,
    pagePointers,
    getCode: async (pointer) => codes.get(pointer.toLowerCase()) ?? "0x",
  };
}
const read = (fixture, extra = {}) =>
  readArchiveBlob({ ...fixture.ref, getCode: fixture.getCode, ...extra });

for (const length of [1, 16_383, 16_384, 16_385, 32_768]) {
  test(`Archive reassembles and verifies exactly ${length} bytes`, async () => {
    const payload = Uint8Array.from({ length }, (_, index) => index % 251);
    const fixture = archiveFixture(payload);
    const verified = await read(fixture);
    assert.deepEqual(verified.payload, payload);
    assert.equal(verified.payloadLength, length);
    assert.equal(verified.payloadHash, keccak256(payload));
    assert.equal(verified.segmentCount, Math.ceil(length / 16384));
  });
}

test("Archive rejects empty/out-of-range/inconsistent refs before RPC", async () => {
  const fixture = archiveFixture(Uint8Array.of(1));
  let calls = 0;
  for (const extra of [
    { payloadLength: 0 },
    { payloadLength: MAX_UINT64 + 1n },
    { segmentCount: 0 },
    { segmentCount: 2 },
    { pointer: ZERO_ADDRESS },
    { concurrency: 0 },
    { concurrency: 1.5 },
  ]) {
    await assert.rejects(
      read(fixture, {
        ...extra,
        getCode: async () => {
          calls++;
          return "0x";
        },
      }),
    );
  }
  assert.equal(calls, 0);
  assert.equal(predictArchiveSegmentCount(16_385), 2);
  assert.equal(predictArchiveSegmentCount(16_384n * 0xffff_ffffn), 0xffff_ffff);
  assert.throws(() => predictArchiveSegmentCount(16_384n * 0xffff_ffffn + 1n), /uint32/);
});

test("manifest validates STOP, magic, version, exact lengths and every metadata field", async () => {
  const mutations = [
    [0, "MISSING_STOP_PREFIX"],
    [1, "INVALID_MANIFEST_MAGIC"],
    [5, "UNSUPPORTED_MANIFEST_VERSION"],
    [9, "MANIFEST_PAGE_INDEX_MISMATCH"],
    [13, "MANIFEST_PAGE_COUNT_MISMATCH"],
    [17, "MANIFEST_FIRST_SEGMENT_MISMATCH"],
    [21, "MANIFEST_ENTRY_COUNT_MISMATCH"],
    [49, "MANIFEST_PAYLOAD_LENGTH_MISMATCH"],
    [53, "MANIFEST_SEGMENT_COUNT_MISMATCH"],
    [85, "MANIFEST_PAYLOAD_HASH_MISMATCH"],
  ];
  for (const [offset, code] of mutations) {
    const fixture = archiveFixture(new Uint8Array(16_385).fill(7));
    fixture.codes.get(fixture.ref.pointer)[offset] ^= 1;
    await assert.rejects(read(fixture), (error) => error.code === code, `offset ${offset}`);
  }
  for (const sizeDelta of [-1, 1]) {
    const fixture = archiveFixture(new Uint8Array(16_385).fill(7));
    const manifest = fixture.codes.get(fixture.ref.pointer);
    const resized = new Uint8Array(manifest.length + sizeDelta);
    resized.set(manifest.subarray(0, resized.length));
    fixture.codes.set(fixture.ref.pointer, resized);
    await assert.rejects(read(fixture), (error) => error.code === "RUNTIME_LENGTH_MISMATCH");
  }
});

test("manifest rejects zero/duplicate addresses, aliases and unexpected next page", async () => {
  for (const [offset, pointer, errorCode] of [
    [86, ZERO_ADDRESS, "ZERO_ARCHIVE_ADDRESS"],
    [106, address(2), "DUPLICATE_ARCHIVE_ADDRESS"],
    [86, address(1_000_000), "DUPLICATE_ARCHIVE_ADDRESS"],
    [22, address(3), "INVALID_MANIFEST_NEXT_PAGE"],
  ]) {
    const fixture = archiveFixture(new Uint8Array(16_385).fill(8));
    fixture.codes.get(fixture.ref.pointer).set(getBytes(pointer), offset);
    await assert.rejects(read(fixture), (error) => error.code === errorCode);
  }
});

test("missing, truncated, oversized, non-STOP and corrupted segment code is rejected", async () => {
  for (const [transform, expected] of [
    [() => "0x", "RUNTIME_LENGTH_MISMATCH"],
    [(code) => code.slice(1), "RUNTIME_LENGTH_MISMATCH"],
    [(code) => new Uint8Array(code.length + 1), "RUNTIME_LENGTH_MISMATCH"],
    [
      (code) => {
        code[0] = 1;
        return code;
      },
      "MISSING_STOP_PREFIX",
    ],
    [
      (code) => {
        code[1] ^= 1;
        return code;
      },
      "PAYLOAD_HASH_MISMATCH",
    ],
  ]) {
    const fixture = archiveFixture(new Uint8Array(16_385).fill(9));
    const lastPointer = fixture.segmentPointers.at(-1);
    fixture.codes.set(lastPointer, transform(fixture.codes.get(lastPointer)));
    await assert.rejects(read(fixture), (error) => error.code === expected);
  }
  const fixture = archiveFixture(Uint8Array.of(1));
  await assert.rejects(
    read(fixture, {
      getCode: async () => {
        throw new Error("offline");
      },
    }),
    (error) => error.code === "ARCHIVE_CODE_READ_FAILED" && error.cause.message === "offline",
  );
});

for (const count of [1024, 1025]) {
  test(`${count} segments use complete manifest pages and the exact next chain`, async () => {
    const payload = new Uint8Array(16384 * (count - 1) + 1).fill(17);
    const fixture = archiveFixture(payload);
    const result = await read(fixture);
    assert.equal(result.segmentCount, count);
    assert.deepEqual(result.payload, payload);
    assert.equal(fixture.codes.get(fixture.ref.pointer).length, 86 + Math.min(count, 1024) * 20);
    if (count === 1025) {
      const first = fixture.codes.get(fixture.ref.pointer);
      first.set(getBytes(ZERO_ADDRESS), 22);
      await assert.rejects(read(fixture), (error) => error.code === "INVALID_MANIFEST_NEXT_PAGE");
      first.set(getBytes(fixture.ref.pointer), 22);
      await assert.rejects(read(fixture), (error) => error.code === "DUPLICATE_ARCHIVE_ADDRESS");
      first.set(getBytes(fixture.segmentPointers[0]), 22);
      await assert.rejects(read(fixture), (error) => error.code === "DUPLICATE_ARCHIVE_ADDRESS");
      first.set(getBytes(fixture.pagePointers[1]), 22);
      const second = fixture.codes.get(fixture.pagePointers[1]);
      second[9] = 0;
      await assert.rejects(read(fixture), (error) => error.code === "MANIFEST_PAGE_INDEX_MISMATCH");
    }
  });
}

test("segment RPC uses default concurrency 8, preserves order and propagates blockTag", async () => {
  const fixture = archiveFixture(
    Uint8Array.from({ length: 16384 * 10 + 2 }, (_, index) => index % 251),
  );
  let pending = 0;
  let maximum = 0;
  const result = await read(fixture, {
    blockTag: 12345,
    getCode: async (pointer, blockTag) => {
      assert.equal(blockTag, 12345);
      pending++;
      maximum = Math.max(maximum, pending);
      await new Promise((resolve) => setImmediate(resolve));
      pending--;
      return fixture.getCode(pointer);
    },
  });
  assert.equal(maximum, 8);
  assert.equal(result.payloadHash, fixture.ref.payloadHash);
});

test("DFS1 emoji and JSON escapes split at segment boundaries decode only after reassembly", async () => {
  for (const suffix of ["😀", "\n", "\\", '"']) {
    const prefix = new TextEncoder().encode(
      '{"schema":"deepfamily/story-chunk@1.0","content":"',
    ).length;
    const content = "a".repeat(ARCHIVE_MAX_SEGMENT_PAYLOAD_LENGTH - prefix - 1) + suffix + "  ";
    const bytes = encodeStoryRecord({ content, chunkType: 3, attachmentCID: "" });
    const fixture = archiveFixture(bytes);
    const result = await readStoryRecord({
      getCode: fixture.getCode,
      recordRef: {
        blob: fixture.ref,
        schemaId: STORY_CHUNK_SCHEMA_ID,
        author: address(999),
        timestamp: 123n,
      },
    });
    assert.equal(result.decoded.content, content);
    assert.deepEqual(result.payload, bytes);
    assert.deepEqual(decodeStoryRecord(result.payload), result.decoded);
  }
});

test("unknown Story schema preserves verified non-UTF8 raw bytes", async () => {
  const payload = Uint8Array.of(255, 192, 254);
  const fixture = archiveFixture(payload);
  const result = await readStoryRecord({
    getCode: fixture.getCode,
    recordRef: {
      blob: fixture.ref,
      schemaId: `0x${"ab".repeat(32)}`,
      author: address(5),
      timestamp: 4n,
    },
  });
  assert.equal(result.decoded, null);
  assert.deepEqual(result.payload, payload);
});

test("Story reader accepts ethers Result refs using their named tuple fields", async () => {
  const payload = encodeStoryRecord({
    content: "Exact chain result",
    chunkType: 3,
    attachmentCID: "",
  });
  const fixture = archiveFixture(payload);
  const abi = AbiCoder.defaultAbiCoder();
  const type =
    "tuple(tuple(bytes32 payloadHash,address pointer,uint64 payloadLength,uint32 segmentCount) blob,bytes32 schemaId,address author,uint64 timestamp)";
  const [recordRef] = abi.decode(
    [type],
    abi.encode(
      [type],
      [
        {
          blob: fixture.ref,
          schemaId: STORY_CHUNK_SCHEMA_ID,
          author: address(100),
          timestamp: 123n,
        },
      ],
    ),
  );
  assert.equal(Object.hasOwn({ ...recordRef.blob }, "pointer"), false);
  const result = await readStoryRecord({ getCode: fixture.getCode, recordRef });
  assert.equal(result.decoded.content, "Exact chain result");
  assert.equal(result.timestamp, 123n);
  assert.deepEqual(result.payload, payload);
});

test("future Metadata format above 16 KiB has transparent blob/common-prefix readback", async () => {
  const payload = new Uint8Array(32_768).fill(6);
  payload.set([0x44, 0x46, 0x4d, 0x31, 2], 0);
  writeUint32BE(payload, 16, 1);
  const fixture = archiveFixture(payload);
  const result = await readMetadataEnvelopeFromRef({ ...fixture.ref, getCode: fixture.getCode });
  assert.equal(result.prefix.formatVersion, 2);
  assert.deepEqual(result.envelope, payload);
  assert.throws(
    () => parseMetadataEnvelope(result.envelope),
    (error) => error.code === "UNSUPPORTED_ENVELOPE_FORMAT",
  );
  payload[4] = 1;
  assert.throws(
    () => parseMetadataEnvelope(payload),
    (error) => error.code === "ENVELOPE_TOO_LARGE",
  );
});

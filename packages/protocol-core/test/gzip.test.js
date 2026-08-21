import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "fflate";
import {
  MAX_CANONICAL_JSON_BYTES,
  bytesToHex,
  gzipV1,
  gunzipV1Strict,
  utf8Bytes,
} from "../index.js";

test("gzip-v1 is deterministic level 6 with mtime zero and strict round-trip", () => {
  const input = utf8Bytes("DeepFamily gzip-v1\n世界");
  const first = gzipV1(input);
  const second = gzipV1(input);
  assert.deepEqual(first, second);
  assert.equal(
    bytesToHex(first),
    "0x1f8b080000000000000373494d2d704bcccdcca95448afca2cd02d33e47ab263daf3a93d00bfb6160e19000000",
  );
  assert.deepEqual(gunzipV1Strict(first), input);
  assert.deepEqual(Array.from(first.slice(0, 10)), [31, 139, 8, 0, 0, 0, 0, 0, 0, 3]);
});

test("strict gzip rejects CRC, ISIZE, optional headers, concatenated members and trailing bytes", () => {
  const member = gzipV1(utf8Bytes("abc"));
  const crc = member.slice();
  crc[crc.length - 8] ^= 1;
  assert.throws(() => gunzipV1Strict(crc), /CRC32/);

  const size = member.slice();
  size[size.length - 4] ^= 1;
  assert.throws(() => gunzipV1Strict(size), /ISIZE/);

  const optional = member.slice();
  optional[3] = 8;
  assert.throws(() => gunzipV1Strict(optional), /optional header/);

  const concatenated = new Uint8Array(member.length * 2);
  concatenated.set(member);
  concatenated.set(member, member.length);
  assert.throws(() => gunzipV1Strict(concatenated), /exactly one member/);

  const trailing = new Uint8Array(member.length + 1);
  trailing.set(member);
  trailing[member.length] = 0;
  assert.throws(() => gunzipV1Strict(trailing), /no trailing bytes/);
});

test("strict gzip enforces the 1 MiB expansion ceiling before materializing oversized output", () => {
  const oversized = new Uint8Array(MAX_CANONICAL_JSON_BYTES + 1).fill(0x61);
  const compressed = gzipSync(oversized, { level: 6, mtime: 0 });
  assert.throws(() => gunzipV1Strict(compressed), /exceeds 1048576 bytes/);
});

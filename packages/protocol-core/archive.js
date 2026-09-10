import { getBytes, hexlify, keccak256 } from "ethers";
import {
  ARCHIVE_DEFAULT_READ_CONCURRENCY,
  ARCHIVE_MANIFEST_HEADER_LENGTH,
  ARCHIVE_MAX_MANIFEST_ENTRIES,
  ARCHIVE_MAX_SEGMENT_PAYLOAD_LENGTH,
  MAX_UINT32,
  MAX_UINT64,
  ZERO_ADDRESS,
} from "./constants.js";
import { asUint8Array, bigintFrom, equalBytesConstantTime, readUint32BE } from "./bytes.js";
import { normalizeBytes32 } from "./aad.js";
import { assertAddress } from "./identity.js";
import { parseEnvelopeCommonPrefix } from "./envelope.js";
import { ProtocolError, protocolAssert } from "./errors.js";

function nonzeroAddress(value, label) {
  const address = assertAddress(value, label);
  protocolAssert(address !== ZERO_ADDRESS, "ZERO_ARCHIVE_ADDRESS", `${label} must be nonzero`);
  return address;
}

function readUint64BE(bytes, offset) {
  return (BigInt(readUint32BE(bytes, offset)) << 32n) | BigInt(readUint32BE(bytes, offset + 4));
}

/** Physical segment count; no application-level total payload size limit. */
export function predictArchiveSegmentCount(payloadLength) {
  const length = bigintFrom(payloadLength, "payloadLength", MAX_UINT64);
  protocolAssert(length > 0n, "EMPTY_ARCHIVE_PAYLOAD", "Archive payloadLength must be nonzero");
  const count =
    (length + BigInt(ARCHIVE_MAX_SEGMENT_PAYLOAD_LENGTH) - 1n) /
    BigInt(ARCHIVE_MAX_SEGMENT_PAYLOAD_LENGTH);
  protocolAssert(
    count <= MAX_UINT32,
    "SEGMENT_COUNT_OVERFLOW",
    "Archive segmentCount exceeds uint32",
  );
  return Number(count);
}

function normalizeBlobRef(input) {
  const payloadLength = bigintFrom(input.payloadLength, "payloadLength", MAX_UINT64);
  const expectedCount = predictArchiveSegmentCount(payloadLength);
  const segmentCount = Number(bigintFrom(input.segmentCount, "segmentCount", MAX_UINT32));
  protocolAssert(
    segmentCount === expectedCount,
    "SEGMENT_COUNT_MISMATCH",
    "BlobRef.segmentCount must equal ceil(payloadLength / 16384)",
  );
  // uint32 segments of 16384 bytes are still exactly representable as JS Numbers.
  return {
    pointer: nonzeroAddress(input.pointer, "blob pointer"),
    payloadLength: Number(payloadLength),
    payloadHash: normalizeBytes32(input.payloadHash, "payloadHash"),
    segmentCount,
  };
}

function assertRuntime(code, length) {
  protocolAssert(
    code.length === length,
    "RUNTIME_LENGTH_MISMATCH",
    "Archive runtime length does not match the exact expected length",
  );
  protocolAssert(code[0] === 0, "MISSING_STOP_PREFIX", "Archive runtime must begin with STOP");
}

/**
 * Read immutable Archive bytecode, validate every manifest/segment, then verify
 * the complete logical hash. Decode text only after this byte-level reassembly.
 */
export async function readArchiveBlob(input) {
  protocolAssert(
    typeof input.getCode === "function",
    "INVALID_GET_CODE",
    "getCode function is required",
  );
  const ref = normalizeBlobRef(input);
  const concurrency = input.concurrency ?? ARCHIVE_DEFAULT_READ_CONCURRENCY;
  protocolAssert(
    Number.isSafeInteger(concurrency) && concurrency > 0,
    "INVALID_READ_CONCURRENCY",
    "Archive read concurrency must be a positive safe integer",
  );
  const blockTag = input.blockTag ?? "latest";
  const getCode = async (pointer) => {
    let value;
    try {
      value = await input.getCode(pointer, blockTag);
    } catch (error) {
      throw new ProtocolError(
        "ARCHIVE_CODE_READ_FAILED",
        `Failed to read Archive code at ${pointer}`,
        { cause: error },
      );
    }
    return asUint8Array(value, "Archive runtime code");
  };
  const segments = [];
  if (ref.segmentCount === 1) {
    segments.push(ref.pointer);
  } else {
    const pageCount = Math.ceil(ref.segmentCount / ARCHIVE_MAX_MANIFEST_ENTRIES);
    const seen = new Set();
    const claimAddress = (address) => {
      const normalized = nonzeroAddress(address, "Archive address");
      const key = normalized.toLowerCase();
      protocolAssert(
        !seen.has(key),
        "DUPLICATE_ARCHIVE_ADDRESS",
        "Archive addresses must not repeat",
      );
      seen.add(key);
      return normalized;
    };
    let pointer = ref.pointer;
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      claimAddress(pointer);
      const code = await getCode(pointer);
      const firstSegmentIndex = pageIndex * ARCHIVE_MAX_MANIFEST_ENTRIES;
      const entryCount = Math.min(
        ARCHIVE_MAX_MANIFEST_ENTRIES,
        ref.segmentCount - firstSegmentIndex,
      );
      assertRuntime(code, ARCHIVE_MANIFEST_HEADER_LENGTH + entryCount * 20);
      protocolAssert(
        code[1] === 0x44 && code[2] === 0x46 && code[3] === 0x42 && code[4] === 0x50,
        "INVALID_MANIFEST_MAGIC",
        "Manifest magic must be DFBP",
      );
      protocolAssert(code[5] === 1, "UNSUPPORTED_MANIFEST_VERSION", "Manifest version must be 1");
      protocolAssert(
        readUint32BE(code, 6) === pageIndex,
        "MANIFEST_PAGE_INDEX_MISMATCH",
        "Manifest pageIndex is out of order",
      );
      protocolAssert(
        readUint32BE(code, 10) === pageCount,
        "MANIFEST_PAGE_COUNT_MISMATCH",
        "Manifest pageCount does not match BlobRef",
      );
      protocolAssert(
        readUint32BE(code, 14) === firstSegmentIndex,
        "MANIFEST_FIRST_SEGMENT_MISMATCH",
        "Manifest firstSegmentIndex is out of order",
      );
      protocolAssert(
        readUint32BE(code, 18) === entryCount,
        "MANIFEST_ENTRY_COUNT_MISMATCH",
        "Manifest entryCount does not match page position",
      );
      protocolAssert(
        readUint64BE(code, 42) === BigInt(ref.payloadLength),
        "MANIFEST_PAYLOAD_LENGTH_MISMATCH",
        "Manifest payloadLength does not match BlobRef",
      );
      protocolAssert(
        readUint32BE(code, 50) === ref.segmentCount,
        "MANIFEST_SEGMENT_COUNT_MISMATCH",
        "Manifest segmentCount does not match BlobRef",
      );
      protocolAssert(
        equalBytesConstantTime(code.subarray(54, 86), getBytes(ref.payloadHash)),
        "MANIFEST_PAYLOAD_HASH_MISMATCH",
        "Manifest payloadHash does not match BlobRef",
      );
      const nextPage = assertAddress(hexlify(code.subarray(22, 42)), "nextPage");
      const isLastPage = pageIndex === pageCount - 1;
      protocolAssert(
        isLastPage ? nextPage === ZERO_ADDRESS : nextPage !== ZERO_ADDRESS,
        "INVALID_MANIFEST_NEXT_PAGE",
        "Manifest nextPage must link exactly the expected pages",
      );
      for (let index = 0; index < entryCount; index += 1) {
        const offset = ARCHIVE_MANIFEST_HEADER_LENGTH + index * 20;
        segments.push(claimAddress(hexlify(code.subarray(offset, offset + 20))));
      }
      pointer = nextPage;
    }
  }

  let payload;
  try {
    payload = new Uint8Array(ref.payloadLength);
  } catch (error) {
    throw new ProtocolError(
      "ARCHIVE_ALLOCATION_FAILED",
      "Archive payload exceeds this client's available memory",
      { cause: error },
    );
  }
  let cursor = 0;
  const worker = async () => {
    while (cursor < segments.length) {
      const index = cursor++;
      const code = await getCode(segments[index]);
      const offset = index * ARCHIVE_MAX_SEGMENT_PAYLOAD_LENGTH;
      const length = Math.min(ARCHIVE_MAX_SEGMENT_PAYLOAD_LENGTH, ref.payloadLength - offset);
      assertRuntime(code, length + 1);
      payload.set(code.subarray(1), offset);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, segments.length) }, worker));
  const payloadHash = keccak256(payload);
  protocolAssert(
    equalBytesConstantTime(getBytes(payloadHash), getBytes(ref.payloadHash)),
    "PAYLOAD_HASH_MISMATCH",
    "Logical payload keccak256 does not match BlobRef.payloadHash",
  );
  return { payload, payloadHash, payloadLength: payload.length, segmentCount: ref.segmentCount };
}

/** DFM dispatch happens after the generic Archive reader has verified all bytes. */
export async function readMetadataEnvelopeFromRef(input) {
  const blob = await readArchiveBlob(input);
  return { ...blob, envelope: blob.payload, prefix: parseEnvelopeCommonPrefix(blob.payload) };
}

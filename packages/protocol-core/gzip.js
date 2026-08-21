import { gzipSync, inflateSync } from "fflate";
import { MAX_CANONICAL_JSON_BYTES } from "./constants.js";
import { asUint8Array } from "./bytes.js";
import { ProtocolError, protocolAssert } from "./errors.js";

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DISTANCE_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12_289, 16_385, 24_577,
];
const DISTANCE_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[value] = crc >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  const input = asUint8Array(bytes);
  let crc = 0xffff_ffff;
  for (const byte of input) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffff_ffff) >>> 0;
}

class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.bitOffset = 0;
  }

  readBits(count) {
    protocolAssert(
      Number.isInteger(count) && count >= 0 && count <= 24,
      "INVALID_DEFLATE",
      "Invalid DEFLATE bit count",
    );
    protocolAssert(
      this.bitOffset + count <= this.bytes.length * 8,
      "TRUNCATED_DEFLATE",
      "Truncated DEFLATE stream",
    );
    let value = 0;
    for (let bit = 0; bit < count; bit += 1) {
      const sourceOffset = this.bitOffset + bit;
      value |= ((this.bytes[sourceOffset >>> 3] >>> (sourceOffset & 7)) & 1) << bit;
    }
    this.bitOffset += count;
    return value;
  }

  alignToByte() {
    this.bitOffset = (this.bitOffset + 7) & ~7;
  }

  skipBytes(count) {
    protocolAssert((this.bitOffset & 7) === 0, "INVALID_DEFLATE", "DEFLATE reader is not aligned");
    protocolAssert(
      this.bitOffset + count * 8 <= this.bytes.length * 8,
      "TRUNCATED_DEFLATE",
      "Truncated stored DEFLATE block",
    );
    this.bitOffset += count * 8;
  }
}

function reverseCode(value, width) {
  let reversed = 0;
  for (let index = 0; index < width; index += 1) {
    reversed = (reversed << 1) | ((value >>> index) & 1);
  }
  return reversed;
}

function buildHuffman(codeLengths, label) {
  let maximumLength = 0;
  const counts = [];
  for (const length of codeLengths) {
    protocolAssert(
      Number.isInteger(length) && length >= 0 && length <= 15,
      "INVALID_DEFLATE_HUFFMAN",
      `${label} has an invalid code length`,
    );
    if (length > 0) counts[length] = (counts[length] ?? 0) + 1;
    maximumLength = Math.max(maximumLength, length);
  }
  protocolAssert(maximumLength > 0, "INVALID_DEFLATE_HUFFMAN", `${label} has no symbols`);
  let available = 1;
  for (let width = 1; width <= maximumLength; width += 1) {
    available = available * 2 - (counts[width] ?? 0);
    protocolAssert(available >= 0, "INVALID_DEFLATE_HUFFMAN", `${label} is oversubscribed`);
  }
  const nextCode = [];
  let code = 0;
  for (let width = 1; width <= maximumLength; width += 1) {
    code = (code + (counts[width - 1] ?? 0)) << 1;
    nextCode[width] = code;
  }
  const symbols = Array.from({ length: maximumLength + 1 }, () => new Map());
  codeLengths.forEach((length, symbol) => {
    if (length === 0) return;
    const canonicalCode = nextCode[length];
    nextCode[length] += 1;
    symbols[length].set(reverseCode(canonicalCode, length), symbol);
  });
  return { maximumLength, symbols };
}

function decodeSymbol(reader, huffman, label) {
  let code = 0;
  for (let width = 1; width <= huffman.maximumLength; width += 1) {
    code |= reader.readBits(1) << (width - 1);
    const symbol = huffman.symbols[width].get(code);
    if (symbol !== undefined) return symbol;
  }
  throw new ProtocolError("INVALID_DEFLATE_HUFFMAN", `Invalid ${label} Huffman code`);
}

const FIXED_LITERAL_HUFFMAN = (() => {
  const lengths = new Array(288).fill(0);
  lengths.fill(8, 0, 144);
  lengths.fill(9, 144, 256);
  lengths.fill(7, 256, 280);
  lengths.fill(8, 280, 288);
  return buildHuffman(lengths, "fixed literal/length tree");
})();
const FIXED_DISTANCE_HUFFMAN = buildHuffman(new Array(32).fill(5), "fixed distance tree");

function readDynamicHuffman(reader) {
  const literalCount = reader.readBits(5) + 257;
  const distanceCount = reader.readBits(5) + 1;
  const codeLengthCount = reader.readBits(4) + 4;
  protocolAssert(literalCount <= 286, "INVALID_DEFLATE", "Too many literal/length codes");
  protocolAssert(distanceCount <= 32, "INVALID_DEFLATE", "Too many distance codes");
  const codeLengthLengths = new Array(19).fill(0);
  for (let index = 0; index < codeLengthCount; index += 1) {
    codeLengthLengths[CODE_LENGTH_ORDER[index]] = reader.readBits(3);
  }
  const codeLengthHuffman = buildHuffman(codeLengthLengths, "code-length tree");
  const total = literalCount + distanceCount;
  const lengths = [];
  while (lengths.length < total) {
    const symbol = decodeSymbol(reader, codeLengthHuffman, "code-length");
    if (symbol <= 15) {
      lengths.push(symbol);
      continue;
    }
    let repeated;
    let count;
    if (symbol === 16) {
      protocolAssert(lengths.length > 0, "INVALID_DEFLATE", "Repeat code has no previous length");
      repeated = lengths[lengths.length - 1];
      count = reader.readBits(2) + 3;
    } else if (symbol === 17) {
      repeated = 0;
      count = reader.readBits(3) + 3;
    } else if (symbol === 18) {
      repeated = 0;
      count = reader.readBits(7) + 11;
    } else {
      throw new ProtocolError("INVALID_DEFLATE", "Invalid code-length repeat symbol");
    }
    protocolAssert(
      lengths.length + count <= total,
      "INVALID_DEFLATE",
      "Code-length repeat exceeds target tree",
    );
    for (let index = 0; index < count; index += 1) lengths.push(repeated);
  }
  const literalLengths = lengths.slice(0, literalCount);
  const distanceLengths = lengths.slice(literalCount);
  protocolAssert(
    literalLengths[256] > 0,
    "INVALID_DEFLATE",
    "Literal/length tree does not contain end-of-block",
  );
  return {
    literal: buildHuffman(literalLengths, "dynamic literal/length tree"),
    distance: buildHuffman(distanceLengths, "dynamic distance tree"),
  };
}

function scanCompressedBlock(reader, literalHuffman, distanceHuffman, outputLength, maximumOutput) {
  let length = outputLength;
  while (true) {
    const symbol = decodeSymbol(reader, literalHuffman, "literal/length");
    if (symbol < 256) {
      length += 1;
    } else if (symbol === 256) {
      return length;
    } else {
      protocolAssert(symbol <= 285, "INVALID_DEFLATE", "Reserved DEFLATE length symbol");
      const lengthIndex = symbol - 257;
      const matchLength = LENGTH_BASE[lengthIndex] + reader.readBits(LENGTH_EXTRA[lengthIndex]);
      const distanceSymbol = decodeSymbol(reader, distanceHuffman, "distance");
      protocolAssert(distanceSymbol <= 29, "INVALID_DEFLATE", "Reserved DEFLATE distance symbol");
      const distance =
        DISTANCE_BASE[distanceSymbol] + reader.readBits(DISTANCE_EXTRA[distanceSymbol]);
      protocolAssert(
        distance > 0 && distance <= length,
        "INVALID_DEFLATE",
        "Invalid back-reference",
      );
      length += matchLength;
    }
    protocolAssert(
      length <= maximumOutput,
      "GZIP_OUTPUT_TOO_LARGE",
      `Decompressed plaintext exceeds ${maximumOutput} bytes`,
    );
  }
}

function scanDeflate(bytes, maximumOutput) {
  const reader = new BitReader(bytes);
  let outputLength = 0;
  let finalBlock = false;
  while (!finalBlock) {
    finalBlock = reader.readBits(1) === 1;
    const blockType = reader.readBits(2);
    if (blockType === 0) {
      reader.alignToByte();
      const length = reader.readBits(16);
      const complement = reader.readBits(16);
      protocolAssert(
        ((length ^ 0xffff) & 0xffff) === complement,
        "INVALID_DEFLATE",
        "Stored DEFLATE block length check failed",
      );
      reader.skipBytes(length);
      outputLength += length;
    } else if (blockType === 1) {
      outputLength = scanCompressedBlock(
        reader,
        FIXED_LITERAL_HUFFMAN,
        FIXED_DISTANCE_HUFFMAN,
        outputLength,
        maximumOutput,
      );
    } else if (blockType === 2) {
      const dynamic = readDynamicHuffman(reader);
      outputLength = scanCompressedBlock(
        reader,
        dynamic.literal,
        dynamic.distance,
        outputLength,
        maximumOutput,
      );
    } else {
      throw new ProtocolError("INVALID_DEFLATE", "Reserved DEFLATE block type");
    }
    protocolAssert(
      outputLength <= maximumOutput,
      "GZIP_OUTPUT_TOO_LARGE",
      `Decompressed plaintext exceeds ${maximumOutput} bytes`,
    );
  }
  const usedBits = reader.bitOffset & 7;
  if (usedBits !== 0) {
    const byte = bytes[reader.bitOffset >>> 3];
    const unusedMask = 0xff << usedBits;
    protocolAssert(
      (byte & unusedMask) === 0,
      "NONZERO_DEFLATE_PADDING",
      "Nonzero DEFLATE padding bits",
    );
  }
  return { compressedBytes: Math.ceil(reader.bitOffset / 8), outputLength };
}

function readUint32LE(bytes, offset) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function assertGzipV1Header(input) {
  protocolAssert(input.length >= 18, "TRUNCATED_GZIP", "gzip-v1 member is truncated");
  protocolAssert(
    input[0] === 0x1f && input[1] === 0x8b && input[2] === 8,
    "INVALID_GZIP_HEADER",
    "gzip-v1 requires gzip magic and DEFLATE compression",
  );
  protocolAssert(
    input[3] === 0,
    "GZIP_OPTIONAL_HEADER",
    "gzip-v1 forbids all optional header flags",
  );
  protocolAssert(
    input[4] === 0 && input[5] === 0 && input[6] === 0 && input[7] === 0,
    "NONZERO_GZIP_MTIME",
    "gzip-v1 requires mtime=0",
  );
  protocolAssert(input[8] === 0, "INVALID_GZIP_XFL", "gzip-v1 level 6 requires XFL=0");
}

export function gzipV1(bytes) {
  const input = asUint8Array(bytes, "gzip plaintext");
  protocolAssert(
    input.length <= MAX_CANONICAL_JSON_BYTES,
    "CANONICAL_JSON_TOO_LARGE",
    `gzip-v1 plaintext exceeds ${MAX_CANONICAL_JSON_BYTES} bytes`,
  );
  const compressed = gzipSync(input, { level: 6, mtime: 0 });
  assertGzipV1Header(compressed);
  return compressed;
}

export function gunzipV1Strict(bytes, options = {}) {
  const input = asUint8Array(bytes, "gzip-v1 bytes");
  const maximumOutput = options.maximumOutputBytes ?? MAX_CANONICAL_JSON_BYTES;
  protocolAssert(
    Number.isSafeInteger(maximumOutput) && maximumOutput >= 0,
    "INVALID_GZIP_LIMIT",
    "gzip output limit must be a nonnegative safe integer",
  );
  assertGzipV1Header(input);
  const candidateDeflate = input.subarray(10, input.length - 8);
  const scan = scanDeflate(candidateDeflate, maximumOutput);
  protocolAssert(
    scan.compressedBytes === candidateDeflate.length,
    "GZIP_TRAILING_DATA",
    "gzip-v1 must contain exactly one member with no trailing bytes",
  );
  const trailerOffset = input.length - 8;
  const expectedCrc = readUint32LE(input, trailerOffset);
  const expectedSize = readUint32LE(input, trailerOffset + 4);
  protocolAssert(
    scan.outputLength === expectedSize,
    "GZIP_ISIZE_MISMATCH",
    "gzip-v1 ISIZE does not match decompressed length",
  );
  let output;
  try {
    output = inflateSync(candidateDeflate, { out: new Uint8Array(scan.outputLength) });
  } catch (error) {
    throw new ProtocolError("INVALID_DEFLATE", "gzip-v1 DEFLATE stream is invalid", {
      cause: error,
    });
  }
  protocolAssert(
    output.length === scan.outputLength,
    "GZIP_ISIZE_MISMATCH",
    "Inflater output length does not match gzip-v1 ISIZE",
  );
  protocolAssert(crc32(output) === expectedCrc, "GZIP_CRC_MISMATCH", "gzip-v1 CRC32 check failed");
  return new Uint8Array(output);
}

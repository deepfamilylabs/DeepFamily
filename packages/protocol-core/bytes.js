import { getBytes, hexlify } from "ethers";
import { MAX_UINT256 } from "./constants.js";
import { ProtocolError, protocolAssert } from "./errors.js";

const textEncoder = new TextEncoder();

export function utf8Bytes(value) {
  protocolAssert(typeof value === "string", "INVALID_STRING", "Expected a string");
  assertUnicodeScalarString(value);
  return textEncoder.encode(value);
}

export function decodeUtf8Fatal(bytes) {
  const input = asUint8Array(bytes, "UTF-8 input");
  if (input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) {
    throw new ProtocolError("UTF8_BOM_FORBIDDEN", "UTF-8 BOM is not permitted");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
  } catch (error) {
    throw new ProtocolError("INVALID_UTF8", "Input is not valid UTF-8", { cause: error });
  }
}

export function assertUnicodeScalarString(value, label = "string") {
  protocolAssert(typeof value === "string", "INVALID_STRING", `${label} must be a string`);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new ProtocolError("ISOLATED_SURROGATE", `${label} contains an isolated surrogate`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new ProtocolError("ISOLATED_SURROGATE", `${label} contains an isolated surrogate`);
    }
  }
}

export function asUint8Array(value, label = "bytes") {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === "string") {
    try {
      return getBytes(value);
    } catch (error) {
      throw new ProtocolError("INVALID_HEX", `${label} must be valid 0x-prefixed hex`, {
        cause: error,
      });
    }
  }
  throw new ProtocolError("INVALID_BYTES", `${label} must be bytes or 0x-prefixed hex`);
}

export function copyBytes(value, label) {
  return new Uint8Array(asUint8Array(value, label));
}

export function concatBytes(...values) {
  const arrays = values.map((value) => asUint8Array(value));
  const output = new Uint8Array(arrays.reduce((sum, value) => sum + value.length, 0));
  let offset = 0;
  for (const value of arrays) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

export function bytesToHex(value) {
  return hexlify(asUint8Array(value));
}

export function equalBytesConstantTime(left, right) {
  const a = asUint8Array(left);
  const b = asUint8Array(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index % (a.length || 1)] ?? 0) ^ (b[index % (b.length || 1)] ?? 0);
  }
  return difference === 0;
}

export function equalHexConstantTime(left, right) {
  try {
    return equalBytesConstantTime(getBytes(left), getBytes(right));
  } catch {
    return false;
  }
}

export function bigintFrom(value, label = "integer", maximum = MAX_UINT256) {
  let parsed;
  if (typeof value === "bigint") {
    parsed = value;
  } else if (typeof value === "number") {
    protocolAssert(
      Number.isSafeInteger(value),
      "UNSAFE_INTEGER",
      `${label} must not pass through an unsafe JavaScript Number`,
    );
    parsed = BigInt(value);
  } else if (typeof value === "string") {
    protocolAssert(
      /^(0|[1-9][0-9]*)$/.test(value),
      "NON_CANONICAL_INTEGER",
      `${label} must be a canonical unsigned decimal integer`,
    );
    parsed = BigInt(value);
  } else {
    throw new ProtocolError("INVALID_INTEGER", `${label} must be bigint, safe number, or decimal`);
  }
  protocolAssert(
    parsed >= 0n && parsed <= maximum,
    "INTEGER_OUT_OF_RANGE",
    `${label} is out of range`,
  );
  return parsed;
}

export function readUint16BE(bytes, offset) {
  const input = asUint8Array(bytes);
  protocolAssert(
    offset >= 0 && offset + 2 <= input.length,
    "TRUNCATED_INTEGER",
    "Truncated uint16",
  );
  return (input[offset] << 8) | input[offset + 1];
}

export function readUint32BE(bytes, offset) {
  const input = asUint8Array(bytes);
  protocolAssert(
    offset >= 0 && offset + 4 <= input.length,
    "TRUNCATED_INTEGER",
    "Truncated uint32",
  );
  return (
    input[offset] * 0x1000000 +
    (input[offset + 1] << 16) +
    (input[offset + 2] << 8) +
    input[offset + 3]
  );
}

export function writeUint16BE(bytes, offset, value) {
  const input = asUint8Array(bytes);
  const parsed = Number(bigintFrom(value, "uint16", 0xffffn));
  protocolAssert(
    offset >= 0 && offset + 2 <= input.length,
    "TRUNCATED_INTEGER",
    "Truncated uint16",
  );
  input[offset] = parsed >>> 8;
  input[offset + 1] = parsed;
}

export function writeUint32BE(bytes, offset, value) {
  const input = asUint8Array(bytes);
  const parsed = Number(bigintFrom(value, "uint32", 0xffff_ffffn));
  protocolAssert(
    offset >= 0 && offset + 4 <= input.length,
    "TRUNCATED_INTEGER",
    "Truncated uint32",
  );
  input[offset] = parsed >>> 24;
  input[offset + 1] = parsed >>> 16;
  input[offset + 2] = parsed >>> 8;
  input[offset + 3] = parsed;
}

export function wipeBytes(value) {
  if (value instanceof Uint8Array) value.fill(0);
}

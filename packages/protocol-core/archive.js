import { getBytes, keccak256 } from "ethers";
import { DFM1_MAX_ENVELOPE_BYTES } from "./constants.js";
import { asUint8Array, bigintFrom, equalBytesConstantTime } from "./bytes.js";
import { normalizeBytes32 } from "./aad.js";
import { assertAddress } from "./identity.js";
import { parseEnvelopeCommonPrefix } from "./envelope.js";
import { ProtocolError, protocolAssert } from "./errors.js";

export function verifyMetadataRuntimeCode(input) {
  const runtimeCode = asUint8Array(input.runtimeCode, "data-contract runtime code");
  const payloadLengthBigInt = bigintFrom(input.payloadLength, "payloadLength", 0xffff_ffffn);
  protocolAssert(
    payloadLengthBigInt > 0n,
    "EMPTY_ARCHIVE_PAYLOAD",
    "Archive payloadLength must be nonzero",
  );
  protocolAssert(
    payloadLengthBigInt <= BigInt(DFM1_MAX_ENVELOPE_BYTES),
    "ENVELOPE_TOO_LARGE",
    `Archive payloadLength exceeds ${DFM1_MAX_ENVELOPE_BYTES} bytes`,
  );
  const payloadLength = Number(payloadLengthBigInt);
  protocolAssert(
    runtimeCode.length === payloadLength + 1,
    "RUNTIME_LENGTH_MISMATCH",
    "Data-contract runtime length must equal payloadLength + STOP byte",
  );
  protocolAssert(
    runtimeCode[0] === 0,
    "MISSING_STOP_PREFIX",
    "Data-contract runtime must begin with STOP",
  );
  const envelope = runtimeCode.slice(1);
  const expectedHash = normalizeBytes32(input.payloadHash, "payloadHash");
  const actualHash = keccak256(envelope);
  protocolAssert(
    equalBytesConstantTime(getBytes(actualHash), getBytes(expectedHash)),
    "PAYLOAD_HASH_MISMATCH",
    "Envelope keccak256 does not match MetadataRef.payloadHash",
  );
  const result = { envelope, payloadHash: actualHash, payloadLength };
  if (input.requireCommonPrefix) result.prefix = parseEnvelopeCommonPrefix(envelope);
  return result;
}

export async function readMetadataEnvelopeFromRef(input) {
  protocolAssert(
    typeof input.getCode === "function",
    "INVALID_GET_CODE",
    "getCode function is required",
  );
  const pointer = assertAddress(input.pointer, "metadata pointer");
  let runtimeCode;
  try {
    runtimeCode = await input.getCode(pointer, "latest");
  } catch (error) {
    throw new ProtocolError(
      "METADATA_CODE_READ_FAILED",
      "Failed to read metadata data-contract code",
      {
        cause: error,
      },
    );
  }
  return verifyMetadataRuntimeCode({
    runtimeCode,
    payloadLength: input.payloadLength,
    payloadHash: input.payloadHash,
    requireCommonPrefix: true,
  });
}

import { AbiCoder, getBytes, hexlify, keccak256 } from "ethers";
import {
  CIPHER_SUITE_AES_256_GCM,
  COMPRESSION_SUITE_GZIP_V1,
  DFM1_FORMAT_1,
  FILE_KDF_SUITE_ARGON2ID_CANDIDATE_1,
  MAX_UINT256,
  METADATA_CONTENT_AAD_DOMAIN,
  METADATA_CONTEXT_AAD_DOMAIN,
  METADATA_WRAP_AAD_DOMAIN,
  PLAINTEXT_CODEC_CANONICAL_JSON_V1,
  ZERO_ADDRESS,
  ZERO_BYTES32,
} from "./constants.js";
import { bigintFrom } from "./bytes.js";
import {
  assertAddress,
  assertFileKdfSuiteSupported,
  assertIdentitySuiteSupported,
} from "./identity.js";
import { ProtocolError, protocolAssert } from "./errors.js";

const abiCoder = AbiCoder.defaultAbiCoder();

export function normalizeBytes32(value, label = "bytes32") {
  try {
    const bytes = getBytes(value);
    protocolAssert(bytes.length === 32, "INVALID_BYTES32", `${label} must be 32 bytes`);
    return hexlify(bytes);
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError("INVALID_BYTES32", `${label} must be 32-byte hex`, { cause: error });
  }
}

export function normalizeMetadataContext(input) {
  protocolAssert(
    input && typeof input === "object",
    "INVALID_CONTEXT",
    "Metadata context is required",
  );
  const context = {
    chainId: bigintFrom(input.chainId, "chainId", MAX_UINT256),
    deepFamilyProxy: assertAddress(input.deepFamilyProxy, "deepFamilyProxy"),
    personHash: normalizeBytes32(input.personHash, "personHash"),
    fatherHash: normalizeBytes32(input.fatherHash, "fatherHash"),
    fatherVersionIndex: bigintFrom(input.fatherVersionIndex, "fatherVersionIndex", MAX_UINT256),
    motherHash: normalizeBytes32(input.motherHash, "motherHash"),
    motherVersionIndex: bigintFrom(input.motherVersionIndex, "motherVersionIndex", MAX_UINT256),
    versionCommitment: bigintFrom(input.versionCommitment, "versionCommitment", MAX_UINT256),
  };
  protocolAssert(
    context.deepFamilyProxy !== ZERO_ADDRESS,
    "ZERO_DEEP_FAMILY_PROXY",
    "deepFamilyProxy must be nonzero",
  );
  protocolAssert(
    context.personHash !== ZERO_BYTES32,
    "ZERO_PERSON_HASH",
    "personHash must be nonzero",
  );
  protocolAssert(
    context.fatherHash !== ZERO_BYTES32 || context.fatherVersionIndex === 0n,
    "INVALID_FATHER_REFERENCE",
    "A zero father hash requires zero fatherVersionIndex",
  );
  protocolAssert(
    context.motherHash !== ZERO_BYTES32 || context.motherVersionIndex === 0n,
    "INVALID_MOTHER_REFERENCE",
    "A zero mother hash requires zero motherVersionIndex",
  );
  return context;
}

function fixedSelector(value, expected, label) {
  const parsed = Number(bigintFrom(value, label, 0xffn));
  protocolAssert(parsed === expected, "UNSUPPORTED_SELECTOR", `${label} must be ${expected}`);
  return parsed;
}

export function computeFormat1Aad(input) {
  const context = normalizeMetadataContext(input.context);
  const identitySuiteId = assertIdentitySuiteSupported(input.identitySuiteId);
  const formatVersion = fixedSelector(
    input.formatVersion ?? DFM1_FORMAT_1,
    DFM1_FORMAT_1,
    "formatVersion",
  );
  const plaintextCodec = fixedSelector(
    input.plaintextCodec ?? PLAINTEXT_CODEC_CANONICAL_JSON_V1,
    PLAINTEXT_CODEC_CANONICAL_JSON_V1,
    "plaintextCodec",
  );
  const compressionSuite = fixedSelector(
    input.compressionSuite ?? COMPRESSION_SUITE_GZIP_V1,
    COMPRESSION_SUITE_GZIP_V1,
    "compressionSuite",
  );
  const cipherSuite = fixedSelector(
    input.cipherSuite ?? CIPHER_SUITE_AES_256_GCM,
    CIPHER_SUITE_AES_256_GCM,
    "cipherSuite",
  );
  const kdfSuite = assertFileKdfSuiteSupported(
    input.kdfSuite ?? FILE_KDF_SUITE_ARGON2ID_CANDIDATE_1,
  );
  const contextPreimage = getBytes(
    abiCoder.encode(
      [
        "bytes32",
        "uint256",
        "address",
        "bytes32",
        "bytes32",
        "uint256",
        "bytes32",
        "uint256",
        "uint256",
        "uint32",
        "uint8",
        "uint8",
        "uint8",
        "uint8",
        "uint8",
      ],
      [
        METADATA_CONTEXT_AAD_DOMAIN,
        context.chainId,
        context.deepFamilyProxy,
        context.personHash,
        context.fatherHash,
        context.fatherVersionIndex,
        context.motherHash,
        context.motherVersionIndex,
        context.versionCommitment,
        identitySuiteId,
        formatVersion,
        plaintextCodec,
        compressionSuite,
        cipherSuite,
        kdfSuite,
      ],
    ),
  );
  protocolAssert(
    contextPreimage.length === 15 * 32,
    "INVALID_AAD_PREIMAGE",
    "Format 1 context AAD preimage must be exactly 15 ABI words",
  );
  const contextHash = keccak256(contextPreimage);
  const wrapPreimage = getBytes(
    abiCoder.encode(["bytes32", "bytes32"], [METADATA_WRAP_AAD_DOMAIN, contextHash]),
  );
  const contentPreimage = getBytes(
    abiCoder.encode(["bytes32", "bytes32"], [METADATA_CONTENT_AAD_DOMAIN, contextHash]),
  );
  return {
    context,
    identitySuiteId,
    formatVersion,
    plaintextCodec,
    compressionSuite,
    cipherSuite,
    kdfSuite,
    contextPreimage,
    contextHash,
    wrapAAD: getBytes(keccak256(wrapPreimage)),
    contentAAD: getBytes(keccak256(contentPreimage)),
  };
}

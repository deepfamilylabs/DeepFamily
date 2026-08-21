import { keccak256, toUtf8Bytes } from "ethers";

export const PROTOCOL_GENERATION = "df-onchain-biography-v1";
export const PERSON_VERSION_SCHEMA = "deepfamily/person-version@1.0";

export const DFM1_MAGIC_TEXT = "DFM1";
export const DFM1_MAGIC_BYTES = Uint8Array.of(0x44, 0x46, 0x4d, 0x31);
export const DFM1_COMMON_PREFIX_BYTES = 20;
export const DFM1_FORMAT_1 = 1;
export const DFM1_FORMAT_1_HEADER_BYTES = 112;
export const DFM1_FORMAT_1_OVERHEAD_BYTES = 128;
export const DFM1_MAX_ENVELOPE_BYTES = 16_384;
export const DFM1_MAX_CONTENT_CIPHERTEXT_BYTES = 16_256;

export const PLAINTEXT_CODEC_CANONICAL_JSON_V1 = 1;
export const COMPRESSION_SUITE_GZIP_V1 = 1;
export const CIPHER_SUITE_AES_256_GCM = 1;
export const FILE_KDF_SUITE_ARGON2ID_CANDIDATE_1 = 1;
export const IDENTITY_SUITE_CANDIDATE_1 = 1;

export const MAX_CANONICAL_JSON_BYTES = 1_048_576;
export const MAX_TAG_UTF8_BYTES = 256;
export const MAX_FULL_NAME_UTF8_BYTES = 256;

export const FILE_SALT_BYTES = 16;
export const AES_KEY_BYTES = 32;
export const AES_GCM_IV_BYTES = 12;
export const AES_GCM_TAG_BYTES = 16;

export const ARGON2_VERSION = 0x13;
export const CANDIDATE_ARGON2ID_PROFILE = Object.freeze({
  status: "candidate-awaiting-device-benchmark",
  provisional: true,
  algorithm: "Argon2id",
  version: ARGON2_VERSION,
  memoryKiB: 65_536,
  iterations: 3,
  parallelism: 1,
  outputBytes: 32,
  saltBytes: 16,
});

export const IDENTITY_PASSWORD_DOMAIN = "DeepFamily:IdentityKDF:v1";
export const FILE_PASSWORD_DOMAIN = "DeepFamily:FileKDF:v1";
export const IDENTITY_SALT_DOMAIN = "deepfamily:identity-kdf-salt:v1";
export const NAME_PREHASH_DOMAIN = "deepfamily:name-prehash:v2";

export const DOMAIN_SUITE = 1000n;
export const DOMAIN_NAME_SECRET = 1001n;
export const DOMAIN_IDENTITY = 1002n;
export const DOMAIN_DISCLOSURE = 1003n;
export const DOMAIN_VERSION_COMMITMENT = 1004n;

export const SNARK_SCALAR_FIELD = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617",
);
export const MAX_UINT8 = (1n << 8n) - 1n;
export const MAX_UINT16 = (1n << 16n) - 1n;
export const MAX_UINT32 = (1n << 32n) - 1n;
export const MAX_UINT128 = (1n << 128n) - 1n;
export const MAX_UINT160 = (1n << 160n) - 1n;
export const MAX_UINT256 = (1n << 256n) - 1n;

export const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
export const ZERO_ADDRESS = `0x${"00".repeat(20)}`;

export const METADATA_CONTEXT_AAD_DOMAIN_TEXT = "DeepFamily:MetadataContext:v1";
export const METADATA_WRAP_AAD_DOMAIN_TEXT = "DeepFamily:MetadataWrapAAD:v1";
export const METADATA_CONTENT_AAD_DOMAIN_TEXT = "DeepFamily:MetadataContentAAD:v1";
export const VERSION_HASH_DOMAIN_TEXT = "DeepFamily:VersionHash:v1";

export const METADATA_CONTEXT_AAD_DOMAIN = keccak256(toUtf8Bytes(METADATA_CONTEXT_AAD_DOMAIN_TEXT));
export const METADATA_WRAP_AAD_DOMAIN = keccak256(toUtf8Bytes(METADATA_WRAP_AAD_DOMAIN_TEXT));
export const METADATA_CONTENT_AAD_DOMAIN = keccak256(toUtf8Bytes(METADATA_CONTENT_AAD_DOMAIN_TEXT));
export const VERSION_HASH_DOMAIN = keccak256(toUtf8Bytes(VERSION_HASH_DOMAIN_TEXT));

// The KDF profile is deliberately marked provisional until the required device
// matrix and attacker-cost studies have been completed. Suite ID 1 must not be
// described as production-frozen while this flag is true.
export const PROTOCOL_IMPLEMENTATION_STATUS = Object.freeze({
  releaseStatus: "development",
  identitySuite1: CANDIDATE_ARGON2ID_PROFILE.status,
  fileKdfSuite1: CANDIDATE_ARGON2ID_PROFILE.status,
  productionFrozen: false,
});

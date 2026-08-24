export type BigNumberish = bigint | number | string;
export type BytesLike = Uint8Array | ArrayBuffer | ArrayBufferView | string;
/** Must return a fresh disposable buffer; encryption copies and immediately zeroes it. */
export type RandomBytes = (length: number) => Uint8Array;

export interface IdentityFields {
  fullName: string;
  gender: BigNumberish;
  birthYear: BigNumberish;
  birthMonth: BigNumberish;
  birthDay: BigNumberish;
  isBirthBC: boolean;
}

export interface CanonicalIdentityFields {
  fullName: string;
  gender: number;
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  isBirthBC: boolean;
}

export interface MetadataIdentity extends CanonicalIdentityFields {
  personHash: string;
}

export interface MetadataParent extends MetadataIdentity {
  versionIndex: bigint;
}

export interface PersonVersionMetadata {
  schema: "deepfamily/person-version@1.0";
  person: MetadataIdentity;
  parents: {
    father: MetadataParent | null;
    mother: MetadataParent | null;
  };
  tag: string;
  biography: string;
}

export interface PersonVersionMetadataInput {
  schema: "deepfamily/person-version@1.0";
  person: MetadataIdentity;
  parents: {
    father: (Omit<MetadataParent, "versionIndex"> & { versionIndex: BigNumberish }) | null;
    mother: (Omit<MetadataParent, "versionIndex"> & { versionIndex: BigNumberish }) | null;
  };
  tag: string;
  biography: string;
}

export interface MetadataContextInput {
  chainId: BigNumberish;
  deepFamilyProxy: string;
  personHash: string;
  fatherHash: string;
  fatherVersionIndex: BigNumberish;
  motherHash: string;
  motherVersionIndex: BigNumberish;
  versionCommitment: BigNumberish;
}

export interface MetadataContext {
  chainId: bigint;
  deepFamilyProxy: string;
  personHash: string;
  fatherHash: string;
  fatherVersionIndex: bigint;
  motherHash: string;
  motherVersionIndex: bigint;
  versionCommitment: bigint;
}

export interface EnvelopeCommonPrefix {
  readonly magic: "DFM1";
  readonly formatVersion: number;
  readonly identitySuiteId: number;
  readonly envelopeLength: number;
}

export interface ParsedFormat1Envelope extends EnvelopeCommonPrefix {
  readonly flags: 0;
  readonly plaintextCodec: 1;
  readonly compressionSuite: 1;
  readonly cipherSuite: 1;
  readonly kdfSuite: 1;
  readonly headerLength: 112;
  readonly contentCiphertextLength: number;
  readonly reserved: 0;
  readonly fileSalt: Uint8Array;
  readonly wrapIV: Uint8Array;
  readonly contentIV: Uint8Array;
  readonly wrappedDEK: Uint8Array;
  readonly wrappedDEKTag: Uint8Array;
  readonly contentCiphertext: Uint8Array;
  readonly contentTag: Uint8Array;
}

export interface IdentityMaterial {
  identitySuiteId: number;
  identity: CanonicalIdentityFields;
  identitySalt: Uint8Array;
  derivedSecretBytes: Uint8Array;
  derivedSecretField: bigint;
  nameField: bigint;
  packedBirthGenderField: bigint;
  suiteCommitment: bigint;
  nameSecretCommitment: bigint;
  identityCommitment: bigint;
  personHash: string;
}

export interface ValidatedPersonVersion {
  metadata: PersonVersionMetadata;
  formatVersion: 1;
  identitySuiteId: number;
  payloadHash: string;
  versionCommitment: bigint;
  metadataUnlockValidated: true;
  protocolGeneration: string;
}

export class ProtocolError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions);
}
export class UnsupportedProtocolError extends ProtocolError {}
export function protocolAssert(
  condition: unknown,
  code: string,
  message: string,
): asserts condition;

export const PROTOCOL_GENERATION: "df-onchain-biography-v1";
export const PERSON_VERSION_SCHEMA: "deepfamily/person-version@1.0";
export const DFM1_MAGIC_TEXT: "DFM1";
export const DFM1_MAGIC_BYTES: Uint8Array;
export const DFM1_COMMON_PREFIX_BYTES: 20;
export const DFM1_FORMAT_1: 1;
export const DFM1_FORMAT_1_HEADER_BYTES: 112;
export const DFM1_FORMAT_1_OVERHEAD_BYTES: 128;
export const DFM1_MAX_ENVELOPE_BYTES: 16384;
export const DFM1_MAX_CONTENT_CIPHERTEXT_BYTES: 16256;
export const PLAINTEXT_CODEC_CANONICAL_JSON_V1: 1;
export const COMPRESSION_SUITE_GZIP_V1: 1;
export const CIPHER_SUITE_AES_256_GCM: 1;
export const FILE_KDF_SUITE_ARGON2ID_CANDIDATE_1: 1;
export const IDENTITY_SUITE_CANDIDATE_1: 1;
export const MAX_CANONICAL_JSON_BYTES: 1048576;
export const MAX_TAG_UTF8_BYTES: 256;
export const MAX_FULL_NAME_UTF8_BYTES: 256;
export const FILE_SALT_BYTES: 16;
export const AES_KEY_BYTES: 32;
export const AES_GCM_IV_BYTES: 12;
export const AES_GCM_TAG_BYTES: 16;
export const ARGON2_VERSION: 19;
export const CANDIDATE_ARGON2ID_PROFILE: Readonly<{
  status: "candidate-awaiting-device-benchmark";
  provisional: true;
  algorithm: "Argon2id";
  version: 19;
  memoryKiB: 65536;
  iterations: 3;
  parallelism: 1;
  outputBytes: 32;
  saltBytes: 16;
}>;
export const PROTOCOL_IMPLEMENTATION_STATUS: Readonly<{
  releaseStatus: "development";
  identitySuite1: "candidate-awaiting-device-benchmark";
  fileKdfSuite1: "candidate-awaiting-device-benchmark";
  productionFrozen: false;
}>;
export const IDENTITY_PASSWORD_DOMAIN: string;
export const FILE_PASSWORD_DOMAIN: string;
export const IDENTITY_SALT_DOMAIN: string;
export const NAME_PREHASH_DOMAIN: string;
export const DOMAIN_SUITE: 1000n;
export const DOMAIN_NAME_SECRET: 1001n;
export const DOMAIN_IDENTITY: 1002n;
export const DOMAIN_DISCLOSURE: 1003n;
export const DOMAIN_VERSION_COMMITMENT: 1004n;
export const SNARK_SCALAR_FIELD: bigint;
export const MAX_UINT8: bigint;
export const MAX_UINT16: bigint;
export const MAX_UINT32: bigint;
export const MAX_UINT128: bigint;
export const MAX_UINT160: bigint;
export const MAX_UINT256: bigint;
export const ZERO_BYTES32: string;
export const ZERO_ADDRESS: string;
export const METADATA_CONTEXT_AAD_DOMAIN_TEXT: string;
export const METADATA_WRAP_AAD_DOMAIN_TEXT: string;
export const METADATA_CONTENT_AAD_DOMAIN_TEXT: string;
export const VERSION_HASH_DOMAIN_TEXT: string;
export const METADATA_CONTEXT_AAD_DOMAIN: string;
export const METADATA_WRAP_AAD_DOMAIN: string;
export const METADATA_CONTENT_AAD_DOMAIN: string;
export const VERSION_HASH_DOMAIN: string;

export function utf8Bytes(value: string): Uint8Array;
export function decodeUtf8Fatal(bytes: BytesLike): string;
export function assertUnicodeScalarString(value: string, label?: string): void;
export function asUint8Array(value: BytesLike, label?: string): Uint8Array;
export function copyBytes(value: BytesLike, label?: string): Uint8Array;
export function concatBytes(...values: BytesLike[]): Uint8Array;
export function bytesToHex(value: BytesLike): string;
export function equalBytesConstantTime(left: BytesLike, right: BytesLike): boolean;
export function equalHexConstantTime(left: string, right: string): boolean;
export function bigintFrom(value: BigNumberish, label?: string, maximum?: bigint): bigint;
export function readUint16BE(bytes: BytesLike, offset: number): number;
export function readUint32BE(bytes: BytesLike, offset: number): number;
export function writeUint16BE(bytes: Uint8Array, offset: number, value: BigNumberish): void;
export function writeUint32BE(bytes: Uint8Array, offset: number, value: BigNumberish): void;
export function wipeBytes(value: unknown): void;

export const UNICODE_WHITE_SPACE_VERSION: "17.0.0";
export const UNICODE_NORMALIZATION_VERSION: "17.0.0";
export function normalizeUnicodeNfkd(value: string, label?: string): string;
export function normalizeUnicodeNfkc(value: string, label?: string): string;
export function canonicalizeFullName(value: string): string;
export function isUnicodeWhiteSpaceOnly(value: string): boolean;
export function escapeCanonicalJsonString(value: string): string;
export function validateCanonicalPersonVersion(
  value: PersonVersionMetadataInput,
): PersonVersionMetadata;
export function serializeCanonicalPersonVersion(value: PersonVersionMetadataInput): Uint8Array;
export function parseCanonicalPersonVersion(bytes: Uint8Array): PersonVersionMetadata;

export function normalizeIdentityFields(input: IdentityFields): CanonicalIdentityFields;
export function packBirthGenderField(input: IdentityFields): bigint;
export function assertIdentitySuiteSupported(identitySuiteId: BigNumberish): number;
export function assertFileKdfSuiteSupported(kdfSuite: BigNumberish): number;
export function normalizePassphrase(rawPassphrase: string): string;
export function buildDomainSeparatedPasswordBytes(
  domain: string,
  rawPassphrase: string,
): Uint8Array;
export function buildIdentityPasswordBytes(rawPassphrase: string): Uint8Array;
export function buildFilePasswordBytes(rawPassphrase: string): Uint8Array;
export function deriveDeterministicIdentitySalt(
  input: IdentityFields,
  identitySuiteId?: BigNumberish,
): Uint8Array;
export function deriveIdentitySecretBytes(input: {
  identity: IdentityFields;
  rawPassphrase: string;
  identitySuiteId?: BigNumberish;
}): Promise<Uint8Array>;
export function deriveFileKekBytes(input: {
  rawPassphrase: string;
  fileSalt: BytesLike;
  kdfSuite?: BigNumberish;
}): Promise<Uint8Array>;
export function mapBytesToSnarkField(bytes: BytesLike): bigint;
export function computeNameField(canonicalFullName: string): bigint;
export function computeSuiteCommitment(identitySuiteId: BigNumberish): bigint;
export function computeDisclosureBinding(input: {
  nameField: BigNumberish;
  packedBirthGenderField: BigNumberish;
  suiteCommitment: BigNumberish;
}): bigint;
export function computeIdentityFromDerivedSecret(input: {
  identity: IdentityFields;
  identitySuiteId: BigNumberish;
  derivedSecretField: BigNumberish;
}): Omit<IdentityMaterial, "identitySalt" | "derivedSecretBytes">;
export function deriveIdentityMaterial(input: {
  identity: IdentityFields;
  rawPassphrase: string;
  identitySuiteId?: BigNumberish;
}): Promise<IdentityMaterial>;
export function assertAddress(value: string, label?: string): string;

export function computeContentDigest(canonicalJsonBytes: BytesLike): {
  contentDigest: string;
  contentDigestBytes: Uint8Array;
  contentDigestLo: bigint;
  contentDigestHi: bigint;
};
export function computeVersionCommitment(input: {
  derivedSecretField: BigNumberish;
  contentDigestLo: BigNumberish;
  contentDigestHi: BigNumberish;
}): bigint;
export function computeVersionHash(input: {
  personHash: string;
  fatherHash: string;
  fatherVersionIndex: BigNumberish;
  motherHash: string;
  motherVersionIndex: BigNumberish;
  versionCommitment: BigNumberish;
}): string;
export function packSubmitterAndSelfSuiteId(submitter: string, selfSuiteId: BigNumberish): bigint;
export function unpackSubmitterAndSelfSuiteId(value: BigNumberish): {
  submitter: string;
  selfSuiteId: number;
};
export function assertSubmitterAndSelfSuiteId(input: {
  submitterAndSelfSuiteId: BigNumberish;
  expectedSubmitter?: string;
  expectedSelfSuiteId?: BigNumberish;
}): { submitter: string; selfSuiteId: number };

export function normalizeBytes32(value: string, label?: string): string;
export function normalizeMetadataContext(input: MetadataContextInput): MetadataContext;
export function computeFormat1Aad(input: {
  context: MetadataContextInput;
  identitySuiteId: BigNumberish;
  formatVersion?: BigNumberish;
  plaintextCodec?: BigNumberish;
  compressionSuite?: BigNumberish;
  cipherSuite?: BigNumberish;
  kdfSuite?: BigNumberish;
}): {
  context: MetadataContext;
  identitySuiteId: number;
  formatVersion: 1;
  plaintextCodec: 1;
  compressionSuite: 1;
  cipherSuite: 1;
  kdfSuite: 1;
  contextPreimage: Uint8Array;
  contextHash: string;
  wrapAAD: Uint8Array;
  contentAAD: Uint8Array;
};

export function crc32(bytes: BytesLike): number;
export function gzipV1(bytes: BytesLike): Uint8Array;
export function gunzipV1Strict(
  bytes: BytesLike,
  options?: { maximumOutputBytes?: number },
): Uint8Array;

export function parseEnvelopeCommonPrefix(envelope: BytesLike): EnvelopeCommonPrefix;
export function parseFormat1Envelope(envelope: BytesLike): ParsedFormat1Envelope;
export function parseMetadataEnvelope(envelope: BytesLike): ParsedFormat1Envelope;
export function assembleFormat1Envelope(input: {
  identitySuiteId?: BigNumberish;
  fileSalt: BytesLike;
  wrapIV: BytesLike;
  contentIV: BytesLike;
  wrappedDEK: BytesLike;
  wrappedDEKTag: BytesLike;
  contentCiphertext: BytesLike;
  contentTag: BytesLike;
}): Uint8Array;
export function encryptFormat1Compressed(input: {
  compressedPlaintext: BytesLike;
  rawPassphrase: string;
  identitySuiteId?: BigNumberish;
  context: MetadataContextInput;
  randomBytes?: RandomBytes;
}): Promise<{ envelope: Uint8Array; payloadHash: string; header: ParsedFormat1Envelope }>;
export function decryptFormat1Compressed(input: {
  envelope: BytesLike;
  rawPassphrase: string;
  context: MetadataContextInput;
}): Promise<{ compressedPlaintext: Uint8Array; header: ParsedFormat1Envelope }>;
export function computePayloadHash(envelope: BytesLike): string;

export function verifyMetadataRuntimeCode(input: {
  runtimeCode: BytesLike;
  payloadLength: BigNumberish;
  payloadHash: string;
  requireCommonPrefix?: boolean;
}): {
  envelope: Uint8Array;
  payloadHash: string;
  payloadLength: number;
  prefix?: EnvelopeCommonPrefix;
};
export function readMetadataEnvelopeFromRef(input: {
  getCode: (pointer: string, blockTag: "latest") => Promise<BytesLike>;
  pointer: string;
  payloadLength: BigNumberish;
  payloadHash: string;
}): Promise<{
  envelope: Uint8Array;
  payloadHash: string;
  payloadLength: number;
  prefix: EnvelopeCommonPrefix;
}>;

export function assertMetadataMatchesContext(
  metadata: PersonVersionMetadata,
  context: MetadataContextInput,
): MetadataContext;
export function computePersonVersionContentCommitment(input: {
  metadata: PersonVersionMetadataInput;
  derivedSecretField: BigNumberish;
}): {
  canonicalJsonBytes: Uint8Array;
  contentDigest: string;
  contentDigestBytes: Uint8Array;
  contentDigestLo: bigint;
  contentDigestHi: bigint;
  versionCommitment: bigint;
};
export function compressPersonVersionContent(canonicalJsonBytes: BytesLike): Uint8Array;
export function wipePreparedPersonVersionContent(prepared: object | null | undefined): void;
export function encryptPersonVersionEnvelope(input: {
  metadata: PersonVersionMetadataInput;
  rawPassphrase: string;
  identitySuiteId?: BigNumberish;
  context: MetadataContextInput;
  randomBytes?: RandomBytes;
}): Promise<{
  envelope: Uint8Array;
  payloadHash: string;
  formatVersion: 1;
  identitySuiteId: number;
  envelopeLength: number;
  canonicalJsonLength: number;
  compressedPlaintextLength: number;
}>;
export function decryptPersonVersionEnvelope(input: {
  envelope: BytesLike;
  rawPassphrase: string;
  context: MetadataContextInput;
}): Promise<ValidatedPersonVersion>;
export function roundTripPersonVersionEnvelope(input: {
  envelope: BytesLike;
  rawPassphrase: string;
  context: MetadataContextInput;
  expectedMetadata: PersonVersionMetadataInput;
  submitterAndSelfSuiteId?: BigNumberish;
  expectedSubmitter?: string;
}): Promise<ValidatedPersonVersion>;
export function decryptPersonVersionRuntime(input: {
  runtimeCode: BytesLike;
  payloadLength: BigNumberish;
  payloadHash: string;
  rawPassphrase: string;
  context: MetadataContextInput;
}): Promise<ValidatedPersonVersion>;
export function readAndDecryptPersonVersion(input: {
  getCode: (pointer: string, blockTag: "latest") => Promise<BytesLike>;
  pointer: string;
  payloadLength: BigNumberish;
  payloadHash: string;
  rawPassphrase: string;
  context: MetadataContextInput;
}): Promise<ValidatedPersonVersion>;
export function computePreparedVersionHash(input: {
  context: MetadataContextInput;
  versionCommitment: BigNumberish;
}): string;

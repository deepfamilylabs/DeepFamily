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

/**
 * `versionIndex` is deliberately `bigint`, not `BigNumberish`:
 * assertMetadataMatchesContext compares it by strict equality against a context
 * normalized to bigint, so a `number` would fail at runtime even when the values
 * are equal. Keep the declared type as strict as that comparison.
 */
export interface PersonVersionMetadataInput {
  schema: "deepfamily/person-version@1.0";
  person: MetadataIdentity;
  parents: {
    father: MetadataParent | null;
    mother: MetadataParent | null;
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
export const DOMAIN_LINEAGE_ENDORSEMENT_LEAF: 1007n;
export const DOMAIN_LINEAGE_TRUSTED_LEAF: 1008n;
export const DOMAIN_LINEAGE_PARENTS: 1009n;
export const LINEAGE_ENDORSEMENT_TREE_ID: 0;
export const LINEAGE_TRUSTED_TREE_ID: 1;
export const LINEAGE_TREE_MAX_DEPTH: 64;
export const INHERITANCE_PERIOD_SECONDS: bigint;
export const SNARK_SCALAR_FIELD: bigint;
export const MAX_UINT8: bigint;
export const MAX_UINT16: bigint;
export const MAX_UINT32: bigint;
export const MAX_UINT64: bigint;
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
export function normalizeUnicodeNfd(value: string, label?: string): string;
export function normalizeUnicodeNfc(value: string, label?: string): string;
export function mapNonAsciiSpacesToAscii(value: string, label?: string): string;
export function canonicalCombiningClass(codePoint: number): number;
export const PRECIS_UNICODE_VERSION: "17.0.0";
export function assertFreeformClass(value: string, label?: string): void;
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
export function gzipV1(bytes: BytesLike, options?: { maximumInputBytes?: number }): Uint8Array;
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

export interface BlobRef {
  payloadHash: string;
  pointer: string;
  payloadLength: BigNumberish;
  segmentCount: BigNumberish;
}
export interface StoryRecordRef {
  blob: BlobRef;
  schemaId: string;
  author: string;
  timestamp: BigNumberish;
}
export interface StoryState {
  recordsHead: string;
  totalRecords: BigNumberish;
  totalPayloadLength: BigNumberish;
  lastUpdateTime: BigNumberish;
  isSealed: boolean;
}
export interface ArchiveReadOptions {
  getCode: (pointer: string, blockTag: string | number) => Promise<BytesLike>;
  concurrency?: number;
  blockTag?: string | number;
}
export interface VerifiedArchiveBlob {
  payload: Uint8Array;
  payloadHash: string;
  payloadLength: number;
  segmentCount: number;
}
export const ARCHIVE_MAX_SEGMENT_PAYLOAD_LENGTH: 16384;
export const ARCHIVE_MAX_MANIFEST_ENTRIES: 1024;
export const ARCHIVE_MANIFEST_HEADER_LENGTH: 86;
export const ARCHIVE_DEFAULT_READ_CONCURRENCY: 8;
export function predictArchiveSegmentCount(payloadLength: BigNumberish): number;
export function readArchiveBlob(input: BlobRef & ArchiveReadOptions): Promise<VerifiedArchiveBlob>;
export function readMetadataEnvelopeFromRef(input: BlobRef & ArchiveReadOptions): Promise<
  VerifiedArchiveBlob & {
    envelope: Uint8Array;
    prefix: EnvelopeCommonPrefix;
  }
>;

export const STORY_RECORD_SCHEMA: "deepfamily/story-record@1.0";
export const STORY_ENVELOPE_SCHEMA_ID: string;
export const STORY_ENVELOPE_SCHEMA: "deepfamily/story-envelope@1.0";
export const STORY_BIOGRAPHY_SCHEMA: "deepfamily/story-biography-envelope@1.0";
export const STORY_BIOGRAPHY_SCHEMA_ID: string;
export const STORY_ENVELOPE_MAGIC_TEXT: "DFSE";
export const STORY_ENVELOPE_MAGIC_BYTES: Uint8Array;
export const STORY_ENVELOPE_FORMAT_1: 1;
export const STORY_ENVELOPE_HEADER_BYTES: 48;
export const STORY_ENVELOPE_OFFSETS: Readonly<Record<string, number>>;
export const STORY_DEFAULT_COMPRESSION_SUITE: 1;
export const STORY_MAX_CANONICAL_JSON_BYTES: 16777216;
export const STORY_MAX_ATTACHMENT_URI_BYTES: 256;
export const STORY_RECORD_DOMAIN_TEXT: "deepfamily.archive.story-record.v1";
export const STORY_HEAD_DOMAIN_TEXT: "deepfamily.archive.story-head.v1";
export const STORY_RECORD_DOMAIN: string;
export const STORY_HEAD_DOMAIN: string;
export interface StoryRecordInput {
  schema?: "deepfamily/story-record@1.0";
  title: string;
  content: string;
  recordType: number;
  attachmentURI: string;
}
export interface DecodedStoryRecord extends StoryRecordInput {
  schema: "deepfamily/story-record@1.0";
}
export function encodeCanonicalStoryRecord(input: StoryRecordInput): Uint8Array;
export function decodeCanonicalStoryRecord(payload: BytesLike): DecodedStoryRecord;
export function encodeStoryRecord(
  input: StoryRecordInput,
  options?: { compressionSuite?: number },
): Uint8Array;
export function decodeStoryRecord(payload: BytesLike): DecodedStoryRecord;
export function inspectStoryEnvelope(payload: BytesLike): {
  formatVersion: number;
  plaintextCodec: number;
  compressionSuite: number;
  flags: number;
  originalLength: number;
  originalHash: string;
  body: Uint8Array;
};
export function readStoryRecord(
  input: ArchiveReadOptions & {
    recordRef: StoryRecordRef;
  },
): Promise<
  VerifiedArchiveBlob & {
    schemaId: string;
    author: string;
    timestamp: bigint;
    decoded: DecodedStoryRecord | null;
    unsupportedReason?: string;
  }
>;
export interface StoryRecordCommitmentInput {
  chainId: BigNumberish;
  archive: string;
  tokenId: BigNumberish;
  index: BigNumberish;
  schemaId: string;
  payloadHash: string;
  payloadLength: BigNumberish;
  author: string;
  timestamp: BigNumberish;
}
export function computeStoryRecordHash(input: StoryRecordCommitmentInput): string;
export function computeStoryHead(input: { previousHead: string; recordHash: string }): string;

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
export function readAndDecryptPersonVersion(
  input: BlobRef &
    ArchiveReadOptions & {
      rawPassphrase: string;
      context: MetadataContextInput;
    },
): Promise<ValidatedPersonVersion>;
export function computePreparedVersionHash(input: {
  context: MetadataContextInput;
  versionCommitment: BigNumberish;
}): string;

export interface LineageTree {
  readonly root: bigint;
  readonly depth: number;
  readonly size: number | bigint;
  readonly sizeBigInt: bigint;
  readonly leaves: bigint[];
  insert(leaf: BigNumberish): void;
  update(index: BigNumberish, leaf: BigNumberish): void;
  indexOf(leaf: bigint): number | bigint;
  generateProof(index: BigNumberish): {
    root: bigint;
    leaf: bigint;
    index: number | bigint;
    siblings: bigint[];
  };
}
export interface LineageMerklePathInput {
  root: BigNumberish;
  leaf: BigNumberish;
  index: BigNumberish;
  siblings: BigNumberish[];
}
export interface LineageMerkleProof {
  root: bigint;
  leaf: bigint;
  depth: number;
  index: bigint;
  siblings: bigint[];
}
export function wrapIdentityCommitmentAsPersonHash(identityCommitment: BigNumberish): string;
export function computeLineageParentsDigest(input: {
  fatherIdentityCommitment: BigNumberish;
  motherIdentityCommitment: BigNumberish;
}): bigint;
export function packLineageEndorserAndTime(input: {
  endorser: string;
  writtenAt: BigNumberish;
}): bigint;
export function computeLineageEndorsementLeaf(input: {
  identityCommitment: BigNumberish;
  parentsDigest: BigNumberish;
  versionIndex: BigNumberish;
  endorser: string;
  writtenAt: BigNumberish;
}): bigint;
export function computeLineageTrustedLeaf(input: {
  rootIdentityCommitment: BigNumberish;
  rootVersionIndex: BigNumberish;
  account: string;
}): bigint;
export function hashLineageNodes(left: bigint, right: bigint): bigint;
export function createLineageTree(leaves?: BigNumberish[]): LineageTree;
export function replayLineageTree(
  writes: ReadonlyArray<{ leafIndex: BigNumberish; leaf: BigNumberish }>,
): LineageTree;
export function buildLineageMerkleProof(
  tree: LineageTree,
  leafIndex: BigNumberish,
): LineageMerkleProof;
export function buildLineageMerkleProofFromPath(input: LineageMerklePathInput): LineageMerkleProof;
/** Shielded inheritance v1 Poseidon domains. */
export const SHIELDED_INHERITANCE_DOMAINS: Readonly<{
  policy: bigint;
  enrollment: bigint;
  ownerSecret: bigint;
  ownerCommitment: bigint;
  valueNote: bigint;
  budgetNote: bigint;
  spendNullifier: bigint;
  periodNullifier: bigint;
  viewSeed: bigint;
  dummyPeriodNullifier: bigint;
  dummyInputNullifier: bigint;
  topUpUseNullifier: bigint;
  enrollmentNullifier: bigint;
  allocationKeyCommitment: bigint;
}>;
export const SHIELDED_MAX_BATCH_PERIODS: 12;
export const SHIELDED_CIPHERTEXT_BYTES: 512;
export function generateShieldedRandomField(): bigint;
export function computeShieldedCiphertextHashField(ciphertext: BytesLike): bigint;
export function computeShieldedPolicyCommitment(input: {
  rootIdentityCommitment: BigNumberish;
  rootVersionIndex: BigNumberish;
  amountPerPeriod: BigNumberish;
  policySalt: BigNumberish;
  allocationKeyCommitment: BigNumberish;
}): bigint;
export function computeShieldedAllocationKeyCommitment(allocationKey: BigNumberish): bigint;
export function computeShieldedEnrollmentNullifier(input: {
  allocationKey: BigNumberish;
  policyCommitment: BigNumberish;
  heirIdentityCommitment: BigNumberish;
}): bigint;
export function computeShieldedTopUpUseNullifier(input: {
  policySalt: BigNumberish;
  budgetNoteCommitment: BigNumberish;
  useNonce: BigNumberish;
}): bigint;
export function computeShieldedEnrollmentCommitment(input: {
  policyCommitment: BigNumberish;
  heirIdentityCommitment: BigNumberish;
  eligibleFrom: BigNumberish;
  enrollmentSalt: BigNumberish;
}): bigint;
/** hpkeIkm is RFC 9180 DeriveKeyPair input material, not an HPKE private key. */
export function deriveShieldedHeirKeyMaterial(derivedSecretField: BigNumberish): {
  ownerSecret: bigint;
  ownerCommitment: bigint;
  hpkeIkm: string;
};
export function computeShieldedOwnerCommitment(ownerSecret: BigNumberish): bigint;
export function computeShieldedValueNoteCommitment(input: {
  ownerCommitment: BigNumberish;
  amount: BigNumberish;
  nonce: BigNumberish;
  ciphertextHashField: BigNumberish;
}): bigint;
export function computeShieldedBudgetNoteCommitment(input: {
  policyCommitment: BigNumberish;
  enrollmentCommitment: BigNumberish;
  heirOwnerCommitment: BigNumberish;
  amountPerPeriod: BigNumberish;
  remaining: BigNumberish;
  nonce: BigNumberish;
  ciphertextHashField: BigNumberish;
}): bigint;
export function computeShieldedSpendNullifier(input: {
  ownerSecret: BigNumberish;
  noteCommitment: BigNumberish;
}): bigint;
export function computeShieldedPeriodNullifier(input: {
  derivedSecretField: BigNumberish;
  policyCommitment: BigNumberish;
  periodIndex: BigNumberish;
}): bigint;
export function computeShieldedDummyPeriodNullifier(input: {
  ownerSecret: BigNumberish;
  budgetNoteCommitment: BigNumberish;
  slotIndex: BigNumberish;
}): bigint;
export function computeShieldedDummyInputNullifier(input: {
  ownerSecret: BigNumberish;
  noteCommitment: BigNumberish;
}): bigint;
export function computeShieldedClaimBatch(input: {
  amountPerPeriod: BigNumberish;
  remaining: BigNumberish;
  eligibleFrom: BigNumberish;
  now: BigNumberish;
  periodIndices: BigNumberish[];
}): { periodIndices: bigint[]; amount: bigint; remaining: bigint };

export const SHIELDED_HPKE_SUITE: "DHKEM(X25519,HKDF-SHA256)/HKDF-SHA256/AES-128-GCM";
export const SHIELDED_HPKE_ENCAPSULATED_BYTES: 32;
export const SHIELDED_HPKE_PLAINTEXT_BYTES: 464;
export const SHIELDED_HPKE_MAX_PAYLOAD_BYTES: 461;
export const SHIELDED_HPKE_ENVELOPE_VERSION: 1;
export function splitShieldedViewPublicKey(publicKey: BytesLike): {
  viewKeyHi: bigint;
  viewKeyLo: bigint;
};
export function joinShieldedViewPublicKey(input: {
  viewKeyHi: BigNumberish;
  viewKeyLo: BigNumberish;
}): Uint8Array;
export function deriveShieldedViewPublicKey(hpkeIkm: BytesLike): Promise<Uint8Array>;
export function buildShieldedHpkeAad(input: {
  chainId: BigNumberish;
  poolAddress: string;
}): Uint8Array;
export function encryptShieldedNote(input: {
  recipientPublicKey: BytesLike;
  payload: BytesLike;
  chainId: BigNumberish;
  poolAddress: string;
}): Promise<Uint8Array>;
export function decryptShieldedNote(input: {
  hpkeIkm: BytesLike;
  ciphertext: BytesLike;
  chainId: BigNumberish;
  poolAddress: string;
}): Promise<Uint8Array>;

export const SHIELDED_NOTE_PAYLOAD_VERSION: 1;
export const SHIELDED_VALUE_NOTE_KIND: 1;
export const SHIELDED_BUDGET_NOTE_KIND: 2;
export const SHIELDED_VALUE_WITH_BUDGET_MEMO_KIND: 4;
export const SHIELDED_VALUE_WITH_POLICY_MEMO_KIND: 5;
export const SHIELDED_VALUE_NOTE_PAYLOAD_BYTES: 86;
export const SHIELDED_BUDGET_NOTE_PAYLOAD_BYTES: 302;
export const SHIELDED_VALUE_WITH_BUDGET_MEMO_PAYLOAD_BYTES: 420;
export const SHIELDED_VALUE_WITH_POLICY_MEMO_PAYLOAD_BYTES: 452;
export interface ShieldedValueNotePayload {
  ownerCommitment: BigNumberish;
  amount: BigNumberish;
  nonce: BigNumberish;
  /** Encrypted to the value-note owner, so its allocator can recover top-up materials. */
  topUpMemo?: {
    budgetCommitment: BigNumberish;
    budgetNote: ShieldedBudgetNotePayload;
    allocationKey?: BigNumberish;
  };
}
export interface ShieldedBudgetNotePayload {
  rootIdentityCommitment: BigNumberish;
  rootVersionIndex: BigNumberish;
  policySalt: BigNumberish;
  allocationKeyCommitment: BigNumberish;
  heirIdentityCommitment: BigNumberish;
  eligibleFrom: BigNumberish;
  enrollmentSalt: BigNumberish;
  heirOwnerCommitment: BigNumberish;
  amountPerPeriod: BigNumberish;
  remaining: BigNumberish;
  nonce: BigNumberish;
}
export interface ShieldedPolicyDescriptor {
  rootIdentityCommitment: bigint;
  rootVersionIndex: bigint;
  amountPerPeriod: bigint;
  policySalt: bigint;
  allocationKey: bigint;
}
export type DecodedShieldedNotePayload =
  | {
      kind: "value";
      ownerCommitment: bigint;
      amount: bigint;
      nonce: bigint;
      topUpMemo?: {
        budgetCommitment: bigint;
        budgetNote: { [K in keyof ShieldedBudgetNotePayload]: bigint };
        allocationKey?: bigint;
      };
    }
  | ({ kind: "budget" } & { [K in keyof ShieldedBudgetNotePayload]: bigint });
export function encodeShieldedValueNotePayload(note: ShieldedValueNotePayload): Uint8Array;
export function encodeShieldedBudgetNotePayload(note: ShieldedBudgetNotePayload): Uint8Array;
export function decodeShieldedNotePayload(payload: BytesLike): DecodedShieldedNotePayload;
export function computeShieldedNoteCommitmentFromPayload(input: {
  payload: BytesLike;
  ciphertextHashField: BigNumberish;
}): {
  note: DecodedShieldedNotePayload;
  noteCommitment: bigint;
  policyCommitment?: bigint;
  enrollmentCommitment?: bigint;
};
export function verifyShieldedNotePayload(input: {
  payload: BytesLike;
  ciphertext: BytesLike;
  noteCommitment: BigNumberish;
}): {
  note: DecodedShieldedNotePayload;
  noteCommitment: bigint;
  policyCommitment?: bigint;
  enrollmentCommitment?: bigint;
};

export const SHIELDED_POOL_ACTION: Readonly<{
  Shield: 0;
  Fund: 1;
  Claim: 2;
  PrivateTransfer: 3;
  Unshield: 4;
}>;
export type ShieldedPoolPublicInputName =
  | "chainId"
  | "pool"
  | "fundMode"
  | "inputShardId"
  | "inputRoot"
  | "inputShardIds"
  | "inputRoots"
  | "inputNullifiers"
  | "periodNullifiers"
  | "outputCommitments"
  | "ciphertextHashes"
  | "amount"
  | "recipient"
  | "endorsementRoot"
  | "trustedRoot"
  | "asOf";
/** Each pool action circuit's named public inputs, in verifier order. */
export const SHIELDED_POOL_PUBLIC_INPUTS: Readonly<
  Record<number, readonly ShieldedPoolPublicInputName[]>
>;
export const SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS: Readonly<Record<number, number>>;
export const SHIELDED_RECEIVE_CODE_PUBLIC_SIGNAL_COUNT: 4;
export interface ShieldedPoolPublicSignalInput {
  fundMode?: BigNumberish;
  action: BigNumberish;
  chainId: BigNumberish;
  poolAddress: string;
  inputShardIds: readonly [BigNumberish, BigNumberish];
  inputRoots: readonly [BigNumberish, BigNumberish];
  inputNullifiers: readonly [BigNumberish, BigNumberish];
  periodNullifiers: readonly BigNumberish[];
  outputCommitments: readonly [BigNumberish, BigNumberish];
  outputCiphertexts: readonly [BytesLike, BytesLike];
  amount?: BigNumberish;
  recipient?: string;
  relation0?: BigNumberish;
  relation1?: BigNumberish;
  asOf?: BigNumberish;
}
export function buildShieldedPoolPublicInputs(input: ShieldedPoolPublicSignalInput): {
  signals: bigint[];
  /** The same values under the circuit's named inputs, as decimal strings. */
  witness: Record<string, string | string[]>;
};
export function buildShieldedPoolPublicSignals(input: ShieldedPoolPublicSignalInput): bigint[];
export function buildShieldedReceiveCodePublicSignals(input: {
  identityCommitment: BigNumberish;
  ownerCommitment: BigNumberish;
  viewingKey: BytesLike;
}): [bigint, bigint, bigint, bigint];

export const SHIELDED_RECEIVE_CODE_PREFIX: "dfrecv";
export const SHIELDED_RECEIVE_CODE_VERSION: 1;
export interface ShieldedReceiveCodeProof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: "groth16";
  curve: "bn128";
}
export function encodeShieldedReceiveCode(input: {
  identityCommitment: BigNumberish;
  ownerCommitment: BigNumberish;
  viewingKey: BytesLike;
  proof: {
    pi_a: ReadonlyArray<BigNumberish>;
    pi_b: ReadonlyArray<ReadonlyArray<BigNumberish>>;
    pi_c: ReadonlyArray<BigNumberish>;
  };
}): string;
/** Parses and range-checks a code; the caller must still verify its proof. */
export function decodeShieldedReceiveCode(code: string): {
  identityCommitment: bigint;
  ownerCommitment: bigint;
  viewingKey: Uint8Array;
  publicSignals: [bigint, bigint, bigint, bigint];
  proof: ShieldedReceiveCodeProof;
};

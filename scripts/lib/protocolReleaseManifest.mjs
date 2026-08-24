import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { id } from "ethers";

import {
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BYTES,
  AES_KEY_BYTES,
  CANDIDATE_ARGON2ID_PROFILE,
  CIPHER_SUITE_AES_256_GCM,
  COMPRESSION_SUITE_GZIP_V1,
  DFM1_COMMON_PREFIX_BYTES,
  DFM1_FORMAT_1,
  DFM1_FORMAT_1_HEADER_BYTES,
  DFM1_FORMAT_1_OVERHEAD_BYTES,
  DFM1_MAX_CONTENT_CIPHERTEXT_BYTES,
  DFM1_MAX_ENVELOPE_BYTES,
  DOMAIN_DISCLOSURE,
  DOMAIN_IDENTITY,
  DOMAIN_NAME_SECRET,
  DOMAIN_SUITE,
  DOMAIN_VERSION_COMMITMENT,
  FILE_KDF_SUITE_ARGON2ID_CANDIDATE_1,
  FILE_PASSWORD_DOMAIN,
  FILE_SALT_BYTES,
  IDENTITY_PASSWORD_DOMAIN,
  IDENTITY_SALT_DOMAIN,
  IDENTITY_SUITE_CANDIDATE_1,
  MAX_CANONICAL_JSON_BYTES,
  MAX_TAG_UTF8_BYTES,
  METADATA_CONTENT_AAD_DOMAIN,
  METADATA_CONTENT_AAD_DOMAIN_TEXT,
  METADATA_CONTEXT_AAD_DOMAIN,
  METADATA_CONTEXT_AAD_DOMAIN_TEXT,
  METADATA_WRAP_AAD_DOMAIN,
  METADATA_WRAP_AAD_DOMAIN_TEXT,
  PERSON_VERSION_SCHEMA,
  PLAINTEXT_CODEC_CANONICAL_JSON_V1,
  PROTOCOL_GENERATION as PROTOCOL_CORE_GENERATION,
  PROTOCOL_IMPLEMENTATION_STATUS,
  VERSION_HASH_DOMAIN,
  VERSION_HASH_DOMAIN_TEXT,
} from "../../packages/protocol-core/constants.js";
import {
  DISCLOSURE_BINDING_PROOF_DEFINITION,
  DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC,
  PERSON_RELATION_PROOF_DEFINITION,
  PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC,
} from "../../packages/proof-core/index.js";
import {
  validateKdfAttackerStudyV2Evidence,
  validateKdfDeviceMatrixV2Evidence,
} from "./kdfReleaseEvidence.mjs";
import { inspectZkReleaseArtifacts, readCanonicalJsonFile } from "./zkArtifactTrust.mjs";

export const PROTOCOL_RELEASE_MANIFEST_PATH = "protocol-release-manifest.json";
export const PROTOCOL_DEPLOYMENT_EVIDENCE_SCHEMA_VERSION = 1;

const PROTOCOL_IDENTIFIER = "deepfamily/onchain-biography-unified-passphrase-v1";
const PROTOCOL_GENERATION = PROTOCOL_CORE_GENERATION;

export const PROTOCOL_DEPLOYMENT_ARTIFACTS = Object.freeze({
  groth16VerifierAdapter: Object.freeze({
    path: "artifacts/contracts/adapters/Groth16VerifierAdapter.sol/Groth16VerifierAdapter.json",
    contractName: "Groth16VerifierAdapter",
    sourceName: "contracts/adapters/Groth16VerifierAdapter.sol",
    immutableFields: Object.freeze(["personVerifier", "disclosureBindingVerifier"]),
  }),
  metadataArchiveV1: Object.freeze({
    path: "artifacts/contracts/MetadataArchiveV1.sol/MetadataArchiveV1.json",
    contractName: "MetadataArchiveV1",
    sourceName: "contracts/MetadataArchiveV1.sol",
    immutableFields: Object.freeze(["DEEP_FAMILY"]),
  }),
  deepFamilyReader: Object.freeze({
    path: "artifacts/contracts/DeepFamilyReader.sol/DeepFamilyReader.json",
    contractName: "DeepFamilyReader",
    sourceName: "contracts/DeepFamilyReader.sol",
    immutableFields: Object.freeze(["DEEP_FAMILY", "METADATA_ARCHIVE"]),
  }),
});

export const PROTOCOL_CONTRACT_INTERFACE_ARTIFACTS = Object.freeze({
  metadataArchiveV1: Object.freeze({
    path: "artifacts/contracts/MetadataArchiveV1.sol/MetadataArchiveV1.json",
    contractName: "MetadataArchiveV1",
    sourceName: "contracts/MetadataArchiveV1.sol",
  }),
  deepFamilyReader: Object.freeze({
    path: "artifacts/contracts/DeepFamilyReader.sol/DeepFamilyReader.json",
    contractName: "DeepFamilyReader",
    sourceName: "contracts/DeepFamilyReader.sol",
  }),
  deepFamily: Object.freeze({
    path: "artifacts/contracts/DeepFamily.sol/DeepFamily.json",
    contractName: "DeepFamily",
    sourceName: "contracts/DeepFamily.sol",
  }),
});

const SHA256_HEX = /^[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const EVM_BYTECODE = /^0x(?:[0-9a-fA-F]{2})+$/;

const assert = (condition, message) => {
  if (!condition) throw new Error(`Protocol release manifest: ${message}`);
};

const assertSha256 = (value, label) => {
  assert(typeof value === "string" && SHA256_HEX.test(value), `${label} must be SHA-256 hex`);
  return value;
};

const assertAddress = (value, label, { allowZero = false } = {}) => {
  assert(typeof value === "string" && ADDRESS.test(value), `${label} must be an EVM address`);
  assert(
    allowZero || value.toLowerCase() !== ZERO_ADDRESS,
    `${label} must not be the zero address`,
  );
  return value.toLowerCase();
};

const assertNonemptyString = (value, label) => {
  assert(
    typeof value === "string" && value.length > 0 && value.trim() === value,
    `${label} must be a non-empty trimmed string`,
  );
  return value;
};

const assertExactKeys = (value, expectedKeys, label) => {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  const actualKeys = Object.keys(value).sort();
  const normalizedExpectedKeys = [...expectedKeys].sort();
  assert(
    JSON.stringify(actualKeys) === JSON.stringify(normalizedExpectedKeys),
    `${label} must contain exactly ${normalizedExpectedKeys.join(", ")}`,
  );
};

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

export const protocolCanonicalJson = (value) => JSON.stringify(canonicalize(value));

const assertExactJson = (actual, expected, label) => {
  assert(
    protocolCanonicalJson(actual) === protocolCanonicalJson(expected),
    `${label} does not match the v1 implementation constants`,
  );
};

const expectedArgon2idProfile = () => ({
  algorithm: CANDIDATE_ARGON2ID_PROFILE.algorithm,
  version: CANDIDATE_ARGON2ID_PROFILE.version,
  memoryKiB: CANDIDATE_ARGON2ID_PROFILE.memoryKiB,
  iterations: CANDIDATE_ARGON2ID_PROFILE.iterations,
  parallelism: CANDIDATE_ARGON2ID_PROFILE.parallelism,
  outputBytes: CANDIDATE_ARGON2ID_PROFILE.outputBytes,
});

const expectedMetadataRefComponents = () => [
  { name: "pointer", type: "address" },
  { name: "payloadHash", type: "bytes32" },
  { name: "payloadLength", type: "uint32" },
];

const expectedMetadataRefOutput = () => [
  { name: "metadata", type: "tuple", components: expectedMetadataRefComponents() },
];

const functionSelector = (signature) => id(signature).slice(0, 10);
const eventTopic0 = (signature) => id(signature);

const expectedContractInterfaces = () => ({
  schemaVersion: 1,
  types: { MetadataRef: expectedMetadataRefComponents() },
  metadataArchiveV1: {
    abiPolicy: {
      nonErrorFragments: "exact-set",
      errorFragments: "excluded",
    },
    abi: [
      {
        type: "constructor",
        stateMutability: "nonpayable",
        inputs: [{ name: "deepFamily", type: "address" }],
      },
      {
        type: "function",
        name: "DEEP_FAMILY",
        selector: functionSelector("DEEP_FAMILY()"),
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "address" }],
      },
      {
        type: "function",
        name: "MAX_PAYLOAD_LENGTH",
        selector: functionSelector("MAX_PAYLOAD_LENGTH()"),
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "uint256" }],
      },
      {
        type: "function",
        name: "store",
        selector: functionSelector("store(bytes32,uint256,bytes)"),
        stateMutability: "nonpayable",
        inputs: [
          { name: "personHash", type: "bytes32" },
          { name: "versionIndex", type: "uint256" },
          { name: "envelope", type: "bytes" },
        ],
        outputs: expectedMetadataRefOutput(),
      },
      {
        type: "function",
        name: "metadataRef",
        selector: functionSelector("metadataRef(bytes32,uint256)"),
        stateMutability: "view",
        inputs: [
          { name: "personHash", type: "bytes32" },
          { name: "versionIndex", type: "uint256" },
        ],
        outputs: expectedMetadataRefOutput(),
      },
      {
        type: "event",
        name: "MetadataStored",
        topic0: eventTopic0("MetadataStored(bytes32,uint256,address,bytes32,uint32)"),
        anonymous: false,
        inputs: [
          { name: "personHash", type: "bytes32", indexed: true },
          { name: "versionIndex", type: "uint256", indexed: true },
          { name: "pointer", type: "address", indexed: false },
          { name: "payloadHash", type: "bytes32", indexed: false },
          { name: "payloadLength", type: "uint32", indexed: false },
        ],
      },
    ],
    semantics: {
      immutableBindings: { DEEP_FAMILY: "constructor.deepFamily" },
      constants: {
        MAX_PAYLOAD_LENGTH: { type: "uint256", value: DFM1_MAX_ENVELOPE_BYTES },
      },
      storeAuthorization: "msg.sender == DEEP_FAMILY",
      reference: {
        key: ["personHash", "versionIndex"],
        writeOnce: true,
        pointer: "CREATE data-contract address",
        payloadHash: "keccak256(envelope)",
        payloadLength: "envelope.length",
      },
      dataContract: {
        runtimeEncoding: "0x00 || envelope",
        stopPrefix: "0x00",
        payloadStartsAtCodeOffset: 1,
        stopIncludedInPayloadHash: false,
        stopIncludedInPayloadLength: false,
      },
    },
  },
  deepFamilyReader: {
    abiPolicy: {
      nonErrorFragments: "declared-subset",
      errorFragments: "excluded",
    },
    abi: [
      {
        type: "constructor",
        stateMutability: "nonpayable",
        inputs: [{ name: "deepFamily", type: "address" }],
      },
      {
        type: "function",
        name: "DEEP_FAMILY",
        selector: functionSelector("DEEP_FAMILY()"),
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "address" }],
      },
      {
        type: "function",
        name: "METADATA_ARCHIVE",
        selector: functionSelector("METADATA_ARCHIVE()"),
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "address" }],
      },
      {
        type: "function",
        name: "getVersionMetadataRef",
        selector: functionSelector("getVersionMetadataRef(bytes32,uint256)"),
        stateMutability: "view",
        inputs: [
          { name: "personHash", type: "bytes32" },
          { name: "versionIndex", type: "uint256" },
        ],
        outputs: expectedMetadataRefOutput(),
      },
    ],
    semantics: {
      immutableBindings: {
        DEEP_FAMILY: "constructor.deepFamily",
        METADATA_ARCHIVE: "DEEP_FAMILY.metadataArchive() at construction",
      },
      constructorChecks: {
        deepFamilyHasCode: true,
        metadataArchiveHasCode: true,
        archiveReverseBinding: "METADATA_ARCHIVE.DEEP_FAMILY() == DEEP_FAMILY",
      },
      getVersionMetadataRef: {
        versionIndexing: "one-based",
        requiresExistingVersion: true,
        source: "METADATA_ARCHIVE.metadataRef(personHash,versionIndex)",
      },
    },
  },
  deepFamily: {
    abiPolicy: {
      nonErrorFragments: "declared-subset",
      errorFragments: "excluded",
    },
    abi: [
      {
        type: "function",
        name: "metadataArchive",
        selector: functionSelector("metadataArchive()"),
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "address" }],
      },
      {
        type: "function",
        name: "setMetadataArchive",
        selector: functionSelector("setMetadataArchive(address)"),
        stateMutability: "nonpayable",
        inputs: [{ name: "archive", type: "address" }],
        outputs: [],
      },
      {
        type: "event",
        name: "MetadataArchiveSet",
        topic0: eventTopic0("MetadataArchiveSet(address)"),
        anonymous: false,
        inputs: [{ name: "archive", type: "address", indexed: true }],
      },
    ],
    semantics: {
      metadataArchiveStorageSlots: 1,
      initialValue: "address(0)",
      setterAuthorization: "owner",
      setterCallsMaximum: 1,
      archiveHasCode: true,
      archiveReverseBinding: "IMetadataArchiveV1(archive).DEEP_FAMILY() == address(this)",
    },
  },
});

const validateFrozenV1Constants = ({
  manifest,
  format1,
  identitySuite,
  fileSuite,
  personRoute,
  disclosureRoute,
}) => {
  assertExactJson(
    manifest.envelope,
    {
      maximumBytes: DFM1_MAX_ENVELOPE_BYTES,
      payloadHash: "keccak256(envelope)",
      universalPrefix: {
        minimumBytes: DFM1_COMMON_PREFIX_BYTES,
        magic: "0x44464d31",
        formatVersion: { offset: 4, bytes: 1, nonZero: true },
        selfIdentitySuiteId: {
          offset: 16,
          bytes: 4,
          encoding: "uint32-big-endian",
          nonZero: true,
        },
      },
      dataContract: {
        runtimeEncoding: "0x00 || envelope",
        stopPrefix: "0x00",
        payloadStartsAtCodeOffset: 1,
        payloadLengthIncludesStop: false,
        payloadHashIncludesStop: false,
      },
    },
    "envelope definition",
  );

  const { status: formatStatus, ...formatDefinition } = format1 ?? {};
  assertNonemptyString(formatStatus, "format 1 status");
  assertExactJson(
    formatDefinition,
    {
      name: "DFM1-format-1",
      headerLength: DFM1_FORMAT_1_HEADER_BYTES,
      fixedEnvelopeOverhead: DFM1_FORMAT_1_OVERHEAD_BYTES,
      maximumContentCiphertextBytes: DFM1_MAX_CONTENT_CIPHERTEXT_BYTES,
      selectors: {
        flags: 0,
        plaintextCodec: PLAINTEXT_CODEC_CANONICAL_JSON_V1,
        compressionSuite: COMPRESSION_SUITE_GZIP_V1,
        cipherSuite: CIPHER_SUITE_AES_256_GCM,
        kdfSuite: FILE_KDF_SUITE_ARGON2ID_CANDIDATE_1,
      },
      offsets: {
        flags: 5,
        plaintextCodec: 6,
        compressionSuite: 7,
        cipherSuite: 8,
        kdfSuite: 9,
        headerLength: 10,
        contentCiphertextLength: 12,
        identitySuiteId: 16,
        reserved: 20,
        fileSalt: 24,
        wrapIV: 40,
        contentIV: 52,
        wrappedDEK: 64,
        wrappedDEKTag: 96,
        contentCiphertext: 112,
      },
      lengths: {
        fileSalt: FILE_SALT_BYTES,
        wrapIV: AES_GCM_IV_BYTES,
        contentIV: AES_GCM_IV_BYTES,
        dek: AES_KEY_BYTES,
        wrappedDEK: AES_KEY_BYTES,
        gcmTag: AES_GCM_TAG_BYTES,
      },
      plaintext: {
        schema: PERSON_VERSION_SCHEMA,
        maximumUtf8Bytes: MAX_CANONICAL_JSON_BYTES,
        tagMaximumUtf8Bytes: MAX_TAG_UTF8_BYTES,
        serialization: "df-canonical-json-v1",
        compression: {
          name: "gzip-v1",
          level: 6,
          mtime: 0,
          members: 1,
          allowTrailingData: false,
        },
      },
      cipher: {
        name: "AES-256-GCM",
        keyBytes: AES_KEY_BYTES,
        ivBytes: AES_GCM_IV_BYTES,
        tagBytes: AES_GCM_TAG_BYTES,
      },
      aad: {
        contextDomain: {
          text: METADATA_CONTEXT_AAD_DOMAIN_TEXT,
          keccak256: METADATA_CONTEXT_AAD_DOMAIN,
        },
        wrapDomain: {
          text: METADATA_WRAP_AAD_DOMAIN_TEXT,
          keccak256: METADATA_WRAP_AAD_DOMAIN,
        },
        contentDomain: {
          text: METADATA_CONTENT_AAD_DOMAIN_TEXT,
          keccak256: METADATA_CONTENT_AAD_DOMAIN,
        },
        contextAbiWords: [
          "bytes32 contextDomain",
          "uint256 chainId",
          "address deepFamilyProxy",
          "bytes32 personHash",
          "bytes32 fatherHash",
          "uint256 fatherVersionIndex",
          "bytes32 motherHash",
          "uint256 motherVersionIndex",
          "uint256 versionCommitment",
          "uint32 identitySuiteId",
          "uint8 formatVersion",
          "uint8 plaintextCodec",
          "uint8 compressionSuite",
          "uint8 cipherSuite",
          "uint8 kdfSuite",
        ],
      },
    },
    "format 1 definition",
  );

  const { status: identityStatus, ...identityDefinition } = identitySuite ?? {};
  assertNonemptyString(identityStatus, "identity suite 1 status");
  assertExactJson(
    identityDefinition,
    {
      normalization: "NFKD",
      trim: false,
      unicodeVersion: "17.0",
      passwordDomain: IDENTITY_PASSWORD_DOMAIN,
      passwordDomainSeparatorHex: "00",
      salt: {
        bytes: CANDIDATE_ARGON2ID_PROFILE.saltBytes,
        derivation: "first16(keccak256(solidityPacked(string,uint32,string,bytes32)))",
        domain: IDENTITY_SALT_DOMAIN,
      },
      kdf: expectedArgon2idProfile(),
      fieldEncoding: "big-endian uint256 mod BN254 scalar field",
    },
    "identity suite 1 definition",
  );

  const { status: fileStatus, ...fileDefinition } = fileSuite ?? {};
  assertNonemptyString(fileStatus, "file KDF suite 1 status");
  assertExactJson(
    fileDefinition,
    {
      normalization: "NFKD",
      trim: false,
      passwordDomain: FILE_PASSWORD_DOMAIN,
      passwordDomainSeparatorHex: "00",
      saltBytes: CANDIDATE_ARGON2ID_PROFILE.saltBytes,
      kdf: expectedArgon2idProfile(),
    },
    "file KDF suite 1 definition",
  );

  assertExactJson(
    manifest.commitments,
    {
      poseidonArity: 4,
      domains: {
        suite: Number(DOMAIN_SUITE),
        nameSecret: Number(DOMAIN_NAME_SECRET),
        identity: Number(DOMAIN_IDENTITY),
        disclosure: Number(DOMAIN_DISCLOSURE),
        version: Number(DOMAIN_VERSION_COMMITMENT),
      },
      contentDigest: "keccak256(canonicalJsonBytes)",
      contentDigestLimbs: "uint128-low, uint128-high",
      versionCommitment: "Poseidon4(1004,derivedSecretField,contentDigestLo,contentDigestHi)",
      versionHashDomain: {
        text: VERSION_HASH_DOMAIN_TEXT,
        keccak256: VERSION_HASH_DOMAIN,
      },
    },
    "commitment definition",
  );

  assertExactJson(
    manifest.contractInterfaces,
    expectedContractInterfaces(),
    "contract interface definition",
  );

  for (const [route, definition, signalSpec, purposeOrdinal, roleSuiteSemantics] of [
    [
      personRoute,
      PERSON_RELATION_PROOF_DEFINITION,
      PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC,
      0,
      "private uint32 self/father/mother; self nonzero and packed public; present parent nonzero; absent parent zero",
    ],
    [
      disclosureRoute,
      DISCLOSURE_BINDING_PROOF_DEFINITION,
      DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC,
      1,
      "private nonzero uint32 selfIdentitySuiteId",
    ],
  ]) {
    assertExactJson(
      {
        purpose: route?.purpose,
        purposeOrdinal: route?.purposeOrdinal,
        circuitId: route?.circuitId,
        proofEncodingId: route?.proofEncodingId,
        publicSignals: route?.publicSignals,
        roleSuiteSemantics: route?.roleSuiteSemantics,
      },
      {
        purpose: definition.purpose,
        purposeOrdinal,
        circuitId: definition.circuitId,
        proofEncodingId: definition.proofEncodingId,
        publicSignals: signalSpec.fieldOrder.map((name) => ({
          name,
          bits: signalSpec.fieldBitWidths[name],
        })),
        roleSuiteSemantics,
      },
      `${definition.purpose} route definition`,
    );
  }

  assert(DFM1_FORMAT_1 === 1, "protocol-core format 1 ID changed");
  assert(IDENTITY_SUITE_CANDIDATE_1 === 1, "protocol-core identity suite 1 ID changed");
};

const assertSafeRelativePath = (value, label, { json = false } = {}) => {
  assertNonemptyString(value, label);
  assert(!path.isAbsolute(value), `${label} must be repository-relative`);
  assert(!value.includes("\\"), `${label} must use POSIX separators`);
  const components = value.split("/");
  assert(
    components.every((component) => component !== "" && component !== "." && component !== ".."),
    `${label} must not contain empty, dot, or parent components`,
  );
  if (json) assert(path.posix.extname(value) === ".json", `${label} must name a .json file`);
  return value;
};

const isVersionControlledPath = ({ root, relativePath }) => {
  try {
    execFileSync("git", ["-C", root, "ls-files", "--error-unmatch", "--", relativePath], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
};

const readBoundCanonicalJsonEvidence = ({ root, evidence, label, trackedPathInspector }) => {
  assert(evidence?.status === "passed", `${label} evidence has not passed`);
  const relativePath = assertSafeRelativePath(evidence?.path, `${label} evidence path`, {
    json: true,
  });
  assertSha256(evidence?.sha256, `${label} evidence hash`);
  assert(
    trackedPathInspector({ root, relativePath }) === true,
    `${label} evidence must be a version-controlled repository file`,
  );
  const { parsed, raw } = readCanonicalJsonFile(path.join(root, relativePath), `${label} evidence`);
  const actualSha256 = protocolManifestSha256(Buffer.from(raw, "utf8"));
  assert(
    actualSha256 === evidence.sha256,
    `${label} evidence file hash does not match the manifest`,
  );
  return Object.freeze({ path: relativePath, sha256: actualSha256, report: parsed });
};

const assertExactSignalNames = (route, names) => {
  assert(Array.isArray(route.publicSignals), `${route.purpose} publicSignals must be an array`);
  assert(route.publicSignals.length === names.length, `${route.purpose} signal count changed`);
  assert(
    route.publicSignals.every((signal, index) => signal?.name === names[index]),
    `${route.purpose} public signal order changed`,
  );
};

export const protocolManifestSha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const normalizeAbiParameter = (parameter, { event = false } = {}) => {
  const normalized = {
    name: parameter?.name ?? "",
    type: parameter?.type,
  };
  if (parameter?.type === "tuple") {
    normalized.components = (parameter.components ?? []).map((component) =>
      normalizeAbiParameter(component),
    );
  }
  if (event) normalized.indexed = parameter?.indexed === true;
  return normalized;
};

const canonicalAbiParameterType = (parameter) => {
  if (!String(parameter?.type ?? "").startsWith("tuple")) return parameter?.type;
  const suffix = parameter.type.slice("tuple".length);
  return `(${(parameter.components ?? []).map(canonicalAbiParameterType).join(",")})${suffix}`;
};

const abiSignature = (fragment) =>
  `${fragment.name}(${(fragment.inputs ?? []).map(canonicalAbiParameterType).join(",")})`;

const normalizeAbiFragment = (fragment) => {
  if (fragment?.type === "constructor") {
    return {
      type: "constructor",
      stateMutability: fragment.stateMutability,
      inputs: (fragment.inputs ?? []).map((parameter) => normalizeAbiParameter(parameter)),
    };
  }
  if (fragment?.type === "function") {
    return {
      type: "function",
      name: fragment.name,
      selector: functionSelector(abiSignature(fragment)),
      stateMutability: fragment.stateMutability,
      inputs: (fragment.inputs ?? []).map((parameter) => normalizeAbiParameter(parameter)),
      outputs: (fragment.outputs ?? []).map((parameter) => normalizeAbiParameter(parameter)),
    };
  }
  if (fragment?.type === "event") {
    return {
      type: "event",
      name: fragment.name,
      topic0: eventTopic0(abiSignature(fragment)),
      anonymous: fragment.anonymous === true,
      inputs: (fragment.inputs ?? []).map((parameter) =>
        normalizeAbiParameter(parameter, { event: true }),
      ),
    };
  }
  return null;
};

const abiFragmentLabel = (fragment) =>
  fragment.type === "constructor" ? "constructor" : `${fragment.type} ${fragment.name}`;

/**
 * Cross-checks the release-frozen external ABI projection against current Hardhat artifacts.
 * MetadataArchiveV1 freezes the complete non-error ABI; Reader and DeepFamily intentionally
 * freeze only the declared projection. Error fragments are outside both policies. `internalType`
 * is excluded because it is compiler metadata, not ABI encoding.
 */
export const inspectProtocolContractInterfaces = ({
  root = process.cwd(),
  contractInterfaces,
} = {}) => {
  const resolvedRoot = path.resolve(root);
  assertExactJson(
    contractInterfaces,
    expectedContractInterfaces(),
    "contract interface definition",
  );
  const contracts = {};
  for (const [interfaceName, spec] of Object.entries(PROTOCOL_CONTRACT_INTERFACE_ARTIFACTS)) {
    const artifactPath = path.join(resolvedRoot, spec.path);
    let bytes;
    let artifact;
    try {
      const state = fs.lstatSync(artifactPath);
      assert(
        state.isFile() && !state.isSymbolicLink() && fs.realpathSync(artifactPath) === artifactPath,
        `${spec.contractName} ABI artifact must be a regular non-symlink file`,
      );
      bytes = fs.readFileSync(artifactPath);
      artifact = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      if (String(error?.message ?? "").startsWith("Protocol release manifest:")) throw error;
      throw new Error(
        `Protocol release manifest: ${spec.contractName} ABI artifact is unavailable`,
        { cause: error },
      );
    }
    assert(
      artifact.contractName === spec.contractName,
      `${spec.contractName} artifact name changed`,
    );
    assert(artifact.sourceName === spec.sourceName, `${spec.contractName} artifact source changed`);
    assert(Array.isArray(artifact.abi), `${spec.contractName} artifact ABI is missing`);

    const expectedAbi = contractInterfaces?.[interfaceName]?.abi;
    assert(Array.isArray(expectedAbi), `${spec.contractName} frozen ABI is missing`);
    const abiPolicy = contractInterfaces?.[interfaceName]?.abiPolicy;
    assert(
      abiPolicy?.nonErrorFragments === "exact-set" ||
        abiPolicy?.nonErrorFragments === "declared-subset",
      `${spec.contractName} non-error ABI policy is invalid`,
    );
    assert(
      abiPolicy.errorFragments === "excluded",
      `${spec.contractName} error ABI policy is invalid`,
    );
    assert(
      expectedAbi.every((fragment) => fragment?.type !== "error"),
      `${spec.contractName} frozen non-error ABI must not contain errors`,
    );
    const artifactNonErrorAbi = artifact.abi.filter((fragment) => fragment?.type !== "error");
    if (abiPolicy.nonErrorFragments === "exact-set") {
      assert(
        artifactNonErrorAbi.length === expectedAbi.length,
        `${spec.contractName} non-error ABI fragment set changed`,
      );
    }
    const selectors = {};
    const eventTopics = {};
    for (const expectedFragment of expectedAbi) {
      const candidates = artifact.abi.filter(
        (actualFragment) =>
          actualFragment?.type === expectedFragment.type &&
          (expectedFragment.type === "constructor" ||
            actualFragment?.name === expectedFragment.name),
      );
      const label = abiFragmentLabel(expectedFragment);
      assert(
        candidates.length === 1,
        `${spec.contractName} ${label} must have exactly one ABI entry`,
      );
      assertExactJson(
        normalizeAbiFragment(candidates[0]),
        expectedFragment,
        `${spec.contractName} ${label} ABI`,
      );
      if (expectedFragment.type === "function") {
        selectors[expectedFragment.name] = expectedFragment.selector;
      }
      if (expectedFragment.type === "event") {
        eventTopics[expectedFragment.name] = expectedFragment.topic0;
      }
    }
    contracts[interfaceName] = Object.freeze({
      path: spec.path,
      artifactSha256: protocolManifestSha256(bytes),
      checkedFragments: expectedAbi.length,
      artifactNonErrorFragments: artifactNonErrorAbi.length,
      abiPolicy: Object.freeze({ ...abiPolicy }),
      selectors: Object.freeze(selectors),
      eventTopics: Object.freeze(eventTopics),
    });
  }
  return Object.freeze({ status: "passed", contracts: Object.freeze(contracts) });
};

export const protocolRuntimeBytecodeSha256 = (bytecode) => {
  assert(
    typeof bytecode === "string" && EVM_BYTECODE.test(bytecode),
    "runtime bytecode must be non-empty even-length 0x-prefixed hex",
  );
  return protocolManifestSha256(Buffer.from(bytecode.slice(2), "hex"));
};

const collectAstNamesById = (value, targetIds, result = new Map()) => {
  if (Array.isArray(value)) {
    for (const child of value) collectAstNamesById(child, targetIds, result);
    return result;
  }
  if (value === null || typeof value !== "object") return result;
  const id = Number.isSafeInteger(value.id) ? String(value.id) : null;
  if (
    id !== null &&
    targetIds.has(id) &&
    value.nodeType === "VariableDeclaration" &&
    value.mutability === "immutable" &&
    typeof value.name === "string"
  ) {
    result.set(id, value.name);
  }
  for (const child of Object.values(value)) collectAstNamesById(child, targetIds, result);
  return result;
};

const encodeImmutableAddress = (value, length, label) => {
  const address = assertAddress(value, label).slice(2);
  assert(length >= 20, `${label} immutable slot is shorter than an address`);
  return `${"0".repeat((length - 20) * 2)}${address}`;
};

const replaceImmutableReferences = ({ root, artifact, spec, immutableValues }) => {
  assert(
    typeof artifact.buildInfoId === "string" && artifact.buildInfoId.length > 0,
    `${spec.contractName} artifact buildInfoId is missing`,
  );
  const immutableReferences = artifact.immutableReferences;
  assert(
    immutableReferences !== null &&
      typeof immutableReferences === "object" &&
      !Array.isArray(immutableReferences),
    `${spec.contractName} immutableReferences are missing`,
  );
  const referenceIds = new Set(Object.keys(immutableReferences));
  const buildInfoPath = path.join(
    root,
    "artifacts",
    "build-info",
    `${artifact.buildInfoId}.output.json`,
  );
  let buildInfo;
  try {
    const state = fs.lstatSync(buildInfoPath);
    assert(
      state.isFile() && !state.isSymbolicLink() && fs.realpathSync(buildInfoPath) === buildInfoPath,
      `${spec.contractName} build-info output must be a regular non-symlink file`,
    );
    buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, "utf8"));
  } catch (error) {
    if (String(error?.message ?? "").startsWith("Protocol release manifest:")) throw error;
    throw new Error(
      `Protocol release manifest: ${spec.contractName} build-info output is unavailable`,
      { cause: error },
    );
  }
  const namesById = collectAstNamesById(buildInfo, referenceIds);
  assert(
    namesById.size === referenceIds.size,
    `${spec.contractName} immutable AST declarations are incomplete`,
  );
  const expectedFields = [...spec.immutableFields].sort();
  const actualFields = [...namesById.values()].sort();
  assert(
    JSON.stringify(actualFields) === JSON.stringify(expectedFields),
    `${spec.contractName} immutable field set changed`,
  );
  assert(
    JSON.stringify(Object.keys(immutableValues).sort()) === JSON.stringify(expectedFields),
    `${spec.contractName} immutable values must contain exactly ${expectedFields.join(", ")}`,
  );

  let body = artifact.deployedBytecode.slice(2);
  for (const [id, references] of Object.entries(immutableReferences)) {
    const name = namesById.get(id);
    assert(Array.isArray(references) && references.length > 0, `${name} references are missing`);
    for (const reference of references) {
      assert(
        Number.isSafeInteger(reference?.start) &&
          reference.start >= 0 &&
          Number.isSafeInteger(reference?.length) &&
          reference.length > 0,
        `${name} immutable reference is malformed`,
      );
      const start = reference.start * 2;
      const end = start + reference.length * 2;
      assert(end <= body.length, `${name} immutable reference exceeds deployed bytecode`);
      body =
        body.slice(0, start) +
        encodeImmutableAddress(
          immutableValues[name],
          reference.length,
          `${spec.contractName}.${name}`,
        ) +
        body.slice(end);
    }
  }
  return `0x${body}`;
};

export const inspectProtocolDeploymentArtifact = ({
  root = process.cwd(),
  artifactName,
  immutableValues,
} = {}) => {
  const spec = PROTOCOL_DEPLOYMENT_ARTIFACTS[artifactName];
  assert(spec, `unknown protocol deployment artifact ${String(artifactName)}`);
  const artifactPath = path.join(path.resolve(root), spec.path);
  let bytes;
  let artifact;
  try {
    const state = fs.lstatSync(artifactPath);
    assert(
      state.isFile() && !state.isSymbolicLink() && fs.realpathSync(artifactPath) === artifactPath,
      `${spec.contractName} artifact must be a regular non-symlink file`,
    );
    bytes = fs.readFileSync(artifactPath);
    artifact = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    if (String(error?.message ?? "").startsWith("Protocol release manifest:")) throw error;
    throw new Error(`Protocol release manifest: ${spec.contractName} artifact is unavailable`, {
      cause: error,
    });
  }
  assert(artifact.contractName === spec.contractName, `${spec.contractName} artifact name changed`);
  assert(artifact.sourceName === spec.sourceName, `${spec.contractName} artifact source changed`);
  assert(
    typeof artifact.deployedBytecode === "string" && EVM_BYTECODE.test(artifact.deployedBytecode),
    `${spec.contractName} deployed bytecode is missing`,
  );
  const runtimeBytecode = replaceImmutableReferences({
    root: path.resolve(root),
    artifact,
    spec,
    immutableValues,
  });
  return Object.freeze({
    path: spec.path,
    artifactSha256: protocolManifestSha256(bytes),
    runtimeSha256: protocolRuntimeBytecodeSha256(runtimeBytecode),
    runtimeBytecode,
  });
};

export const inspectProtocolDeploymentArtifacts = ({ root = process.cwd(), deployments } = {}) => {
  const adapter = deployments?.groth16VerifierAdapter;
  const archive = deployments?.metadataArchiveV1;
  const reader = deployments?.deepFamilyReader;
  return Object.freeze({
    groth16VerifierAdapter: inspectProtocolDeploymentArtifact({
      root,
      artifactName: "groth16VerifierAdapter",
      immutableValues: {
        personVerifier: adapter?.personVerifierImmutable,
        disclosureBindingVerifier: adapter?.disclosureBindingVerifierImmutable,
      },
    }),
    metadataArchiveV1: inspectProtocolDeploymentArtifact({
      root,
      artifactName: "metadataArchiveV1",
      immutableValues: { DEEP_FAMILY: archive?.deepFamilyImmutable },
    }),
    deepFamilyReader: inspectProtocolDeploymentArtifact({
      root,
      artifactName: "deepFamilyReader",
      immutableValues: {
        DEEP_FAMILY: reader?.deepFamilyImmutable,
        METADATA_ARCHIVE: reader?.metadataArchiveImmutable,
      },
    }),
  });
};

const normalizedRouteProjection = ({ routes, adapterAddress }) => {
  assert(Array.isArray(routes) && routes.length > 0, "deployment proof routes are missing");
  return [...routes]
    .sort(
      (left, right) =>
        left.purposeOrdinal - right.purposeOrdinal || left.circuitId - right.circuitId,
    )
    .map((route) => {
      const purpose = assertNonemptyString(route?.purpose, "deployment route purpose");
      assert(
        Number.isSafeInteger(route?.purposeOrdinal) && route.purposeOrdinal >= 0,
        `${purpose} purpose ordinal is invalid`,
      );
      assert(
        Number.isSafeInteger(route?.circuitId) && route.circuitId > 0,
        `${purpose} circuitId is invalid`,
      );
      assert(
        Number.isSafeInteger(route?.proofEncodingId) && route.proofEncodingId > 0,
        `${purpose} proofEncodingId is invalid`,
      );
      return Object.freeze({
        purpose,
        purposeOrdinal: route.purposeOrdinal,
        circuitId: route.circuitId,
        proofEncodingId: route.proofEncodingId,
        adapter: assertAddress(adapterAddress, `${route.purpose} adapter`),
      });
    });
};

const normalizeDeploymentChainId = (value, label) => {
  const normalized =
    typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : value;
  assert(Number.isSafeInteger(normalized) && normalized > 0, `${label} is invalid`);
  return normalized;
};

/**
 * Stable target-deployment projection shared by the manifest and an acceptance report for the same
 * chain and addresses. It deliberately excludes the manifest hash, timestamps and transaction
 * hashes. Testnet and mainnet projections are not expected to be equal because their addresses and
 * immutable-linked runtime hashes differ.
 */
export const protocolDeploymentEvidenceFromManifest = (manifest) => {
  const deployments = manifest?.deployments;
  const adapter = deployments?.groth16VerifierAdapter;
  const archive = deployments?.metadataArchiveV1;
  const reader = deployments?.deepFamilyReader;
  const chainId = normalizeDeploymentChainId(deployments?.chainId, "deployment chainId");
  return Object.freeze({
    schemaVersion: PROTOCOL_DEPLOYMENT_EVIDENCE_SCHEMA_VERSION,
    protocol: manifest.protocol,
    protocolGeneration: manifest.protocolGeneration,
    chainId,
    contracts: Object.freeze({
      deepFamily: Object.freeze({
        proxy: assertAddress(deployments.deepFamilyProxy, "DeepFamily proxy"),
        implementation: assertAddress(
          deployments.deepFamilyImplementation,
          "DeepFamily implementation",
        ),
        metadataArchive: assertAddress(archive?.address, "DeepFamily MetadataArchiveV1 binding"),
      }),
      groth16VerifierAdapter: Object.freeze({
        address: assertAddress(adapter?.address, "Groth16VerifierAdapter address"),
        personVerifierImmutable: assertAddress(
          adapter?.personVerifierImmutable,
          "Groth16VerifierAdapter person verifier",
        ),
        disclosureBindingVerifierImmutable: assertAddress(
          adapter?.disclosureBindingVerifierImmutable,
          "Groth16VerifierAdapter disclosure verifier",
        ),
        artifactSha256: assertSha256(
          adapter?.artifactSha256,
          "Groth16VerifierAdapter artifactSha256",
        ),
        runtimeSha256: assertSha256(adapter?.runtimeSha256, "Groth16VerifierAdapter runtimeSha256"),
      }),
      metadataArchiveV1: Object.freeze({
        address: assertAddress(archive?.address, "MetadataArchiveV1 address"),
        deepFamilyImmutable: assertAddress(
          archive?.deepFamilyImmutable,
          "MetadataArchiveV1 DEEP_FAMILY immutable",
        ),
        artifactSha256: assertSha256(archive?.artifactSha256, "MetadataArchiveV1 artifactSha256"),
        runtimeSha256: assertSha256(archive?.runtimeSha256, "MetadataArchiveV1 runtimeSha256"),
      }),
      deepFamilyReader: Object.freeze({
        address: assertAddress(reader?.address, "DeepFamilyReader address"),
        deepFamilyImmutable: assertAddress(
          reader?.deepFamilyImmutable,
          "DeepFamilyReader DEEP_FAMILY immutable",
        ),
        metadataArchiveImmutable: assertAddress(
          reader?.metadataArchiveImmutable,
          "DeepFamilyReader archive immutable",
        ),
        artifactSha256: assertSha256(reader?.artifactSha256, "DeepFamilyReader artifactSha256"),
        runtimeSha256: assertSha256(reader?.runtimeSha256, "DeepFamilyReader runtimeSha256"),
      }),
    }),
    routes: Object.freeze(
      normalizedRouteProjection({ routes: manifest.proofRoutes, adapterAddress: adapter?.address }),
    ),
  });
};

export const protocolDeploymentEvidenceFromAcceptanceReport = (report) => {
  const terminal = report?.terminalGovernanceState;
  const addresses = report?.addresses;
  const deepFamily = terminal?.deepFamily;
  const adapter = terminal?.verifierAdapter;
  const archive = terminal?.archive;
  const reader = terminal?.reader;
  const proxyAddress = assertAddress(addresses?.deepFamily, "acceptance DeepFamily proxy");
  assert(
    assertAddress(deepFamily?.address, "acceptance terminal DeepFamily address") === proxyAddress,
    "acceptance terminal DeepFamily address does not match the deployed proxy",
  );
  return Object.freeze({
    schemaVersion: PROTOCOL_DEPLOYMENT_EVIDENCE_SCHEMA_VERSION,
    protocol: report?.protocolManifestEvidence?.protocol,
    protocolGeneration: report?.protocolManifestEvidence?.protocolGeneration,
    chainId: normalizeDeploymentChainId(report?.network?.chainId, "acceptance deployment chainId"),
    contracts: Object.freeze({
      deepFamily: Object.freeze({
        proxy: proxyAddress,
        implementation: assertAddress(
          deepFamily?.implementation,
          "acceptance DeepFamily implementation",
        ),
        metadataArchive: assertAddress(
          deepFamily?.metadataArchive,
          "acceptance DeepFamily MetadataArchiveV1 binding",
        ),
      }),
      groth16VerifierAdapter: Object.freeze({
        address: assertAddress(adapter?.address, "acceptance Groth16VerifierAdapter address"),
        personVerifierImmutable: assertAddress(
          adapter?.personVerifier,
          "acceptance Groth16VerifierAdapter person verifier",
        ),
        disclosureBindingVerifierImmutable: assertAddress(
          adapter?.disclosureBindingVerifier,
          "acceptance Groth16VerifierAdapter disclosure verifier",
        ),
        artifactSha256: assertSha256(
          adapter?.artifactSha256,
          "acceptance Groth16VerifierAdapter artifactSha256",
        ),
        runtimeSha256: assertSha256(
          adapter?.runtimeSha256,
          "acceptance Groth16VerifierAdapter runtimeSha256",
        ),
      }),
      metadataArchiveV1: Object.freeze({
        address: assertAddress(archive?.address, "acceptance MetadataArchiveV1 address"),
        deepFamilyImmutable: assertAddress(
          archive?.deepFamily,
          "acceptance MetadataArchiveV1 DEEP_FAMILY immutable",
        ),
        artifactSha256: assertSha256(
          archive?.artifactSha256,
          "acceptance MetadataArchiveV1 artifactSha256",
        ),
        runtimeSha256: assertSha256(
          archive?.runtimeSha256,
          "acceptance MetadataArchiveV1 runtimeSha256",
        ),
      }),
      deepFamilyReader: Object.freeze({
        address: assertAddress(reader?.address, "acceptance DeepFamilyReader address"),
        deepFamilyImmutable: assertAddress(
          reader?.deepFamily,
          "acceptance DeepFamilyReader DEEP_FAMILY immutable",
        ),
        metadataArchiveImmutable: assertAddress(
          reader?.metadataArchive,
          "acceptance DeepFamilyReader archive immutable",
        ),
        artifactSha256: assertSha256(
          reader?.artifactSha256,
          "acceptance DeepFamilyReader artifactSha256",
        ),
        runtimeSha256: assertSha256(
          reader?.runtimeSha256,
          "acceptance DeepFamilyReader runtimeSha256",
        ),
      }),
    }),
    routes: Object.freeze(
      normalizedRouteProjection({
        routes: terminal?.proofRoutes,
        adapterAddress: adapter?.address,
      }),
    ),
  });
};

export const protocolDeploymentEvidenceSha256 = (projection) =>
  protocolManifestSha256(Buffer.from(protocolCanonicalJson(projection), "utf8"));

export const inspectProtocolReleaseManifest = ({
  root = process.cwd(),
  requireProduction = false,
  zkArtifactInspector = inspectZkReleaseArtifacts,
  deploymentArtifactInspector = inspectProtocolDeploymentArtifacts,
  contractInterfaceInspector = inspectProtocolContractInterfaces,
  trackedPathInspector = isVersionControlledPath,
  protocolImplementationStatus = PROTOCOL_IMPLEMENTATION_STATUS,
} = {}) => {
  const resolvedRoot = path.resolve(root);
  const manifestPath = path.join(resolvedRoot, PROTOCOL_RELEASE_MANIFEST_PATH);
  const bytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(bytes.toString("utf8"));

  assert(manifest.schemaVersion === 1, "schemaVersion must be 1");
  assert(manifest.protocol === PROTOCOL_IDENTIFIER, "unexpected protocol identifier");
  assert(manifest.protocolGeneration === PROTOCOL_GENERATION, "unexpected protocol generation");
  assert(manifest.envelope?.maximumBytes === 16_384, "envelope maximum must be 16,384");
  assert(manifest.envelope?.universalPrefix?.minimumBytes === 20, "prefix must be 20 bytes");
  assert(manifest.envelope?.universalPrefix?.magic === "0x44464d31", "magic must be DFM1");
  assert(
    manifest.envelope?.universalPrefix?.formatVersion?.offset === 4,
    "formatVersion offset must be 4",
  );
  assert(
    manifest.envelope?.universalPrefix?.selfIdentitySuiteId?.offset === 16,
    "self identity suite offset must be 16",
  );
  assert(
    manifest.envelope?.dataContract?.runtimeEncoding === "0x00 || envelope",
    "data-contract runtime encoding changed",
  );

  // The v1 selector registries are deliberately closed, not merely minimum baselines. Existing
  // ID 1 definitions are exact-bound above/below, and adding an ID requires an explicit reviewed
  // validator/manifest generation change, so a v1 release cannot silently reinterpret or append
  // an unreviewed format or KDF suite.
  assertExactKeys(manifest.formats, ["1"], "format ID set");
  assertExactKeys(manifest.identitySuites, ["1"], "identity suite ID set");
  assertExactKeys(manifest.fileKdfSuites, ["1"], "file KDF suite ID set");
  assert(
    Array.isArray(manifest.proofRoutes) && manifest.proofRoutes.length === 2,
    "v1 proof route set must contain exactly two routes",
  );

  const format1 = manifest.formats["1"];
  assert(format1?.headerLength === 112, "format 1 headerLength must be 112");
  assert(format1?.fixedEnvelopeOverhead === 128, "format 1 overhead must be 128");
  assert(format1?.maximumContentCiphertextBytes === 16_256, "format 1 payload limit changed");
  assert(format1?.plaintext?.schema === "deepfamily/person-version@1.0", "schema changed");
  assert(format1?.aad?.contextAbiWords?.length === 15, "context AAD must contain 15 words");

  const identitySuite = manifest.identitySuites["1"];
  const fileSuite = manifest.fileKdfSuites["1"];
  for (const [label, suite] of [
    ["identity suite 1", identitySuite],
    ["file KDF suite 1", fileSuite],
  ]) {
    assert(suite?.kdf?.algorithm === "Argon2id", `${label} must use Argon2id`);
    assert(suite?.kdf?.version === 19, `${label} must use Argon2 version 0x13`);
    assert(suite?.kdf?.memoryKiB >= 65_536, `${label} is below the 64 MiB baseline`);
    assert(suite?.kdf?.iterations >= 3, `${label} is below the t=3 baseline`);
    assert(suite?.kdf?.parallelism >= 1, `${label} parallelism is invalid`);
    assert(suite?.kdf?.outputBytes === 32, `${label} output must be 32 bytes`);
  }

  const personRoute = manifest.proofRoutes?.find((route) => route.purpose === "PersonRelation");
  const disclosureRoute = manifest.proofRoutes?.find(
    (route) => route.purpose === "DisclosureBinding",
  );
  assert(personRoute?.purposeOrdinal === 0, "PersonRelation purpose ordinal must be 0");
  assert(disclosureRoute?.purposeOrdinal === 1, "DisclosureBinding purpose ordinal must be 1");
  for (const route of [personRoute, disclosureRoute]) {
    assert(Number.isInteger(route?.circuitId) && route.circuitId > 0, "circuitId must be nonzero");
    assert(route?.proofEncodingId === 1, `${route?.purpose} proofEncodingId must be 1`);
  }
  assertExactSignalNames(personRoute, [
    "identityCommitment",
    "fatherIdentityCommitment",
    "motherIdentityCommitment",
    "submitterAndSelfSuiteId",
    "versionCommitment",
  ]);
  assertExactSignalNames(disclosureRoute, [
    "identityCommitment",
    "disclosureBinding",
    "minter",
    "suiteCommitment",
  ]);
  validateFrozenV1Constants({
    manifest,
    format1,
    identitySuite,
    fileSuite,
    personRoute,
    disclosureRoute,
  });

  const goldenVectors = manifest.goldenVectors;
  assert(
    goldenVectors?.path === "protocol-vectors/onchain-biography-v1.json",
    "unexpected golden vector path",
  );
  assertSha256(goldenVectors?.sha256, "golden vector hash");
  const goldenVectorPath = path.join(resolvedRoot, goldenVectors.path);
  assert(fs.existsSync(goldenVectorPath), "golden vector file is missing");
  assert(
    protocolManifestSha256(fs.readFileSync(goldenVectorPath)) === goldenVectors.sha256,
    "golden vector file hash does not match the manifest",
  );

  if (requireProduction) {
    assert(typeof zkArtifactInspector === "function", "zkArtifactInspector must be a function");
    assert(typeof trackedPathInspector === "function", "trackedPathInspector must be a function");
    assert(
      typeof deploymentArtifactInspector === "function",
      "deploymentArtifactInspector must be a function",
    );
    assert(
      typeof contractInterfaceInspector === "function",
      "contractInterfaceInspector must be a function",
    );
    for (const [relativePath, label] of [
      [PROTOCOL_RELEASE_MANIFEST_PATH, "protocol release manifest"],
      [goldenVectors.path, "golden vector"],
    ]) {
      assert(
        trackedPathInspector({ root: resolvedRoot, relativePath }) === true,
        `${label} must be a version-controlled repository file`,
      );
    }
    assert(manifest.releaseStatus === "production", "releaseStatus is not production");
    assert(
      protocolImplementationStatus?.releaseStatus === "production" &&
        protocolImplementationStatus?.identitySuite1 === "frozen" &&
        protocolImplementationStatus?.fileKdfSuite1 === "frozen" &&
        protocolImplementationStatus?.productionFrozen === true,
      "shared protocol implementation constants are not production-frozen",
    );
    assert(format1.status === "frozen", "format 1 is not frozen");
    for (const [label, suite] of [
      ["identity suite 1", identitySuite],
      ["file KDF suite 1", fileSuite],
    ]) {
      assert(suite.status === "frozen", `${label} is not frozen`);
    }
    for (const route of [personRoute, disclosureRoute]) {
      assert(
        route.artifacts?.status === "production",
        `${route.purpose} artifacts are not production`,
      );
      for (const key of [
        "sourceSha256",
        "r1csSha256",
        "wasmSha256",
        "zkeySha256",
        "verificationKeySha256",
        "solidityVerifierSha256",
        "adapterArtifactSha256",
        "adapterRuntimeSha256",
      ]) {
        assertSha256(route.artifacts?.[key], `${route.purpose}.${key}`);
      }
    }

    const zkEvidence = zkArtifactInspector({
      root: resolvedRoot,
      requireProduction: true,
      requireBuiltR1cs: true,
    });
    assert(zkEvidence?.status === "passed", "ZK artifact inspection did not pass");
    assert(zkEvidence?.productionReady === true, "ZK artifact set is not production-ready");
    assert(
      zkEvidence?.trustedSetupStatus === "production",
      "ZK artifact trusted setup is not production",
    );
    const zkRoutes = new Map([
      [personRoute, zkEvidence?.artifacts?.person_commitment],
      [disclosureRoute, zkEvidence?.artifacts?.disclosure_binding],
    ]);
    const zkHashFields = [
      ["sourceSha256", "source"],
      ["r1csSha256", "r1cs"],
      ["wasmSha256", "wasm"],
      ["zkeySha256", "zkey"],
      ["verificationKeySha256", "verificationKey"],
      ["solidityVerifierSha256", "solidityVerifier"],
    ];
    for (const [route, evidence] of zkRoutes) {
      assert(evidence, `${route.purpose} is missing from the validated ZK artifact manifest`);
      for (const [manifestField, evidenceField] of zkHashFields) {
        assert(
          route.artifacts[manifestField] === evidence?.[evidenceField]?.sha256,
          `${route.purpose}.${manifestField} does not match validated ZK artifact bytes`,
        );
      }
    }

    assert(manifest.deployments?.status === "production", "deployment evidence is incomplete");
    assertExactKeys(
      manifest.deployments,
      [
        "status",
        "chainId",
        "deepFamilyProxy",
        "deepFamilyImplementation",
        "groth16VerifierAdapter",
        "metadataArchiveV1",
        "deepFamilyReader",
      ],
      "production deployment definition",
    );
    assert(
      Number.isSafeInteger(manifest.deployments?.chainId) && manifest.deployments.chainId > 0,
      "deployment chainId is missing",
    );
    const proxyAddress = assertAddress(manifest.deployments?.deepFamilyProxy, "DeepFamily proxy");
    assertAddress(manifest.deployments?.deepFamilyImplementation, "DeepFamily implementation");
    const adapter = manifest.deployments?.groth16VerifierAdapter;
    const archive = manifest.deployments?.metadataArchiveV1;
    const reader = manifest.deployments?.deepFamilyReader;
    assertExactKeys(
      adapter,
      [
        "address",
        "personVerifierImmutable",
        "disclosureBindingVerifierImmutable",
        "artifactSha256",
        "runtimeSha256",
      ],
      "Groth16VerifierAdapter deployment",
    );
    assertExactKeys(
      archive,
      ["address", "deepFamilyImmutable", "artifactSha256", "runtimeSha256"],
      "MetadataArchiveV1 deployment",
    );
    assertExactKeys(
      reader,
      [
        "address",
        "deepFamilyImmutable",
        "metadataArchiveImmutable",
        "artifactSha256",
        "runtimeSha256",
      ],
      "DeepFamilyReader deployment",
    );
    assertAddress(adapter?.address, "Groth16VerifierAdapter address");
    assertAddress(adapter?.personVerifierImmutable, "Groth16VerifierAdapter person verifier");
    assertAddress(
      adapter?.disclosureBindingVerifierImmutable,
      "Groth16VerifierAdapter disclosure verifier",
    );
    assertSha256(adapter?.artifactSha256, "Groth16VerifierAdapter artifactSha256");
    assertSha256(adapter?.runtimeSha256, "Groth16VerifierAdapter runtimeSha256");
    assertAddress(archive?.address, "MetadataArchiveV1 address");
    assert(
      assertAddress(archive?.deepFamilyImmutable, "MetadataArchiveV1 DEEP_FAMILY immutable") ===
        proxyAddress,
      "MetadataArchiveV1 must bind the declared DeepFamily proxy",
    );
    assertSha256(archive?.artifactSha256, "MetadataArchiveV1 artifactSha256");
    assertSha256(archive?.runtimeSha256, "MetadataArchiveV1 runtimeSha256");
    assertAddress(reader?.address, "DeepFamilyReader address");
    assert(
      assertAddress(reader?.deepFamilyImmutable, "DeepFamilyReader DEEP_FAMILY immutable") ===
        proxyAddress,
      "DeepFamilyReader must bind the declared DeepFamily proxy",
    );
    assert(
      assertAddress(reader?.metadataArchiveImmutable, "DeepFamilyReader archive immutable") ===
        archive.address.toLowerCase(),
      "DeepFamilyReader must bind the declared MetadataArchiveV1",
    );
    assertSha256(reader?.artifactSha256, "DeepFamilyReader artifactSha256");
    assertSha256(reader?.runtimeSha256, "DeepFamilyReader runtimeSha256");
    const deploymentAddresses = [
      proxyAddress,
      assertAddress(manifest.deployments.deepFamilyImplementation, "DeepFamily implementation"),
      assertAddress(adapter.address, "Groth16VerifierAdapter address"),
      assertAddress(adapter.personVerifierImmutable, "Groth16VerifierAdapter person verifier"),
      assertAddress(
        adapter.disclosureBindingVerifierImmutable,
        "Groth16VerifierAdapter disclosure verifier",
      ),
      assertAddress(archive.address, "MetadataArchiveV1 address"),
      assertAddress(reader.address, "DeepFamilyReader address"),
    ];
    assert(
      new Set(deploymentAddresses).size === deploymentAddresses.length,
      "production deployment addresses must be distinct",
    );

    const contractInterfaceEvidence = contractInterfaceInspector({
      root: resolvedRoot,
      contractInterfaces: manifest.contractInterfaces,
    });
    assert(
      contractInterfaceEvidence?.status === "passed",
      "contract interface artifact inspection did not pass",
    );
    const deploymentArtifacts = deploymentArtifactInspector({
      root: resolvedRoot,
      deployments: manifest.deployments,
    });
    for (const [label, declared, actual] of [
      ["Groth16VerifierAdapter", adapter, deploymentArtifacts.groth16VerifierAdapter],
      ["MetadataArchiveV1", archive, deploymentArtifacts.metadataArchiveV1],
      ["DeepFamilyReader", reader, deploymentArtifacts.deepFamilyReader],
    ]) {
      assert(
        declared.artifactSha256 === actual.artifactSha256,
        `${label} artifactSha256 does not match the compiled artifact file`,
      );
      assert(
        declared.runtimeSha256 === actual.runtimeSha256,
        `${label} runtimeSha256 does not match the immutable-linked runtime bytes`,
      );
    }
    for (const route of [personRoute, disclosureRoute]) {
      assert(
        route.artifacts.adapterArtifactSha256 === adapter.artifactSha256,
        `${route.purpose} adapterArtifactSha256 does not match the deployed adapter`,
      );
      assert(
        route.artifacts.adapterRuntimeSha256 === adapter.runtimeSha256,
        `${route.purpose} adapterRuntimeSha256 does not match the deployed adapter`,
      );
    }

    const deploymentProjection = protocolDeploymentEvidenceFromManifest(manifest);

    assert(manifest.goldenVectors?.status === "frozen", "golden vectors are not frozen");
    const deviceMatrixEvidence = readBoundCanonicalJsonEvidence({
      root: resolvedRoot,
      evidence: manifest.releaseEvidence?.kdfDeviceMatrix,
      label: "kdfDeviceMatrix",
      trackedPathInspector,
    });
    const selectedKdfCandidate = validateKdfDeviceMatrixV2Evidence({
      report: deviceMatrixEvidence.report,
      manifest,
      manifestBinding: manifest.releaseEvidence.kdfDeviceMatrix,
      identitySuite,
      fileSuite,
    });
    const attackerStudyEvidence = readBoundCanonicalJsonEvidence({
      root: resolvedRoot,
      evidence: manifest.releaseEvidence?.kdfAttackerCostStudy,
      label: "kdfAttackerCostStudy",
      trackedPathInspector,
    });
    validateKdfAttackerStudyV2Evidence({
      report: attackerStudyEvidence.report,
      manifest,
      manifestBinding: manifest.releaseEvidence.kdfAttackerCostStudy,
      identitySuite,
      fileSuite,
      selectedCandidate: selectedKdfCandidate,
    });
    assert(
      manifest.releaseEvidence?.trustedSetup?.status === "production",
      "fresh v1 trusted setup is not production",
    );
    assertSha256(
      manifest.releaseEvidence?.trustedSetup?.manifestSha256,
      "trusted setup manifest hash",
    );
    assertSha256(
      manifest.releaseEvidence?.trustedSetup?.transcriptSha256,
      "trusted setup transcript hash",
    );
    assert(
      manifest.releaseEvidence.trustedSetup.manifestSha256 === zkEvidence.manifestSha256,
      "trusted setup manifest hash does not match the validated ZK manifest",
    );
    assert(
      manifest.releaseEvidence.trustedSetup.transcriptSha256 === zkEvidence.transcriptSha256,
      "trusted setup transcript hash does not match the validated ceremony transcript",
    );

    return Object.freeze({
      manifest,
      manifestPath,
      manifestSha256: protocolManifestSha256(bytes),
      zkArtifactEvidence: zkEvidence,
      contractInterfaceEvidence,
      deploymentArtifacts,
      deploymentEvidence: Object.freeze({
        sha256: protocolDeploymentEvidenceSha256(deploymentProjection),
        projection: deploymentProjection,
      }),
      kdfEvidence: Object.freeze({
        deviceMatrix: deviceMatrixEvidence,
        attackerStudy: attackerStudyEvidence,
        selection: selectedKdfCandidate,
      }),
    });
  }

  return Object.freeze({
    manifest,
    manifestPath,
    manifestSha256: protocolManifestSha256(bytes),
  });
};

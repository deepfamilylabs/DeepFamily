import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";

import {
  CIRCOM_CANONICAL_BINARY_PATH,
  localCircomBinaryPath,
  resolveLocalCircomTarget,
} from "./circomToolchain.mjs";
import {
  PRODUCTION_PTAU_BLAKE2B512,
  PRODUCTION_PTAU_BYTES,
  PRODUCTION_PTAU_SHA256,
  PRODUCTION_PTAU_URL,
} from "./productionPtau.mjs";
import { SNARKJS_CLI_PATH, assertSnarkjsRuntimeHash } from "./snarkjsToolchain.mjs";

export const ZK_ARTIFACT_MANIFEST_PATH = "circuits/zk-artifacts-manifest.json";
export const ZK_CEREMONY_TRANSCRIPT_PATH = "circuits/zk-ceremony-transcript.json";
export const ZK_TRUST_MODEL_SINGLE_OPERATOR = "single-operator";
export const ZK_TRUST_MODEL_MULTI_PARTY = "multi-party";
export const MINIMUM_SINGLE_OPERATOR_CONTRIBUTORS = 1;
export const MINIMUM_MULTI_PARTY_CONTRIBUTORS = 2;
// Kept as a compatibility alias for callers that only need the lowest valid production count.
export const MINIMUM_PRODUCTION_CONTRIBUTORS = MINIMUM_SINGLE_OPERATOR_CONTRIBUTORS;
export const ZK_CONTRIBUTION_APPROVAL_DOMAIN = "deepfamily:zk-ceremony-contribution:v1";
export const ZK_PRODUCTION_PHASE1 = Object.freeze({
  source: PRODUCTION_PTAU_URL,
  bytes: PRODUCTION_PTAU_BYTES,
  sha256: PRODUCTION_PTAU_SHA256,
  blake2b512: PRODUCTION_PTAU_BLAKE2B512,
});
export const ZK_TOOLCHAIN_PATHS = Object.freeze({
  // The manifest binds the reviewed Linux x64 release binary, never a host-specific local build.
  circomBinary: CIRCOM_CANONICAL_BINARY_PATH,
  localCircomBinary: localCircomBinaryPath(),
  // Hash and execute the real package CLI, never a platform-specific package-manager shim. The
  // manifest separately binds the complete resolved production dependency closure.
  snarkjsCli: SNARKJS_CLI_PATH,
});

export const ZK_RELEASE_ARTIFACTS = Object.freeze({
  person_commitment: Object.freeze({
    source: "circuits/person_commitment.circom",
    builtR1cs: "zk-artifacts/circuits/person_commitment.r1cs",
    wasm: "frontend/public/zk/person_commitment.wasm",
    zkey: "frontend/public/zk/person_commitment_final.zkey",
    verificationKey: "frontend/public/zk/person_commitment.vkey.json",
    solidityVerifier: "contracts/PersonCommitmentVerifier.sol",
  }),
  disclosure_binding: Object.freeze({
    source: "circuits/disclosure_binding.circom",
    builtR1cs: "zk-artifacts/circuits/disclosure_binding.r1cs",
    wasm: "frontend/public/zk/disclosure_binding.wasm",
    zkey: "frontend/public/zk/disclosure_binding_final.zkey",
    verificationKey: "frontend/public/zk/disclosure_binding.vkey.json",
    solidityVerifier: "contracts/DisclosureBindingVerifier.sol",
  }),
});

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BLAKE2B_512_PATTERN = /^[0-9a-f]{128}$/;
const CEREMONY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/;

const assertPlainObject = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
};

const assertExactKeys = (value, expectedKeys, label) => {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly: ${expected.join(", ")}`);
  }
};

const assertSha256 = (value, label) => {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
};

const assertPositiveSafeInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
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

export const canonicalJson = (value) => JSON.stringify(canonicalize(value));

const normalizeTextLineEndings = (raw, label) => {
  const crlfCount = raw.split("\r\n").length - 1;
  const lfCount = raw.split("\n").length - 1;
  if (raw.replaceAll("\r\n", "").includes("\r") || (crlfCount > 0 && crlfCount !== lfCount)) {
    throw new Error(`${label} must use uniform LF or CRLF line endings`);
  }
  return crlfCount > 0 ? raw.replaceAll("\r\n", "\n") : raw;
};

export const readCanonicalJsonFile = (filePath, label = "JSON file") => {
  let stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch (error) {
    throw new Error(`${label} is unavailable: ${filePath}`, { cause: error });
  }
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    fs.realpathSync(filePath) !== path.resolve(filePath)
  ) {
    throw new Error(`${label} must be a regular file with no symbolic-link path components`);
  }
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`${label} is unavailable: ${filePath}`, { cause: error });
  }
  const canonicalRaw = normalizeTextLineEndings(raw, label);
  let parsed;
  try {
    parsed = JSON.parse(canonicalRaw);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${filePath}`, { cause: error });
  }
  if (canonicalRaw !== `${JSON.stringify(parsed, null, 2)}\n`) {
    throw new Error(
      `${label} must use canonical two-space JSON with one trailing newline and no duplicate keys`,
    );
  }
  return { parsed, raw: canonicalRaw };
};

export const sha256File = (filePath) =>
  createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

export const sha256Text = (value) => createHash("sha256").update(value).digest("hex");

export const sha256CanonicalTextFile = (filePath, label = "Text file") =>
  sha256Text(normalizeTextLineEndings(fs.readFileSync(filePath, "utf8"), label));

const assertBlake2b512 = (value, label) => {
  if (typeof value !== "string" || !BLAKE2B_512_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase BLAKE2b-512 digest`);
  }
  return value;
};

const validateTrustModelCounts = (setup, label) => {
  if (setup.trustModel === ZK_TRUST_MODEL_SINGLE_OPERATOR) {
    if (
      setup.minimumContributors !== MINIMUM_SINGLE_OPERATOR_CONTRIBUTORS ||
      setup.contributorCount !== MINIMUM_SINGLE_OPERATOR_CONTRIBUTORS
    ) {
      throw new Error(
        `${label} single-operator trustModel requires exactly one declared contributor`,
      );
    }
    return;
  }
  if (setup.trustModel === ZK_TRUST_MODEL_MULTI_PARTY) {
    if (
      !Number.isSafeInteger(setup.minimumContributors) ||
      setup.minimumContributors < MINIMUM_MULTI_PARTY_CONTRIBUTORS ||
      !Number.isSafeInteger(setup.contributorCount) ||
      setup.contributorCount < setup.minimumContributors
    ) {
      throw new Error(
        `${label} multi-party trustModel requires at least ` +
          `${MINIMUM_MULTI_PARTY_CONTRIBUTORS} contributors and contributorCount >= minimumContributors`,
      );
    }
    return;
  }
  throw new Error(
    `trustedSetup.trustModel must be exactly ${ZK_TRUST_MODEL_SINGLE_OPERATOR} or ` +
      ZK_TRUST_MODEL_MULTI_PARTY,
  );
};

const assertFileHash = (
  root,
  relativePath,
  expectedHash,
  label,
  { canonicalText = false } = {},
) => {
  const filePath = path.join(root, relativePath);
  let stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch (error) {
    throw new Error(`${label} is unavailable: ${relativePath}`, { cause: error });
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file: ${relativePath}`);
  }
  if (fs.realpathSync(filePath) !== path.resolve(filePath)) {
    throw new Error(`${label} path must not traverse a symbolic link: ${relativePath}`);
  }
  const fileBytes = fs.readFileSync(filePath);
  const hashedBytes = canonicalText
    ? Buffer.from(normalizeTextLineEndings(fileBytes.toString("utf8"), label), "utf8")
    : fileBytes;
  const actualHash = createHash("sha256").update(hashedBytes).digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error(
      `${label} SHA-256 mismatch for ${relativePath}; expected ${expectedHash}, got ${actualHash}`,
    );
  }
  return Object.freeze({
    path: relativePath,
    bytes: hashedBytes.length,
    sha256: actualHash,
  });
};

const validateDevelopmentSetup = (setup) => {
  assertExactKeys(
    setup,
    [
      "status",
      "trustModel",
      "warning",
      "minimumContributors",
      "contributorCount",
      "beaconApplied",
      "transcriptSha256",
    ],
    "trustedSetup",
  );
  if (typeof setup.warning !== "string" || setup.warning.trim().length < 20) {
    throw new Error("trustedSetup.warning must explain the development-only trust boundary");
  }
  if (setup.trustModel !== ZK_TRUST_MODEL_SINGLE_OPERATOR) {
    throw new Error("development trustedSetup.trustModel must be exactly single-operator");
  }
  validateTrustModelCounts(setup, "development trustedSetup");
  if (setup.beaconApplied !== false || setup.transcriptSha256 !== null) {
    throw new Error("development trustedSetup must not claim a beacon or production transcript");
  }
};

const validateProductionSetup = (setup, expectedPhase1) => {
  assertExactKeys(
    setup,
    [
      "status",
      "trustModel",
      "warning",
      "ceremonyId",
      "minimumContributors",
      "contributorCount",
      "phase1",
      "transcript",
      "beacon",
    ],
    "trustedSetup",
  );
  if (typeof setup.ceremonyId !== "string" || !CEREMONY_ID_PATTERN.test(setup.ceremonyId)) {
    throw new Error("trustedSetup.ceremonyId has an unsafe or ambiguous format");
  }
  if (typeof setup.warning !== "string" || setup.warning.trim().length < 20) {
    throw new Error("trustedSetup.warning must explain the production trust boundary");
  }
  validateTrustModelCounts(setup, "production trustedSetup");
  assertPositiveSafeInteger(setup.contributorCount, "trustedSetup.contributorCount");

  const phase1 = assertPlainObject(setup.phase1, "trustedSetup.phase1");
  assertExactKeys(
    phase1,
    ["source", "bytes", "sha256", "blake2b512", "verified"],
    "trustedSetup.phase1",
  );
  if (typeof phase1.source !== "string" || phase1.source.trim().length < 8) {
    throw new Error("trustedSetup.phase1.source must identify the published Powers of Tau");
  }
  assertPositiveSafeInteger(phase1.bytes, "trustedSetup.phase1.bytes");
  assertSha256(phase1.sha256, "trustedSetup.phase1.sha256");
  assertBlake2b512(phase1.blake2b512, "trustedSetup.phase1.blake2b512");
  for (const field of ["source", "bytes", "sha256", "blake2b512"]) {
    if (phase1[field] !== expectedPhase1[field]) {
      throw new Error(
        `trustedSetup.phase1.${field} does not match the pinned production Powers of Tau`,
      );
    }
  }
  if (phase1.verified !== true) {
    throw new Error("trustedSetup.phase1.verified must be true");
  }

  const transcript = assertPlainObject(setup.transcript, "trustedSetup.transcript");
  assertExactKeys(transcript, ["path", "sha256"], "trustedSetup.transcript");
  if (transcript.path !== ZK_CEREMONY_TRANSCRIPT_PATH) {
    throw new Error(`trustedSetup.transcript.path must be exactly ${ZK_CEREMONY_TRANSCRIPT_PATH}`);
  }
  assertSha256(transcript.sha256, "trustedSetup.transcript.sha256");

  const beacon = assertPlainObject(setup.beacon, "trustedSetup.beacon");
  assertExactKeys(
    beacon,
    [
      "applied",
      "name",
      "hash",
      "numIterationsExp",
      "source",
      "personCommitmentContributionHash",
      "disclosureBindingContributionHash",
    ],
    "trustedSetup.beacon",
  );
  if (beacon.applied !== true) throw new Error("trustedSetup.beacon.applied must be true");
  if (typeof beacon.name !== "string" || !PARTICIPANT_ID_PATTERN.test(beacon.name)) {
    throw new Error("trustedSetup.beacon.name has an unsafe or ambiguous format");
  }
  assertSha256(beacon.hash, "trustedSetup.beacon.hash");
  if (
    !Number.isSafeInteger(beacon.numIterationsExp) ||
    beacon.numIterationsExp < 10 ||
    beacon.numIterationsExp > 63
  ) {
    throw new Error("trustedSetup.beacon.numIterationsExp must be an integer between 10 and 63");
  }
  if (typeof beacon.source !== "string" || beacon.source.trim().length < 8) {
    throw new Error("trustedSetup.beacon.source must identify the randomness source");
  }
  assertBlake2b512(
    beacon.personCommitmentContributionHash,
    "trustedSetup.beacon.personCommitmentContributionHash",
  );
  assertBlake2b512(
    beacon.disclosureBindingContributionHash,
    "trustedSetup.beacon.disclosureBindingContributionHash",
  );
};

export const buildZkContributionApprovalMessage = ({
  ceremonyId,
  phase1Sha256,
  circuits,
  contribution,
}) =>
  `${ZK_CONTRIBUTION_APPROVAL_DOMAIN}:` +
  canonicalJson({
    schemaVersion: 1,
    ceremonyId,
    phase1Sha256,
    circuits,
    contribution,
  });

export const validateProductionTranscript = ({ transcript, manifest }) => {
  assertPlainObject(transcript, "ZK ceremony transcript");
  const singleOperatorTranscript = transcript.schemaVersion === 2 || transcript.schemaVersion === 3;
  let compiler = null;
  if (singleOperatorTranscript) {
    assertExactKeys(
      transcript,
      [
        "schemaVersion",
        "trustModel",
        "ceremonyId",
        "phase1Sha256",
        "circuits",
        "contributions",
        "beacon",
        ...(transcript.schemaVersion === 3 ? ["compiler"] : []),
      ],
      "ZK ceremony transcript",
    );
    if (
      transcript.trustModel !== ZK_TRUST_MODEL_SINGLE_OPERATOR ||
      transcript.trustModel !== manifest.trustedSetup.trustModel
    ) {
      throw new Error(
        `ZK ceremony transcript schemaVersion ${transcript.schemaVersion} requires matching ` +
          "single-operator trustModel",
      );
    }
    if (transcript.schemaVersion === 3) {
      const compilerRecord = assertPlainObject(
        transcript.compiler,
        "ZK ceremony transcript compiler",
      );
      assertExactKeys(
        compilerRecord,
        [
          "version",
          "target",
          "platform",
          "arch",
          "strategy",
          "binarySha256",
          "libcEvidence",
          "sourceBuild",
        ],
        "ZK ceremony transcript compiler",
      );
      if (compilerRecord.version !== manifest.circomVersion) {
        throw new Error("ZK ceremony transcript compiler version does not match the manifest");
      }
      let libcEvidence = null;
      if (compilerRecord.platform === "linux") {
        const record = assertPlainObject(
          compilerRecord.libcEvidence,
          "ZK ceremony transcript compiler.libcEvidence",
        );
        assertExactKeys(
          record,
          ["family", "version", "source"],
          "ZK ceremony transcript compiler.libcEvidence",
        );
        if (!["glibc", "musl"].includes(record.family)) {
          throw new Error(
            "ZK ceremony transcript compiler.libcEvidence.family must be glibc or musl",
          );
        }
        if (
          record.version !== null &&
          (typeof record.version !== "string" || record.version.length === 0)
        ) {
          throw new Error(
            "ZK ceremony transcript compiler.libcEvidence.version must be null or non-empty",
          );
        }
        if (
          ![
            "process.report.header.glibcVersionRuntime",
            "explicit-libc",
            "simulated-linux-default",
          ].includes(record.source)
        ) {
          throw new Error("ZK ceremony transcript compiler.libcEvidence.source is not recognized");
        }
        libcEvidence = Object.freeze({ ...record });
      } else if (compilerRecord.libcEvidence !== null) {
        throw new Error("ZK ceremony transcript non-Linux compiler must not declare libc evidence");
      }
      const target = resolveLocalCircomTarget({
        version: compilerRecord.version,
        platform: compilerRecord.platform,
        arch: compilerRecord.arch,
        ...(libcEvidence === null ? {} : { libc: libcEvidence.family }),
      });
      for (const [field, expected] of [
        ["target", target.id],
        ["platform", target.platform],
        ["arch", target.arch],
        ["strategy", target.strategy],
      ]) {
        if (compilerRecord[field] !== expected) {
          throw new Error(`ZK ceremony transcript compiler ${field} does not match its target`);
        }
      }
      assertSha256(compilerRecord.binarySha256, "ZK ceremony transcript compiler.binarySha256");
      if (target.strategy === "official-binary" && compilerRecord.binarySha256 !== target.sha256) {
        throw new Error(
          "ZK ceremony transcript official compiler binarySha256 does not match the pinned target",
        );
      }
      let sourceBuild = null;
      if (target.strategy === "pinned-source") {
        const record = assertPlainObject(
          compilerRecord.sourceBuild,
          "ZK ceremony transcript compiler.sourceBuild",
        );
        assertExactKeys(
          record,
          ["repository", "commit", "cargoVersion", "rustcVersion"],
          "ZK ceremony transcript compiler.sourceBuild",
        );
        if (record.repository !== target.repository || record.commit !== target.commit) {
          throw new Error(
            "ZK ceremony transcript compiler.sourceBuild does not match the pinned source",
          );
        }
        for (const field of ["cargoVersion", "rustcVersion"]) {
          if (typeof record[field] !== "string" || record[field].trim() === "") {
            throw new Error(
              `ZK ceremony transcript compiler.sourceBuild.${field} must be non-empty`,
            );
          }
        }
        sourceBuild = Object.freeze({ ...record });
      } else if (compilerRecord.sourceBuild !== null) {
        throw new Error(
          "ZK ceremony transcript official compiler must not declare source-build evidence",
        );
      }
      compiler = Object.freeze({ ...compilerRecord, libcEvidence, sourceBuild });
    }
  } else if (transcript.schemaVersion === 1) {
    assertExactKeys(
      transcript,
      ["schemaVersion", "ceremonyId", "phase1Sha256", "circuits", "contributions", "beacon"],
      "ZK ceremony transcript",
    );
    if (manifest.trustedSetup.trustModel !== ZK_TRUST_MODEL_MULTI_PARTY) {
      throw new Error("ZK ceremony transcript schemaVersion 1 requires multi-party trustModel");
    }
  } else {
    throw new Error("ZK ceremony transcript schemaVersion must be 1, 2, or 3");
  }
  if (transcript.ceremonyId !== manifest.trustedSetup.ceremonyId) {
    throw new Error("ZK ceremony transcript ceremonyId does not match the manifest");
  }
  if (transcript.phase1Sha256 !== manifest.trustedSetup.phase1.sha256) {
    throw new Error("ZK ceremony transcript Phase 1 hash does not match the manifest");
  }

  const transcriptCircuits = assertPlainObject(
    transcript.circuits,
    "ZK ceremony transcript circuits",
  );
  assertExactKeys(
    transcriptCircuits,
    Object.keys(ZK_RELEASE_ARTIFACTS),
    "ZK ceremony transcript circuits",
  );
  for (const circuitName of Object.keys(ZK_RELEASE_ARTIFACTS)) {
    const circuit = assertPlainObject(
      transcriptCircuits[circuitName],
      `ZK ceremony transcript circuits.${circuitName}`,
    );
    assertExactKeys(
      circuit,
      ["sourceSha256", "r1csSha256"],
      `ZK ceremony transcript circuits.${circuitName}`,
    );
    for (const field of ["sourceSha256", "r1csSha256"]) {
      assertSha256(circuit[field], `ZK ceremony transcript circuits.${circuitName}.${field}`);
      if (circuit[field] !== manifest.circuits[circuitName][field]) {
        throw new Error(
          `ZK ceremony transcript ${circuitName}.${field} does not match the manifest`,
        );
      }
    }
  }

  if (
    !Array.isArray(transcript.contributions) ||
    transcript.contributions.length !== manifest.trustedSetup.contributorCount
  ) {
    throw new Error("ZK ceremony transcript contributions must match contributorCount");
  }
  const participantIds = new Set();
  const signerAddresses = new Set();
  const contributions = transcript.contributions.map((entry, index) => {
    const label = `ZK ceremony transcript contributions[${index}]`;
    const contribution = assertPlainObject(entry, label);
    const embeddedContributionKeys = [
      "sequence",
      "participantId",
      "personCommitmentContributionHash",
      "disclosureBindingContributionHash",
    ];
    const signedMultiPartyKeys = [
      ...embeddedContributionKeys,
      "personCommitmentZkeySha256",
      "disclosureBindingZkeySha256",
      "signerAddress",
      "signature",
    ];
    assertExactKeys(
      contribution,
      singleOperatorTranscript ? embeddedContributionKeys : signedMultiPartyKeys,
      label,
    );
    if (contribution.sequence !== index + 1) {
      throw new Error(`${label}.sequence must be ${index + 1}`);
    }
    if (
      typeof contribution.participantId !== "string" ||
      !PARTICIPANT_ID_PATTERN.test(contribution.participantId)
    ) {
      throw new Error(`${label}.participantId has an unsafe or ambiguous format`);
    }
    if (participantIds.has(contribution.participantId)) {
      throw new Error("ZK ceremony transcript participant identities must be unique");
    }
    participantIds.add(contribution.participantId);

    assertBlake2b512(
      contribution.personCommitmentContributionHash,
      `${label}.personCommitmentContributionHash`,
    );
    assertBlake2b512(
      contribution.disclosureBindingContributionHash,
      `${label}.disclosureBindingContributionHash`,
    );
    if (!singleOperatorTranscript) {
      assertSha256(contribution.personCommitmentZkeySha256, `${label}.personCommitmentZkeySha256`);
      assertSha256(
        contribution.disclosureBindingZkeySha256,
        `${label}.disclosureBindingZkeySha256`,
      );
    }
    const signedContribution = Object.fromEntries(
      Object.entries(contribution).filter(([key]) => key !== "signature"),
    );
    let approvalMessageHash = null;
    if (!singleOperatorTranscript) {
      let signerAddress;
      try {
        signerAddress = ethers.getAddress(contribution.signerAddress);
      } catch {
        throw new Error(`${label}.signerAddress must be a nonzero EVM address`);
      }
      if (signerAddress === ethers.ZeroAddress || signerAddress !== contribution.signerAddress) {
        throw new Error(`${label}.signerAddress must be a checksummed nonzero EVM address`);
      }
      if (signerAddresses.has(signerAddress.toLowerCase())) {
        throw new Error("ZK ceremony transcript signer addresses must be unique");
      }
      signerAddresses.add(signerAddress.toLowerCase());

      let normalizedSignature;
      try {
        normalizedSignature = ethers.Signature.from(contribution.signature).serialized;
      } catch {
        throw new Error(`${label}.signature must be a valid EIP-191 signature`);
      }
      const message = buildZkContributionApprovalMessage({
        ceremonyId: transcript.ceremonyId,
        phase1Sha256: transcript.phase1Sha256,
        circuits: transcriptCircuits,
        contribution: signedContribution,
      });
      let recovered;
      try {
        recovered = ethers.getAddress(ethers.verifyMessage(message, normalizedSignature));
      } catch {
        throw new Error(`${label}.signature cannot be recovered`);
      }
      if (recovered !== signerAddress) {
        throw new Error(`${label}.signature is not from signerAddress`);
      }
      approvalMessageHash = ethers.hashMessage(message);
    }
    return Object.freeze({
      ...signedContribution,
      approvalMessageHash,
    });
  });

  const transcriptBeacon = assertPlainObject(transcript.beacon, "ZK ceremony transcript beacon");
  assertExactKeys(
    transcriptBeacon,
    [
      "name",
      "hash",
      "numIterationsExp",
      "source",
      "personCommitmentContributionHash",
      "disclosureBindingContributionHash",
    ],
    "ZK ceremony transcript beacon",
  );
  const manifestBeacon = {
    name: manifest.trustedSetup.beacon.name,
    hash: manifest.trustedSetup.beacon.hash,
    numIterationsExp: manifest.trustedSetup.beacon.numIterationsExp,
    source: manifest.trustedSetup.beacon.source,
    personCommitmentContributionHash: manifest.trustedSetup.beacon.personCommitmentContributionHash,
    disclosureBindingContributionHash:
      manifest.trustedSetup.beacon.disclosureBindingContributionHash,
  };
  if (canonicalJson(transcriptBeacon) !== canonicalJson(manifestBeacon)) {
    throw new Error("ZK ceremony transcript beacon does not match the manifest");
  }

  return Object.freeze({
    schemaVersion: transcript.schemaVersion,
    ceremonyId: transcript.ceremonyId,
    phase1Sha256: transcript.phase1Sha256,
    compiler,
    circuits: Object.freeze(transcriptCircuits),
    contributions: Object.freeze(contributions),
    beacon: Object.freeze(transcriptBeacon),
  });
};

export const validateZkArtifactManifest = (
  manifest,
  { requireProduction = false, expectedProductionPhase1 = ZK_PRODUCTION_PHASE1 } = {},
) => {
  assertPlainObject(manifest, "ZK artifact manifest");
  assertExactKeys(
    manifest,
    ["schemaVersion", "circomVersion", "snarkjsVersion", "toolchain", "trustedSetup", "circuits"],
    "ZK artifact manifest",
  );
  if (manifest.schemaVersion !== 2 && manifest.schemaVersion !== 3) {
    throw new Error("ZK artifact manifest schemaVersion must be 2 or 3");
  }
  for (const [field, value] of [
    ["circomVersion", manifest.circomVersion],
    ["snarkjsVersion", manifest.snarkjsVersion],
  ]) {
    if (typeof value !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(value)) {
      throw new Error(`${field} must be an exact semantic version`);
    }
  }
  const toolchain = assertPlainObject(manifest.toolchain, "toolchain");
  assertExactKeys(
    toolchain,
    [
      "circomBinarySha256",
      "snarkjsCliSha256",
      ...(manifest.schemaVersion >= 3 ? ["snarkjsRuntimeSha256"] : []),
    ],
    "toolchain",
  );
  assertSha256(toolchain.circomBinarySha256, "toolchain.circomBinarySha256");
  assertSha256(toolchain.snarkjsCliSha256, "toolchain.snarkjsCliSha256");
  if (manifest.schemaVersion >= 3) {
    assertSha256(toolchain.snarkjsRuntimeSha256, "toolchain.snarkjsRuntimeSha256");
  }

  const setup = assertPlainObject(manifest.trustedSetup, "trustedSetup");
  if (setup.status === "development") validateDevelopmentSetup(setup);
  else if (setup.status === "production") {
    validateProductionSetup(setup, expectedProductionPhase1);
  } else throw new Error("trustedSetup.status must be exactly development or production");
  if (requireProduction && setup.status !== "production") {
    throw new Error(
      "Production release is blocked: checked-in ZK proving keys are marked development-only",
    );
  }

  const circuits = assertPlainObject(manifest.circuits, "circuits");
  assertExactKeys(circuits, Object.keys(ZK_RELEASE_ARTIFACTS), "circuits");
  for (const circuitName of Object.keys(ZK_RELEASE_ARTIFACTS)) {
    const circuit = assertPlainObject(circuits[circuitName], `circuits.${circuitName}`);
    assertExactKeys(
      circuit,
      [
        "sourceSha256",
        "r1csSha256",
        "wasmSha256",
        "zkeySha256",
        "verificationKeySha256",
        "solidityVerifierSha256",
      ],
      `circuits.${circuitName}`,
    );
    for (const [field, value] of Object.entries(circuit)) {
      assertSha256(value, `circuits.${circuitName}.${field}`);
    }
  }
  return manifest;
};

export const inspectZkReleaseArtifacts = ({
  root = process.cwd(),
  requireProduction = false,
  requireBuiltR1cs = false,
  expectedProductionPhase1 = ZK_PRODUCTION_PHASE1,
} = {}) => {
  const resolvedRoot = path.resolve(root);
  if (fs.realpathSync(resolvedRoot) !== resolvedRoot) {
    throw new Error("ZK artifact root must not traverse a symbolic link");
  }
  const manifestPath = path.join(resolvedRoot, ZK_ARTIFACT_MANIFEST_PATH);
  const { parsed: manifest, raw } = readCanonicalJsonFile(manifestPath, "ZK artifact manifest");
  validateZkArtifactManifest(manifest, { requireProduction, expectedProductionPhase1 });
  const toolchain = Object.freeze({
    circom: assertFileHash(
      resolvedRoot,
      ZK_TOOLCHAIN_PATHS.circomBinary,
      manifest.toolchain.circomBinarySha256,
      "Pinned canonical Circom compiler",
    ),
    snarkjs: assertFileHash(
      resolvedRoot,
      ZK_TOOLCHAIN_PATHS.snarkjsCli,
      manifest.toolchain.snarkjsCliSha256,
      "Installed snarkjs CLI",
    ),
    snarkjsRuntime:
      manifest.schemaVersion >= 3
        ? assertSnarkjsRuntimeHash({
            root: resolvedRoot,
            expectedSha256: manifest.toolchain.snarkjsRuntimeSha256,
          })
        : null,
  });
  let transcriptEvidence = null;
  if (manifest.trustedSetup.status === "production") {
    const transcriptPath = path.join(resolvedRoot, manifest.trustedSetup.transcript.path);
    const { parsed: transcript, raw: transcriptRaw } = readCanonicalJsonFile(
      transcriptPath,
      "ZK ceremony transcript",
    );
    const transcriptSha256 = sha256Text(transcriptRaw);
    if (transcriptSha256 !== manifest.trustedSetup.transcript.sha256) {
      throw new Error(
        `ZK ceremony transcript SHA-256 mismatch; expected ` +
          `${manifest.trustedSetup.transcript.sha256}, got ${transcriptSha256}`,
      );
    }
    transcriptEvidence = Object.freeze({
      path: manifest.trustedSetup.transcript.path,
      bytes: Buffer.byteLength(transcriptRaw),
      sha256: transcriptSha256,
      record: validateProductionTranscript({ transcript, manifest }),
    });
  }

  const artifacts = {};
  for (const [circuitName, spec] of Object.entries(ZK_RELEASE_ARTIFACTS)) {
    const expected = manifest.circuits[circuitName];
    const evidence = {
      source: assertFileHash(
        resolvedRoot,
        spec.source,
        expected.sourceSha256,
        `${circuitName} source`,
        { canonicalText: true },
      ),
      wasm: assertFileHash(resolvedRoot, spec.wasm, expected.wasmSha256, `${circuitName} WASM`),
      zkey: assertFileHash(resolvedRoot, spec.zkey, expected.zkeySha256, `${circuitName} zkey`),
      verificationKey: assertFileHash(
        resolvedRoot,
        spec.verificationKey,
        expected.verificationKeySha256,
        `${circuitName} verification key`,
        { canonicalText: true },
      ),
      solidityVerifier: assertFileHash(
        resolvedRoot,
        spec.solidityVerifier,
        expected.solidityVerifierSha256,
        `${circuitName} Solidity verifier`,
        { canonicalText: true },
      ),
    };
    if (requireBuiltR1cs) {
      evidence.r1cs = assertFileHash(
        resolvedRoot,
        spec.builtR1cs,
        expected.r1csSha256,
        `${circuitName} compiled R1CS`,
      );
    }
    artifacts[circuitName] = Object.freeze(evidence);
  }

  return Object.freeze({
    status: "passed",
    manifestPath: ZK_ARTIFACT_MANIFEST_PATH,
    manifestSha256: sha256Text(raw),
    schemaVersion: manifest.schemaVersion,
    circomVersion: manifest.circomVersion,
    snarkjsVersion: manifest.snarkjsVersion,
    toolchain,
    trustedSetupStatus: manifest.trustedSetup.status,
    trustModel: manifest.trustedSetup.trustModel,
    trustWarning: manifest.trustedSetup.warning,
    productionReady: manifest.trustedSetup.status === "production",
    ceremonyId: manifest.trustedSetup.ceremonyId ?? null,
    contributorCount: manifest.trustedSetup.contributorCount,
    minimumContributors: manifest.trustedSetup.minimumContributors,
    phase1Sha256:
      manifest.trustedSetup.status === "production" ? manifest.trustedSetup.phase1.sha256 : null,
    phase1Blake2b512:
      manifest.trustedSetup.status === "production"
        ? manifest.trustedSetup.phase1.blake2b512
        : null,
    phase1Bytes:
      manifest.trustedSetup.status === "production" ? manifest.trustedSetup.phase1.bytes : null,
    phase1Source:
      manifest.trustedSetup.status === "production" ? manifest.trustedSetup.phase1.source : null,
    beaconApplied:
      manifest.trustedSetup.status === "production"
        ? manifest.trustedSetup.beacon.applied
        : manifest.trustedSetup.beaconApplied,
    beacon:
      manifest.trustedSetup.status === "production"
        ? Object.freeze({ ...manifest.trustedSetup.beacon })
        : null,
    transcriptPath: transcriptEvidence?.path ?? null,
    transcriptSha256: transcriptEvidence?.sha256 ?? null,
    transcript: transcriptEvidence,
    compiler: transcriptEvidence?.record.compiler ?? null,
    contributions: transcriptEvidence?.record.contributions ?? Object.freeze([]),
    artifacts: Object.freeze(artifacts),
  });
};

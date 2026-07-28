import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";

export const ZK_ARTIFACT_MANIFEST_PATH = "circuits/zk-artifacts-manifest.json";
export const ZK_CEREMONY_TRANSCRIPT_PATH = "circuits/zk-ceremony-transcript.json";
export const MINIMUM_PRODUCTION_CONTRIBUTORS = 3;
export const ZK_CONTRIBUTION_APPROVAL_DOMAIN = "deepfamily:zk-ceremony-contribution:v1";
export const ZK_TOOLCHAIN_PATHS = Object.freeze({
  circomBinary: "bin/circom",
  snarkjsBinary:
    process.platform === "win32" ? "node_modules/.bin/snarkjs.cmd" : "node_modules/.bin/snarkjs",
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

const readJsonStrict = (filePath, label) => {
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
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${filePath}`, { cause: error });
  }
  if (raw !== `${JSON.stringify(parsed, null, 2)}\n`) {
    throw new Error(
      `${label} must use canonical two-space JSON with one trailing newline and no duplicate keys`,
    );
  }
  return { parsed, raw };
};

export const sha256File = (filePath) =>
  createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

export const sha256Text = (value) => createHash("sha256").update(value).digest("hex");

const assertBlake2b512 = (value, label) => {
  if (typeof value !== "string" || !BLAKE2B_512_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase BLAKE2b-512 digest`);
  }
  return value;
};

const assertFileHash = (root, relativePath, expectedHash, label) => {
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
  const actualHash = sha256File(filePath);
  if (actualHash !== expectedHash) {
    throw new Error(
      `${label} SHA-256 mismatch for ${relativePath}; expected ${expectedHash}, got ${actualHash}`,
    );
  }
  return Object.freeze({
    path: relativePath,
    bytes: stats.size,
    sha256: actualHash,
  });
};

const assertExecutableHash = (root, relativePath, expectedHash, label, allowedRoot) => {
  const requestedPath = path.join(root, relativePath);
  let resolvedPath;
  try {
    resolvedPath = fs.realpathSync(requestedPath);
  } catch (error) {
    throw new Error(`${label} is unavailable: ${relativePath}`, { cause: error });
  }
  const stats = fs.statSync(resolvedPath);
  if (!stats.isFile()) throw new Error(`${label} must resolve to a regular file`);
  const resolvedAllowedRoot = `${fs.realpathSync(path.join(root, allowedRoot))}${path.sep}`;
  if (!resolvedPath.startsWith(resolvedAllowedRoot)) {
    throw new Error(`${label} resolves outside ${allowedRoot}`);
  }
  const actualHash = sha256File(resolvedPath);
  if (actualHash !== expectedHash) {
    throw new Error(`${label} SHA-256 mismatch; expected ${expectedHash}, got ${actualHash}`);
  }
  return Object.freeze({
    path: relativePath,
    resolvedPath: path.relative(root, resolvedPath).split(path.sep).join("/"),
    bytes: stats.size,
    sha256: actualHash,
  });
};

const validateDevelopmentSetup = (setup) => {
  assertExactKeys(
    setup,
    [
      "status",
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
  if (setup.minimumContributors !== MINIMUM_PRODUCTION_CONTRIBUTORS) {
    throw new Error(`trustedSetup.minimumContributors must be ${MINIMUM_PRODUCTION_CONTRIBUTORS}`);
  }
  if (!Number.isSafeInteger(setup.contributorCount) || setup.contributorCount < 0) {
    throw new Error("trustedSetup.contributorCount must be a non-negative safe integer");
  }
  if (setup.beaconApplied !== false || setup.transcriptSha256 !== null) {
    throw new Error("development trustedSetup must not claim a beacon or production transcript");
  }
};

const validateProductionSetup = (setup) => {
  assertExactKeys(
    setup,
    [
      "status",
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
  if (
    setup.minimumContributors !== MINIMUM_PRODUCTION_CONTRIBUTORS ||
    setup.contributorCount < setup.minimumContributors
  ) {
    throw new Error(
      `production trustedSetup requires at least ${MINIMUM_PRODUCTION_CONTRIBUTORS} contributors`,
    );
  }
  assertPositiveSafeInteger(setup.contributorCount, "trustedSetup.contributorCount");

  const phase1 = assertPlainObject(setup.phase1, "trustedSetup.phase1");
  assertExactKeys(phase1, ["source", "sha256", "verified"], "trustedSetup.phase1");
  if (typeof phase1.source !== "string" || phase1.source.trim().length < 8) {
    throw new Error("trustedSetup.phase1.source must identify the published Powers of Tau");
  }
  assertSha256(phase1.sha256, "trustedSetup.phase1.sha256");
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
  if (beacon.name !== "deepfamily-public-beacon") {
    throw new Error("trustedSetup.beacon.name must be exactly deepfamily-public-beacon");
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
    throw new Error("trustedSetup.beacon.source must identify the public randomness source");
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

const validateProductionTranscript = ({ transcript, manifest }) => {
  assertPlainObject(transcript, "ZK ceremony transcript");
  assertExactKeys(
    transcript,
    ["schemaVersion", "ceremonyId", "phase1Sha256", "circuits", "contributions", "beacon"],
    "ZK ceremony transcript",
  );
  if (transcript.schemaVersion !== 1) {
    throw new Error("ZK ceremony transcript schemaVersion must be 1");
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
    assertExactKeys(
      contribution,
      [
        "sequence",
        "participantId",
        "signerAddress",
        "personCommitmentContributionHash",
        "disclosureBindingContributionHash",
        "personCommitmentZkeySha256",
        "disclosureBindingZkeySha256",
        "signature",
      ],
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

    assertBlake2b512(
      contribution.personCommitmentContributionHash,
      `${label}.personCommitmentContributionHash`,
    );
    assertBlake2b512(
      contribution.disclosureBindingContributionHash,
      `${label}.disclosureBindingContributionHash`,
    );
    assertSha256(contribution.personCommitmentZkeySha256, `${label}.personCommitmentZkeySha256`);
    assertSha256(contribution.disclosureBindingZkeySha256, `${label}.disclosureBindingZkeySha256`);
    let normalizedSignature;
    try {
      normalizedSignature = ethers.Signature.from(contribution.signature).serialized;
    } catch {
      throw new Error(`${label}.signature must be a valid EIP-191 signature`);
    }
    const signedContribution = Object.fromEntries(
      Object.entries(contribution).filter(([key]) => key !== "signature"),
    );
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
    return Object.freeze({
      ...signedContribution,
      approvalMessageHash: ethers.hashMessage(message),
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
    circuits: Object.freeze(transcriptCircuits),
    contributions: Object.freeze(contributions),
    beacon: Object.freeze(transcriptBeacon),
  });
};

export const validateZkArtifactManifest = (manifest, { requireProduction = false } = {}) => {
  assertPlainObject(manifest, "ZK artifact manifest");
  assertExactKeys(
    manifest,
    ["schemaVersion", "circomVersion", "snarkjsVersion", "toolchain", "trustedSetup", "circuits"],
    "ZK artifact manifest",
  );
  if (manifest.schemaVersion !== 2) {
    throw new Error("ZK artifact manifest schemaVersion must be 2");
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
  assertExactKeys(toolchain, ["circomBinarySha256", "snarkjsCliSha256"], "toolchain");
  assertSha256(toolchain.circomBinarySha256, "toolchain.circomBinarySha256");
  assertSha256(toolchain.snarkjsCliSha256, "toolchain.snarkjsCliSha256");

  const setup = assertPlainObject(manifest.trustedSetup, "trustedSetup");
  if (setup.status === "development") validateDevelopmentSetup(setup);
  else if (setup.status === "production") validateProductionSetup(setup);
  else throw new Error("trustedSetup.status must be exactly development or production");
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
} = {}) => {
  const resolvedRoot = path.resolve(root);
  if (fs.realpathSync(resolvedRoot) !== resolvedRoot) {
    throw new Error("ZK artifact root must not traverse a symbolic link");
  }
  const manifestPath = path.join(resolvedRoot, ZK_ARTIFACT_MANIFEST_PATH);
  const { parsed: manifest, raw } = readJsonStrict(manifestPath, "ZK artifact manifest");
  validateZkArtifactManifest(manifest, { requireProduction });
  const toolchain = Object.freeze({
    circom: assertFileHash(
      resolvedRoot,
      ZK_TOOLCHAIN_PATHS.circomBinary,
      manifest.toolchain.circomBinarySha256,
      "Pinned Circom compiler",
    ),
    snarkjs: assertExecutableHash(
      resolvedRoot,
      ZK_TOOLCHAIN_PATHS.snarkjsBinary,
      manifest.toolchain.snarkjsCliSha256,
      "Installed snarkjs CLI",
      "node_modules/snarkjs",
    ),
  });
  let transcriptEvidence = null;
  if (manifest.trustedSetup.status === "production") {
    const transcriptPath = path.join(resolvedRoot, manifest.trustedSetup.transcript.path);
    const { parsed: transcript, raw: transcriptRaw } = readJsonStrict(
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
      ),
      wasm: assertFileHash(resolvedRoot, spec.wasm, expected.wasmSha256, `${circuitName} WASM`),
      zkey: assertFileHash(resolvedRoot, spec.zkey, expected.zkeySha256, `${circuitName} zkey`),
      verificationKey: assertFileHash(
        resolvedRoot,
        spec.verificationKey,
        expected.verificationKeySha256,
        `${circuitName} verification key`,
      ),
      solidityVerifier: assertFileHash(
        resolvedRoot,
        spec.solidityVerifier,
        expected.solidityVerifierSha256,
        `${circuitName} Solidity verifier`,
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
    productionReady: manifest.trustedSetup.status === "production",
    ceremonyId: manifest.trustedSetup.ceremonyId ?? null,
    contributorCount: manifest.trustedSetup.contributorCount,
    minimumContributors: manifest.trustedSetup.minimumContributors,
    phase1Sha256:
      manifest.trustedSetup.status === "production" ? manifest.trustedSetup.phase1.sha256 : null,
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
    contributions: transcriptEvidence?.record.contributions ?? Object.freeze([]),
    artifacts: Object.freeze(artifacts),
  });
};

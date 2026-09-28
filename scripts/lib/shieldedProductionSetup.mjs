import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { SHIELDED_CIRCUITS } from "../zk-shielded-build.mjs";
import { CIRCOM_VERSION, CIRCOM_LINUX_X64_SHA256 } from "./circomToolchain.mjs";
import {
  PRODUCTION_PTAU_RELATIVE_PATH,
  PRODUCTION_PTAU_SHA256,
  resolveProductionPtauPath,
} from "./productionPtau.mjs";
import { checkedFile, sourceBundleSha256 } from "./shieldedSourceBundle.mjs";
import { sha256File } from "./zkArtifactTrust.mjs";
import { assertSnarkjsRuntimeHash } from "./snarkjsToolchain.mjs";
import { verifyShieldedCeremonyArtifacts } from "./shieldedCeremonyVerification.mjs";

export const SHIELDED_PRODUCTION_MANIFEST_PATH = "circuits/shielded-production-manifest.json";
export const SHIELDED_PHASE2_TRANSCRIPT_PATH = "release-evidence/shielded/phase2-transcript.json";

const SHA256 = /^[0-9a-f]{64}$/u;
const BLAKE2B512 = /^[0-9a-f]{128}$/u;
const RELEASE_CRITERIA_FIELDS = Object.freeze([
  "allocationMaxGas",
  "claim12MaxGas",
  "browserAllocationMaxMs",
  "browserClaim12MaxMs",
  "recoveryMaxMs",
  "recoveryMinEvents",
]);
const sameKeys = (value, expected) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === [...expected].sort().join(",");

export const SHIELDED_SETUP_CIRCUITS = Object.freeze(
  Object.fromEntries(
    Object.entries(SHIELDED_CIRCUITS).map(([action, source]) => {
      const suffix = action[0].toUpperCase() + action.slice(1);
      const verifierContractName = `Shielded${suffix}Verifier`;
      return [
        action,
        Object.freeze({
          action,
          source,
          publicSignals: action === "keyRegistration" ? 7 : 32,
          verifierContractName,
          verifierPath: `contracts/${verifierContractName}.sol`,
        }),
      ];
    }),
  ),
);

const requireDigest = (value, label) => {
  if (!SHA256.test(value ?? "")) throw new Error(`${label} must be a SHA-256 digest`);
  return value;
};

const requireHashedFile = (root, relativePath, expected, label, prefix) => {
  requireDigest(expected, `${label} digest`);
  const absolute = checkedFile(root, relativePath, label, prefix);
  if (sha256File(absolute) !== expected) {
    throw new Error(`${label} SHA-256 mismatch: ${relativePath}`);
  }
  return absolute;
};

const readJson = (root, relativePath, label, prefix) => {
  const absolute = checkedFile(root, relativePath, label, prefix);
  try {
    return { absolute, value: JSON.parse(fs.readFileSync(absolute, "utf8")) };
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`, { cause: error });
  }
};

/** Reviewed thresholds must be committed before Phase 2 starts. */
export function readShieldedReleaseCriteria({ root = process.cwd(), criteriaPath }) {
  const resolvedRoot = path.resolve(root);
  if (typeof criteriaPath !== "string" || criteriaPath.trim() === "") {
    throw new Error(
      "Shielded production setup requires --shielded-release-criteria <committed-json-path>",
    );
  }
  const absolute = path.resolve(resolvedRoot, criteriaPath);
  const relative = path.relative(resolvedRoot, absolute).replaceAll(path.sep, "/");
  if (relative.startsWith("../") || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("Shielded release criteria must be inside the repository");
  }
  const { value: criteria } = readJson(resolvedRoot, relative, "Shielded release criteria");
  if (!sameKeys(criteria, RELEASE_CRITERIA_FIELDS)) {
    throw new Error(
      `Shielded release criteria must contain exactly: ${RELEASE_CRITERIA_FIELDS.join(", ")}`,
    );
  }
  for (const field of RELEASE_CRITERIA_FIELDS) {
    if (!Number.isSafeInteger(criteria[field]) || criteria[field] <= 0) {
      throw new Error(`Shielded release criterion ${field} must be a positive safe integer`);
    }
  }
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", relative], {
      cwd: resolvedRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error("Shielded release criteria must be committed before production setup", {
      cause: error,
    });
  }
  return Object.freeze({ ...criteria });
}

export function snapshotShieldedCompilation({ root, stageBuild, expectedManifest }) {
  expectedManifest ??= readJson(
    root,
    "circuits/shielded-development-manifest.json",
    "Shielded reviewed development manifest",
  ).value;
  if (!sameKeys(expectedManifest.circuits, Object.keys(SHIELDED_SETUP_CIRCUITS))) {
    throw new Error("Shielded compilation baseline must cover all nine circuits");
  }
  const circuits = {};
  for (const [action, spec] of Object.entries(SHIELDED_SETUP_CIRCUITS)) {
    const sourcePath = path.join(root, "circuits", `${spec.source}.circom`);
    const r1cs = path.join(stageBuild, `${spec.source}.r1cs`);
    const wasm = path.join(stageBuild, `${spec.source}_js`, `${spec.source}.wasm`);
    circuits[action] = Object.freeze({
      ...spec,
      sourcePath,
      sourceSha256: sha256File(sourcePath),
      r1cs,
      r1csSha256: sha256File(r1cs),
      wasm,
      wasmSha256: sha256File(wasm),
    });
    for (const field of ["sourceSha256", "r1csSha256", "wasmSha256"]) {
      if (circuits[action][field] !== expectedManifest.circuits[action]?.[field]) {
        throw new Error(
          `${action} shielded ${field} differs from the reviewed compilation baseline`,
        );
      }
    }
  }
  return Object.freeze(circuits);
}

export function assertShieldedCompilationUnchanged(compiled) {
  for (const [action, entry] of Object.entries(compiled)) {
    for (const [label, file, expected] of [
      ["source", entry.sourcePath, entry.sourceSha256],
      ["R1CS", entry.r1cs, entry.r1csSha256],
      ["WASM", entry.wasm, entry.wasmSha256],
    ]) {
      if (sha256File(file) !== expected) {
        throw new Error(`${action} shielded ${label} changed during production setup`);
      }
    }
  }
}

export async function buildShieldedProductionRecords({
  root,
  stageRoot,
  compiled,
  finalized,
  ptau,
  compilerSha256,
  snarkjsRuntimeSha256,
  ceremonyId,
  releaseCriteria,
  operatorParticipantId,
  beaconName,
  beaconHash,
  beaconIterationsExp,
  sourceDigest = sourceBundleSha256(root),
}) {
  if (releaseCriteria !== undefined) {
    if (!sameKeys(releaseCriteria, RELEASE_CRITERIA_FIELDS)) {
      throw new Error("Shielded release criteria are incomplete");
    }
    for (const field of RELEASE_CRITERIA_FIELDS) {
      if (!Number.isSafeInteger(releaseCriteria[field]) || releaseCriteria[field] <= 0) {
        throw new Error(`Shielded release criterion ${field} must be a positive safe integer`);
      }
    }
  }
  requireDigest(sourceDigest, "Shielded source bundle");
  requireDigest(compilerSha256, "Shielded compiler");
  requireDigest(snarkjsRuntimeSha256, "Shielded snarkjs runtime");
  assertShieldedCompilationUnchanged(compiled);
  const circuits = {};
  const transcriptCircuits = {};
  for (const [action, spec] of Object.entries(SHIELDED_SETUP_CIRCUITS)) {
    const built = compiled[action];
    const key = finalized[action];
    if (built?.source !== spec.source || key?.circuitName !== spec.source) {
      throw new Error(`Missing ${action} shielded production artifacts`);
    }
    const zkeySha256 = sha256File(key.finalZkey);
    circuits[action] = {
      source: spec.source,
      publicSignals: spec.publicSignals,
      sourceSha256: built.sourceSha256,
      r1csSha256: built.r1csSha256,
      wasmSha256: built.wasmSha256,
      zkeySha256,
      verificationKeySha256: sha256File(key.verificationKey),
      verifierPath: spec.verifierPath,
      verifierSha256: sha256File(key.solidityVerifier),
      verifierContractName: spec.verifierContractName,
    };
    transcriptCircuits[action] = {
      r1csSha256: built.r1csSha256,
      zkeySha256,
      contributions: [
        {
          participantId: operatorParticipantId,
          contributionHash: key.metadata.operatorContributionHash,
        },
      ],
      beacon: {
        name: beaconName,
        contributionHash: key.metadata.beaconContributionHash,
        hash: beaconHash,
        numIterationsExp: beaconIterationsExp,
      },
    };
  }
  const transcript = {
    schema: "deepfamily/shielded-phase2-transcript@1",
    status: "production",
    ceremonyId,
    phase1Sha256: ptau.sha256,
    circuits: transcriptCircuits,
  };
  const transcriptPath = path.join(stageRoot, "release", "shielded-phase2-transcript.json");
  await fsp.writeFile(transcriptPath, `${JSON.stringify(transcript, null, 2)}\n`, { flag: "wx" });
  const manifest = {
    schema: "deepfamily/shielded-production-artifacts@1",
    status: "production",
    productionReady: true,
    developmentOnly: false,
    sourceBundleSha256: sourceDigest,
    toolchain: {
      circomVersion: CIRCOM_VERSION,
      circomBinarySha256: CIRCOM_LINUX_X64_SHA256,
      snarkjsCliSha256: sha256File(path.join(root, "node_modules/snarkjs/build/cli.cjs")),
      snarkjsRuntimeSha256,
      packageLockSha256: sha256File(path.join(root, "package-lock.json")),
    },
    phase1: { path: PRODUCTION_PTAU_RELATIVE_PATH, sha256: ptau.sha256 },
    phase2: {
      transcriptPath: SHIELDED_PHASE2_TRANSCRIPT_PATH,
      transcriptSha256: sha256File(transcriptPath),
    },
    circuits,
    ...(releaseCriteria === undefined ? {} : { releaseCriteria: { ...releaseCriteria } }),
  };
  const manifestPath = path.join(stageRoot, "release", "shielded-production-manifest.json");
  await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return Object.freeze({ transcriptPath, manifestPath, transcript, manifest });
}

export function shieldedProductionInstallEntries({ compiled, finalized, records }) {
  const entries = [];
  for (const [action, spec] of Object.entries(SHIELDED_SETUP_CIRCUITS)) {
    const built = compiled[action];
    const key = finalized[action];
    const artifact = `zk-artifacts/shielded/${spec.source}`;
    const browser = `frontend/public/zk/shielded/${spec.source}`;
    entries.push(
      { source: built.r1cs, destination: `${artifact}.r1cs` },
      { source: built.wasm, destination: `${artifact}_js/${spec.source}.wasm` },
      { source: key.finalZkey, destination: `${artifact}_final.zkey` },
      { source: key.verificationKey, destination: `${artifact}.vkey.json` },
      { source: key.solidityVerifier, destination: spec.verifierPath },
      { source: built.wasm, destination: `${browser}.wasm` },
      { source: key.finalZkey, destination: `${browser}_final.zkey` },
      { source: key.verificationKey, destination: `${browser}.vkey.json` },
    );
  }
  entries.push(
    { source: records.transcriptPath, destination: SHIELDED_PHASE2_TRANSCRIPT_PATH },
    { source: records.manifestPath, destination: SHIELDED_PRODUCTION_MANIFEST_PATH },
  );
  return entries;
}

/** Static, read-only production checks shared by the artifact and ceremony commands. */
export function inspectShieldedProductionArtifacts({
  root = process.cwd(),
  expectedSnarkjsRuntimeSha256,
  ptauPath,
  env = process.env,
  platform = process.platform,
} = {}) {
  root = path.resolve(root);
  const { absolute: manifestPath, value: manifest } = readJson(
    root,
    SHIELDED_PRODUCTION_MANIFEST_PATH,
    "Shielded production manifest",
    "circuits/",
  );
  if (
    manifest.schema !== "deepfamily/shielded-production-artifacts@1" ||
    manifest.status !== "production" ||
    manifest.productionReady !== true ||
    manifest.developmentOnly !== false
  ) {
    throw new Error("Shielded production manifest is invalid or development-only");
  }
  requireDigest(manifest.sourceBundleSha256, "Shielded source bundle");
  if (
    expectedSnarkjsRuntimeSha256 === undefined &&
    sourceBundleSha256(root) !== manifest.sourceBundleSha256
  ) {
    throw new Error("Shielded production source bundle SHA-256 mismatch");
  }
  if (manifest.toolchain?.circomVersion !== CIRCOM_VERSION) {
    throw new Error("Shielded production Circom version mismatch");
  }
  if (manifest.toolchain?.circomBinarySha256 !== CIRCOM_LINUX_X64_SHA256) {
    throw new Error("Shielded Circom binary must match the pinned canonical compiler");
  }
  requireDigest(manifest.toolchain?.snarkjsRuntimeSha256, "Shielded reviewed snarkjs runtime");
  assertSnarkjsRuntimeHash({
    root,
    expectedSha256: expectedSnarkjsRuntimeSha256 ?? manifest.toolchain.snarkjsRuntimeSha256,
  });
  requireHashedFile(
    root,
    "node_modules/snarkjs/build/cli.cjs",
    manifest.toolchain?.snarkjsCliSha256,
    "snarkjs CLI",
    "node_modules/snarkjs/",
  );
  requireDigest(manifest.toolchain?.packageLockSha256, "Shielded reviewed package lock");
  if (expectedSnarkjsRuntimeSha256 === undefined) {
    requireHashedFile(
      root,
      "package-lock.json",
      manifest.toolchain.packageLockSha256,
      "package lock",
    );
  }
  if (
    manifest.phase1?.path !== PRODUCTION_PTAU_RELATIVE_PATH ||
    manifest.phase1?.sha256 !== PRODUCTION_PTAU_SHA256
  ) {
    throw new Error("Shielded Phase 1 must match the pinned Powers of Tau file");
  }
  const selectedPtauPath =
    typeof ptauPath === "string" && ptauPath.trim() !== ""
      ? path.resolve(root, ptauPath)
      : resolveProductionPtauPath({ root, env, platform });
  const ptauState = fs.lstatSync(selectedPtauPath);
  if (
    !ptauState.isFile() ||
    ptauState.isSymbolicLink() ||
    fs.realpathSync(selectedPtauPath) !== selectedPtauPath
  ) {
    throw new Error("Shielded Phase 1 Powers of Tau must be a regular non-symlink file");
  }
  if (sha256File(selectedPtauPath) !== PRODUCTION_PTAU_SHA256) {
    throw new Error("Shielded Phase 1 Powers of Tau SHA-256 mismatch");
  }
  const { absolute: transcriptPath, value: transcript } = readJson(
    root,
    manifest.phase2?.transcriptPath,
    "Shielded Phase 2 transcript",
    "release-evidence/shielded/",
  );
  if (sha256File(transcriptPath) !== manifest.phase2?.transcriptSha256) {
    throw new Error("Shielded Phase 2 transcript SHA-256 mismatch");
  }
  if (
    transcript.schema !== "deepfamily/shielded-phase2-transcript@1" ||
    transcript.status !== "production" ||
    transcript.phase1Sha256 !== manifest.phase1.sha256
  ) {
    throw new Error("Shielded Phase 2 transcript is invalid");
  }
  const actions = Object.keys(SHIELDED_SETUP_CIRCUITS);
  if (!sameKeys(manifest.circuits, actions) || !sameKeys(transcript.circuits, actions)) {
    throw new Error("Shielded production manifest and transcript must cover all nine circuits");
  }
  if (manifest.releaseCriteria !== undefined) {
    if (!sameKeys(manifest.releaseCriteria, RELEASE_CRITERIA_FIELDS)) {
      throw new Error("Shielded production release criteria are incomplete");
    }
    for (const field of RELEASE_CRITERIA_FIELDS) {
      if (
        !Number.isSafeInteger(manifest.releaseCriteria[field]) ||
        manifest.releaseCriteria[field] <= 0
      ) {
        throw new Error(`Shielded production release criterion ${field} is invalid`);
      }
    }
  }
  const artifacts = {};
  for (const [action, spec] of Object.entries(SHIELDED_SETUP_CIRCUITS)) {
    const item = manifest.circuits[action];
    const ceremony = transcript.circuits[action];
    if (
      item.source !== spec.source ||
      item.publicSignals !== spec.publicSignals ||
      item.verifierContractName !== spec.verifierContractName ||
      item.verifierPath !== spec.verifierPath
    ) {
      throw new Error(`${action} shielded manifest circuit identity mismatch`);
    }
    const prefix = `zk-artifacts/shielded/${spec.source}`;
    const browser = `frontend/public/zk/shielded/${spec.source}`;
    const sourcePath = requireHashedFile(
      root,
      `circuits/${spec.source}.circom`,
      item.sourceSha256,
      `${action} source`,
      "circuits/",
    );
    const r1cs = requireHashedFile(
      root,
      `${prefix}.r1cs`,
      item.r1csSha256,
      `${action} R1CS`,
      "zk-artifacts/shielded/",
    );
    const wasm = requireHashedFile(
      root,
      `${prefix}_js/${spec.source}.wasm`,
      item.wasmSha256,
      `${action} WASM`,
      "zk-artifacts/shielded/",
    );
    const zkey = requireHashedFile(
      root,
      `${browser}_final.zkey`,
      item.zkeySha256,
      `${action} zkey`,
      "frontend/public/zk/shielded/",
    );
    const vkey = requireHashedFile(
      root,
      `${browser}.vkey.json`,
      item.verificationKeySha256,
      `${action} vkey`,
      "frontend/public/zk/shielded/",
    );
    const verifier = requireHashedFile(
      root,
      item.verifierPath,
      item.verifierSha256,
      `${action} verifier`,
      "contracts/",
    );
    requireHashedFile(
      root,
      `${browser}.wasm`,
      item.wasmSha256,
      `${action} browser WASM`,
      "frontend/public/zk/shielded/",
    );
    const parsedVkey = JSON.parse(fs.readFileSync(vkey, "utf8"));
    if (parsedVkey.nPublic !== spec.publicSignals) {
      throw new Error(`${action} verification key public-signal count mismatch`);
    }
    if (
      ceremony.r1csSha256 !== item.r1csSha256 ||
      ceremony.zkeySha256 !== item.zkeySha256 ||
      !Array.isArray(ceremony.contributions) ||
      ceremony.contributions.length === 0
    ) {
      throw new Error(`${action} Phase 2 contribution evidence is invalid`);
    }
    for (const contribution of ceremony.contributions) {
      if (
        typeof contribution.participantId !== "string" ||
        contribution.participantId.trim().length < 3 ||
        /development|test|local-only/iu.test(contribution.participantId) ||
        !BLAKE2B512.test(contribution.contributionHash ?? "")
      ) {
        throw new Error(`${action} Phase 2 participant evidence is invalid`);
      }
    }
    if (
      !ceremony.beacon ||
      typeof ceremony.beacon.name !== "string" ||
      !SHA256.test(ceremony.beacon.hash ?? "") ||
      !BLAKE2B512.test(ceremony.beacon.contributionHash ?? "") ||
      !Number.isSafeInteger(ceremony.beacon.numIterationsExp) ||
      ceremony.beacon.numIterationsExp <= 0
    ) {
      throw new Error(`${action} Phase 2 beacon evidence is invalid`);
    }
    artifacts[action] = { sourcePath, r1cs, wasm, zkey, vkey, verifier, item, ceremony, spec };
  }
  return Object.freeze({
    manifest,
    transcript,
    manifestSha256: sha256File(manifestPath),
    artifacts: Object.freeze(artifacts),
    ptauPath: selectedPtauPath,
  });
}

/** Read-only verification uses the same private runtime and input isolation as the core ceremony. */
export async function verifyShieldedProductionCeremony({ root = process.cwd(), ...options } = {}) {
  const resolvedRoot = path.resolve(root);
  const inspectionOptions = {
    root: resolvedRoot,
    ptauPath: options.ptauPath,
    env: options.env,
    platform: options.platform,
  };
  const inspected = inspectShieldedProductionArtifacts(inspectionOptions);
  const verified = await verifyShieldedCeremonyArtifacts({
    root: resolvedRoot,
    inspected,
    ...options,
    ptauPath: inspected.ptauPath,
  });
  const final = inspectShieldedProductionArtifacts({
    ...inspectionOptions,
    ptauPath: inspected.ptauPath,
  });
  if (final.manifestSha256 !== inspected.manifestSha256) {
    throw new Error("Shielded production manifest changed during ceremony verification");
  }
  return verified;
}

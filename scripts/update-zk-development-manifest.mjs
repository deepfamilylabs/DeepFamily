#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ZK_ARTIFACT_MANIFEST_PATH,
  ZK_CEREMONY_TRANSCRIPT_PATH,
  ZK_RELEASE_ARTIFACTS,
  ZK_TOOLCHAIN_PATHS,
  inspectZkReleaseArtifacts,
  readCanonicalJsonFile,
  sha256CanonicalTextFile,
  sha256File,
  validateZkArtifactManifest,
} from "./lib/zkArtifactTrust.mjs";
import { inspectSnarkjsRuntime, resolveSnarkjsCliPath } from "./lib/snarkjsToolchain.mjs";

const writeJsonAtomic = (filePath, value) => {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const mode = fs.statSync(filePath).mode & 0o777;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.renameSync(temporaryPath, filePath);
};

export const PRE_V1_CEREMONY_ID = "deepfamily-single-operator-20260804T103721Z";
export const PRE_V1_ARCHIVE_DIRECTORY = "circuits/pre-v1";
export const PRE_V1_MANIFEST_ARCHIVE_PATH = `${PRE_V1_ARCHIVE_DIRECTORY}/zk-artifacts-manifest.json`;
export const PRE_V1_TRANSCRIPT_ARCHIVE_PATH = `${PRE_V1_ARCHIVE_DIRECTORY}/zk-ceremony-transcript.json`;
export const PRE_V1_DEPRECATION_RECORD_PATH = `${PRE_V1_ARCHIVE_DIRECTORY}/deprecation.json`;
export const FRESH_V1_DEVELOPMENT_WARNING =
  "Fresh-v1 development keys use one public fixed-entropy contributor; production ceremony required.";

const writeArchivedEvidence = (filePath, contents, mode) => {
  if (fs.existsSync(filePath)) {
    if (fs.readFileSync(filePath).equals(contents)) return;
    throw new Error(`Refusing to overwrite different pre-v1 ceremony evidence: ${filePath}`);
  }
  fs.writeFileSync(filePath, contents, { flag: "wx", mode });
};

export const initializeFreshV1DevelopmentManifest = ({ root = process.cwd() } = {}) => {
  const manifestPath = path.join(root, ZK_ARTIFACT_MANIFEST_PATH);
  const { parsed: manifest, raw: manifestRaw } = readCanonicalJsonFile(
    manifestPath,
    "ZK artifact manifest",
  );
  validateZkArtifactManifest(manifest);
  if (manifest.trustedSetup.status === "development") {
    return Object.freeze({ status: "already-development", manifestPath });
  }
  if (manifest.trustedSetup.ceremonyId !== PRE_V1_CEREMONY_ID) {
    throw new Error(
      `--fresh-v1 only deprecates the reviewed pre-v1 ceremony ${PRE_V1_CEREMONY_ID}`,
    );
  }
  if (manifest.trustedSetup.transcript.path !== ZK_CEREMONY_TRANSCRIPT_PATH) {
    throw new Error("Pre-v1 production manifest references an unexpected ceremony transcript");
  }

  const transcriptPath = path.join(root, ZK_CEREMONY_TRANSCRIPT_PATH);
  const { raw: transcriptRaw } = readCanonicalJsonFile(
    transcriptPath,
    "pre-v1 ceremony transcript",
  );
  const transcriptSha256 = sha256CanonicalTextFile(transcriptPath, "pre-v1 ceremony transcript");
  if (transcriptSha256 !== manifest.trustedSetup.transcript.sha256) {
    throw new Error("Pre-v1 ceremony transcript hash does not match its production manifest");
  }

  const archiveDirectory = path.join(root, PRE_V1_ARCHIVE_DIRECTORY);
  fs.mkdirSync(archiveDirectory, { recursive: true });
  const manifestMode = fs.statSync(manifestPath).mode & 0o777;
  const transcriptMode = fs.statSync(transcriptPath).mode & 0o777;
  writeArchivedEvidence(
    path.join(root, PRE_V1_MANIFEST_ARCHIVE_PATH),
    Buffer.from(manifestRaw, "utf8"),
    manifestMode,
  );
  writeArchivedEvidence(
    path.join(root, PRE_V1_TRANSCRIPT_ARCHIVE_PATH),
    Buffer.from(transcriptRaw, "utf8"),
    transcriptMode,
  );

  const deprecationRecord = {
    schemaVersion: 1,
    status: "deprecated-pre-v1",
    ceremonyId: PRE_V1_CEREMONY_ID,
    reason:
      "Fresh-v1 changes both circuit constraints and public-signal ABI; these Phase 2 keys and verifiers are incompatible.",
    archivedManifest: {
      path: PRE_V1_MANIFEST_ARCHIVE_PATH,
      sha256: sha256File(manifestPath),
    },
    archivedTranscript: {
      path: PRE_V1_TRANSCRIPT_ARCHIVE_PATH,
      sha256: transcriptSha256,
    },
    replacement: {
      status: "development-only",
      command: "npm run zk:dev:fresh-v1",
      productionCeremonyRequired: true,
    },
  };
  const deprecationPath = path.join(root, PRE_V1_DEPRECATION_RECORD_PATH);
  const deprecationRaw = Buffer.from(`${JSON.stringify(deprecationRecord, null, 2)}\n`, "utf8");
  writeArchivedEvidence(deprecationPath, deprecationRaw, 0o640);

  const developmentManifest = {
    ...manifest,
    trustedSetup: {
      status: "development",
      trustModel: "single-operator",
      warning: FRESH_V1_DEVELOPMENT_WARNING,
      minimumContributors: 1,
      contributorCount: 1,
      beaconApplied: false,
      transcriptSha256: null,
    },
  };
  writeJsonAtomic(manifestPath, developmentManifest);
  return Object.freeze({
    status: "initialized-fresh-v1-development",
    manifestPath,
    deprecationPath,
  });
};

export const assertDevelopmentManifest = ({ root = process.cwd() } = {}) => {
  const manifestPath = path.join(root, ZK_ARTIFACT_MANIFEST_PATH);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  validateZkArtifactManifest(manifest);
  if (manifest.trustedSetup.status !== "development") {
    throw new Error(
      "Refusing to rewrite a production ceremony manifest with development artifact hashes",
    );
  }
  return manifest;
};

export const updateDevelopmentManifest = ({ root = process.cwd() } = {}) => {
  const manifestPath = path.join(root, ZK_ARTIFACT_MANIFEST_PATH);
  const manifest = assertDevelopmentManifest({ root });
  manifest.schemaVersion = 3;

  for (const [circuitName, spec] of Object.entries(ZK_RELEASE_ARTIFACTS)) {
    manifest.circuits[circuitName] = {
      sourceSha256: sha256CanonicalTextFile(path.join(root, spec.source), `${circuitName} source`),
      r1csSha256: sha256File(path.join(root, spec.builtR1cs)),
      wasmSha256: sha256File(path.join(root, spec.wasm)),
      zkeySha256: sha256File(path.join(root, spec.zkey)),
      verificationKeySha256: sha256CanonicalTextFile(
        path.join(root, spec.verificationKey),
        `${circuitName} verification key`,
      ),
      solidityVerifierSha256: sha256CanonicalTextFile(
        path.join(root, spec.solidityVerifier),
        `${circuitName} Solidity verifier`,
      ),
    };
  }
  manifest.toolchain = {
    circomBinarySha256: sha256File(path.join(root, ZK_TOOLCHAIN_PATHS.circomBinary)),
    snarkjsCliSha256: sha256File(resolveSnarkjsCliPath({ root })),
    snarkjsRuntimeSha256: inspectSnarkjsRuntime({ root }).sha256,
  };
  writeJsonAtomic(manifestPath, manifest);
  return inspectZkReleaseArtifacts({
    root,
    requireProduction: false,
    requireBuiltR1cs: true,
  });
};

export const main = (argv = process.argv.slice(2)) => {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--check")) {
    throw new Error("Usage: node scripts/update-zk-development-manifest.mjs [--check]");
  }
  if (argv[0] === "--check") {
    assertDevelopmentManifest();
    console.log("Development-only ZK manifest confirmed; local key regeneration is allowed.");
    return;
  }
  const evidence = updateDevelopmentManifest();
  console.warn(
    "Development ZK manifest refreshed. These proving keys remain blocked from production release.",
  );
  console.log(`Manifest SHA-256: ${evidence.manifestSha256}`);
};

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(`[zk-development-manifest] ${error.message}`);
    process.exitCode = 1;
  }
}

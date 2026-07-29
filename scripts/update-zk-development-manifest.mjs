#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ZK_ARTIFACT_MANIFEST_PATH,
  ZK_RELEASE_ARTIFACTS,
  ZK_TOOLCHAIN_PATHS,
  inspectZkReleaseArtifacts,
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

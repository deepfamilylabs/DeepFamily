import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getStorageUpgradeErrors } = require("@openzeppelin/upgrades-core");

const PROJECT_ROOT = process.cwd();
export const BASELINE_DIR = "storage-layouts";

export function readJson(relativePath) {
  const filePath = path.join(PROJECT_ROOT, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`${relativePath} not found. Run npm run build first.`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

// Resolve a Hardhat artifact JSON to its `storageLayout` by looking up its build-info
// output. Solidity must be configured to emit storageLayout (hardhat.config.mjs does).
export function loadStorageLayoutFromArtifactObject(artifact) {
  const { buildInfoId, inputSourceName, contractName } = artifact;
  if (!buildInfoId) {
    throw new Error(`Artifact ${contractName} has no buildInfoId. Run npm run build first.`);
  }
  const buildOutput = readJson(`artifacts/build-info/${buildInfoId}.output.json`).output;
  const storageLayout = buildOutput?.contracts?.[inputSourceName]?.[contractName]?.storageLayout;
  if (!storageLayout) {
    throw new Error(
      `${contractName} has no storageLayout in build output. ` +
        "Ensure hardhat.config.mjs emits storageLayout and rerun npm run build.",
    );
  }
  return storageLayout;
}

export function loadStorageLayout(artifactPath) {
  return loadStorageLayoutFromArtifactObject(readJson(artifactPath));
}

export function readBaseline(proxyName) {
  const baselinePath = path.join(BASELINE_DIR, `${proxyName}.json`);
  const baselineAbs = path.join(PROJECT_ROOT, baselinePath);
  if (!fs.existsSync(baselineAbs)) {
    throw new Error(
      `No storage baseline for ${proxyName} (${baselinePath}). ` +
        "Run npm run storage:check first to create it.",
    );
  }
  return { layout: readJson(baselinePath), path: baselinePath };
}

// Diff a candidate implementation's storage layout against the committed baseline of the
// proxy it will replace. Returns the OZ upgrades-core error list (empty on success).
export function checkImplementationAgainstBaseline({ proxyName, implementationArtifact }) {
  const { layout: baseline } = readBaseline(proxyName);
  const candidate = loadStorageLayoutFromArtifactObject(implementationArtifact);
  return getStorageUpgradeErrors(baseline, candidate);
}

export function diffLayouts(fromLayout, toLayout) {
  return getStorageUpgradeErrors(fromLayout, toLayout);
}

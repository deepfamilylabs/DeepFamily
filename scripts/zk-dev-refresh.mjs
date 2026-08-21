#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { syncZkAssets } from "../circuits/sync-zk-assets.mjs";
import { ensureProductionPtau } from "./lib/productionPtau.mjs";
import { buildSnarkjsCommand } from "./lib/snarkjsToolchain.mjs";
import {
  assertDevelopmentManifest,
  initializeFreshV1DevelopmentManifest,
  updateDevelopmentManifest,
} from "./update-zk-development-manifest.mjs";

export const DEVELOPMENT_CONTRIBUTOR_NAME = "development-only";
export const DEVELOPMENT_PUBLIC_ENTROPY = "development-only-public-entropy";

export const DEVELOPMENT_CIRCUITS = Object.freeze(
  [
    {
      name: "person_commitment",
      verifierPath: "contracts/PersonCommitmentVerifier.sol",
      verifierContractName: "PersonCommitmentVerifier",
    },
    {
      name: "disclosure_binding",
      verifierPath: "contracts/DisclosureBindingVerifier.sol",
      verifierContractName: "DisclosureBindingVerifier",
    },
  ].map((circuit) => Object.freeze(circuit)),
);

const absolute = (root, relativePath) => path.join(root, ...relativePath.split("/"));

export const buildDevelopmentSetupCommands = ({ root, ptauPath, temporaryDirectory } = {}) => {
  const resolvedRoot = path.resolve(root);
  const renameVerifierScript = absolute(resolvedRoot, "scripts/rename-zk-verifier.mjs");
  const artifactDirectory = absolute(resolvedRoot, "zk-artifacts/circuits");

  return DEVELOPMENT_CIRCUITS.flatMap((circuit) => {
    const initialZkey = path.join(temporaryDirectory, `${circuit.name}_0000.zkey`);
    const finalZkey = path.join(artifactDirectory, `${circuit.name}_final.zkey`);
    const verificationKey = path.join(artifactDirectory, `${circuit.name}.vkey.json`);
    const verifierPath = absolute(resolvedRoot, circuit.verifierPath);
    return [
      buildSnarkjsCommand({
        root: resolvedRoot,
        args: [
          "groth16",
          "setup",
          path.join(artifactDirectory, `${circuit.name}.r1cs`),
          ptauPath,
          initialZkey,
        ],
      }),
      buildSnarkjsCommand({
        root: resolvedRoot,
        args: [
          "zkey",
          "contribute",
          initialZkey,
          finalZkey,
          `--name=${DEVELOPMENT_CONTRIBUTOR_NAME}`,
          "-v",
          `-e=${DEVELOPMENT_PUBLIC_ENTROPY}`,
        ],
      }),
      buildSnarkjsCommand({
        root: resolvedRoot,
        args: ["zkey", "export", "verificationkey", finalZkey, verificationKey],
      }),
      buildSnarkjsCommand({
        root: resolvedRoot,
        args: ["zkey", "export", "solidityverifier", finalZkey, verifierPath],
      }),
      {
        executable: process.execPath,
        args: [renameVerifierScript, verifierPath, circuit.verifierContractName],
      },
    ];
  });
};

export const runCommand = ({ executable, args, cwd }) =>
  execFileSync(executable, args, {
    cwd,
    stdio: "inherit",
  });

export const runZkDevelopmentRefresh = async ({
  root = process.cwd(),
  output = console,
  manifestGuard = assertDevelopmentManifest,
  freshV1 = false,
  freshV1Initializer = initializeFreshV1DevelopmentManifest,
  ptauInstaller = ensureProductionPtau,
  commandRunner = runCommand,
  assetSynchronizer = syncZkAssets,
  manifestUpdater = updateDevelopmentManifest,
  temporaryDirectoryFactory = () =>
    fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-zk-development-")),
  temporaryDirectoryRemover = (directory) => fs.rmSync(directory, { recursive: true, force: true }),
} = {}) => {
  const resolvedRoot = path.resolve(root);

  // This must remain the first operation: every later dependency can write files.
  if (freshV1) {
    await freshV1Initializer({ root: resolvedRoot });
  } else {
    await manifestGuard({ root: resolvedRoot });
  }

  const ptau = await ptauInstaller({ root: resolvedRoot });
  output.log(`Pinned Powers of Tau ${ptau.status}: ${ptau.path} (SHA-256 ${ptau.sha256})`);

  let temporaryDirectory;
  try {
    temporaryDirectory = temporaryDirectoryFactory();

    await commandRunner({
      executable: process.execPath,
      args: [absolute(resolvedRoot, "scripts/zk-build.mjs")],
      cwd: resolvedRoot,
    });

    for (const command of buildDevelopmentSetupCommands({
      root: resolvedRoot,
      ptauPath: ptau.path,
      temporaryDirectory,
    })) {
      await commandRunner({ ...command, cwd: resolvedRoot });
    }

    const syncResult = await assetSynchronizer({
      sourceDirectory: absolute(resolvedRoot, "zk-artifacts/circuits"),
      destinationDirectory: absolute(resolvedRoot, "frontend/public/zk"),
      output,
    });
    if (syncResult.exitCode !== 0) {
      throw new Error("ZK frontend artifact synchronization failed");
    }

    const manifestEvidence = await manifestUpdater({ root: resolvedRoot });

    await commandRunner({
      executable: process.execPath,
      args: [absolute(resolvedRoot, "scripts/zk-check.mjs")],
      cwd: resolvedRoot,
    });

    output.warn(
      "Development ZK artifacts refreshed with public entropy; they remain blocked from production.",
    );
    return Object.freeze({
      status: "passed",
      ptau: Object.freeze({ ...ptau }),
      manifestEvidence,
    });
  } finally {
    if (temporaryDirectory !== undefined) temporaryDirectoryRemover(temporaryDirectory);
  }
};

export const main = async (argv = process.argv.slice(2)) => {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--fresh-v1")) {
    throw new Error("Usage: node scripts/zk-dev-refresh.mjs [--fresh-v1]");
  }
  return runZkDevelopmentRefresh({ freshV1: argv[0] === "--fresh-v1" });
};

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((error) => {
    console.error(`[zk-dev-refresh] ${error.message}`);
    process.exitCode = 1;
  });
}

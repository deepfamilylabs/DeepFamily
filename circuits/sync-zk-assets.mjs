#!/usr/bin/env node
// Synchronize compiled circuit artifacts into the frontend public assets directory.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  debug: (...args) => (console.debug ? console.debug(...args) : console.log(...args)),
};

const projectRoot = path.resolve(__dirname, "..");
const artifactsDir = path.join(projectRoot, "zk-artifacts", "circuits");
const targetDir = path.join(projectRoot, "frontend", "public", "zk");

export const FILES_TO_COPY = Object.freeze(
  [
    {
      source: "disclosure_binding_final.zkey",
      destination: "disclosure_binding_final.zkey",
    },
    {
      source: "disclosure_binding.vkey.json",
      destination: "disclosure_binding.vkey.json",
    },
    {
      source: "disclosure_binding_js/disclosure_binding.wasm",
      destination: "disclosure_binding.wasm",
    },
    {
      source: "person_commitment_final.zkey",
      destination: "person_commitment_final.zkey",
    },
    {
      source: "person_commitment.vkey.json",
      destination: "person_commitment.vkey.json",
    },
    {
      source: "person_commitment_js/person_commitment.wasm",
      destination: "person_commitment.wasm",
    },
  ].map((entry) => Object.freeze(entry)),
);

async function ensureDirectoryExists(directory) {
  await fs.promises.mkdir(directory, { recursive: true });
}

export async function syncZkAssets({
  sourceDirectory = artifactsDir,
  destinationDirectory = targetDir,
  output = console,
  copyArtifact = (sourcePath, destinationPath) => fs.promises.copyFile(sourcePath, destinationPath),
  exportVerificationKey = (zkeyPath) => snarkjs.zKey.exportVerificationKey(zkeyPath, logger),
} = {}) {
  output.log("Syncing circuit artifacts to frontend/public/zk ...");

  await ensureDirectoryExists(destinationDirectory);

  const failedFiles = [];

  for (const entry of FILES_TO_COPY) {
    const destinationPath = path.join(destinationDirectory, entry.destination);
    const sourcePath = path.join(sourceDirectory, entry.source);

    if (!fs.existsSync(sourcePath) && entry.destination.endsWith(".vkey.json")) {
      const circuitBase = entry.destination.replace(".vkey.json", "");
      const zkeyName = `${circuitBase}_final.zkey`;
      const zkeyPath = path.join(sourceDirectory, zkeyName);

      if (fs.existsSync(zkeyPath)) {
        try {
          output.log(`Generating ${entry.destination} from ${zkeyPath}`);
          const verificationKey = await exportVerificationKey(zkeyPath);
          await fs.promises.writeFile(
            sourcePath,
            `${JSON.stringify(verificationKey, null, 2)}\n`,
            "utf8",
          );
        } catch (error) {
          output.error(`Failed to generate ${entry.destination}: ${error.message}`);
          failedFiles.push(sourcePath);
          continue;
        }
      }
    }

    if (!fs.existsSync(sourcePath)) {
      failedFiles.push(sourcePath);
      output.error(`Missing artifact: ${sourcePath}`);
      continue;
    }

    try {
      await copyArtifact(sourcePath, destinationPath);
      output.log(`Copied ${path.basename(sourcePath)} -> ${destinationPath}`);
    } catch (error) {
      output.error(`Failed to copy ${entry.destination}: ${error.message}`);
      failedFiles.push(sourcePath);
    }
  }

  if (failedFiles.length > 0) {
    output.error("Finished with missing or failed artifacts:");
    failedFiles.forEach((filePath) => output.error(`  - ${filePath}`));
    return { exitCode: 1, failedFiles };
  }

  output.log("Circuit artifacts synchronized successfully.");
  return { exitCode: 0, failedFiles };
}

export async function main(options) {
  const result = await syncZkAssets(options);
  return result.exitCode;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error("Unexpected error while syncing artifacts:", error);
      process.exitCode = 1;
    });
}

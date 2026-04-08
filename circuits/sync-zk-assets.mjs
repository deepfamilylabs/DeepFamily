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

const filesToCopy = [
  "disclosure_binding_final.zkey",
  "disclosure_binding.vkey.json",
  "disclosure_binding.wasm",
  "person_commitment_final.zkey",
  "person_commitment.vkey.json",
  "person_commitment.wasm",
];

async function ensureDirectoryExists(directory) {
  await fs.promises.mkdir(directory, { recursive: true });
}

async function findFile(baseDir, fileName) {
  const stack = [baseDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    let entries;

    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    for (const entry of entries) {
      const resolved = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(resolved);
      } else if (entry.name === fileName) {
        return resolved;
      }
    }
  }

  return null;
}

async function copyFile(src, dest) {
  await fs.promises.copyFile(src, dest);
  console.log(`Copied ${path.basename(src)} -> ${dest}`);
}

async function main() {
  console.log("Syncing circuit artifacts to frontend/public/zk ...");

  await ensureDirectoryExists(targetDir);

  const missingFiles = [];

  for (const fileName of filesToCopy) {
    const destinationPath = path.join(targetDir, fileName);
    let sourcePath = await findFile(artifactsDir, fileName);

    if (!sourcePath && fileName.endsWith(".vkey.json")) {
      const circuitBase = fileName.replace(".vkey.json", "");
      const zkeyName = `${circuitBase}_final.zkey`;
      const zkeyPath = await findFile(artifactsDir, zkeyName);

      if (zkeyPath) {
        try {
          sourcePath = path.join(artifactsDir, fileName);
          console.log(`Generating ${fileName} from ${zkeyPath}`);
          const verificationKey = await snarkjs.zKey.exportVerificationKey(zkeyPath, logger);
          await fs.promises.writeFile(
            sourcePath,
            `${JSON.stringify(verificationKey, null, 2)}\n`,
            "utf8",
          );
        } catch (error) {
          console.error(`Failed to generate ${fileName}:`, error.message);
          sourcePath = null;
        }
      }
    }

    if (!sourcePath) {
      missingFiles.push(path.join(artifactsDir, fileName));
      console.error(`Missing artifact: ${path.join(artifactsDir, fileName)}`);
      continue;
    }

    try {
      await copyFile(sourcePath, destinationPath);
    } catch (error) {
      console.error(`Failed to copy ${fileName}:`, error.message);
      missingFiles.push(sourcePath);
    }
  }

  if (missingFiles.length > 0) {
    console.error("Finished with missing artifacts:");
    missingFiles.forEach((filePath) => console.error(`  - ${filePath}`));
    process.exitCode = 1;
    return;
  }

  console.log("Circuit artifacts synchronized successfully.");
}

main().catch((error) => {
  console.error("Unexpected error while syncing artifacts:", error);
});

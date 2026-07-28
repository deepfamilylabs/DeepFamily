#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CIRCOM_VERSION = "2.1.6";
export const CIRCOM_LINUX_X64_SHA256 =
  "f3958483caaaa0cdd3912df5049e2e635eab4d09b9a66807be9633d547859f12";
export const CIRCOM_LINUX_X64_URL = `https://github.com/iden3/circom/releases/download/v${CIRCOM_VERSION}/circom-linux-amd64`;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export const installPinnedCircom = async ({
  projectRoot = process.cwd(),
  expectedSha256 = CIRCOM_LINUX_X64_SHA256,
  url = CIRCOM_LINUX_X64_URL,
  download = async (url) => {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`Circom download failed with HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  },
} = {}) => {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("The pinned Circom installer currently supports only Linux x64");
  }
  const binDirectory = path.join(projectRoot, "bin");
  const destination = path.join(binDirectory, "circom");
  await fs.mkdir(binDirectory, { recursive: true });

  try {
    const state = await fs.lstat(destination);
    if (!state.isFile() || state.isSymbolicLink()) {
      throw new Error("Existing bin/circom must be a regular non-symlink file");
    }
    const existing = await fs.readFile(destination);
    if (sha256(existing) === expectedSha256) {
      await fs.chmod(destination, 0o755);
      return Object.freeze({ status: "already-installed", path: destination });
    }
    throw new Error(
      "Existing bin/circom does not match the pinned SHA-256; remove it only after review",
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const bytes = await download(url);
  const digest = sha256(bytes);
  if (digest !== expectedSha256) {
    throw new Error(
      `Downloaded Circom SHA-256 mismatch; expected ${expectedSha256}, got ${digest}`,
    );
  }

  const temporaryPath = path.join(
    binDirectory,
    `.circom-${process.pid}-${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    await fs.writeFile(temporaryPath, bytes, { flag: "wx", mode: 0o700 });
    await fs.rename(temporaryPath, destination);
    await fs.chmod(destination, 0o755);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
  return Object.freeze({ status: "installed", path: destination });
};

export const main = async () => {
  const result = await installPinnedCircom();
  console.log(`Circom ${CIRCOM_VERSION} ${result.status}: ${result.path}`);
};

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((error) => {
    console.error(`[circom-fetch] ${error.message}`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");

export const PROTOCOL_RUNTIME_ROOTS = Object.freeze([
  "contracts",
  "hardhat",
  "lib",
  "packages",
  "scripts",
  "tasks",
  "frontend/src",
]);

export const FORBIDDEN_PROTOCOL_IDENTIFIERS = Object.freeze([
  "metadataCID",
  "metadataArchiveId",
  "proofSystemId",
  "passwordFingerprint",
  "IdentitySaltMode",
  "recoverySalt",
  "randomSalt",
  "generateRandomSalt",
  "archiveRegistry",
  "df-meta-v2",
]);

const REMOVED_PROTOCOL_PATHS = Object.freeze(["scripts/test-keygen-demo.mjs"]);
const SOURCE_EXTENSION = /\.(?:cjs|js|jsx|mjs|sol|ts|tsx)$/u;
const TEST_FILE = /\.(?:spec|test)\.(?:cjs|js|jsx|mjs|ts|tsx)$/u;
const IGNORED_DIRECTORY_NAMES = new Set([
  "__tests__",
  "artifacts",
  "cache",
  "coverage",
  "dist",
  "node_modules",
  "test",
  "tests",
]);

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const identifierPattern = (identifier) =>
  identifier.includes("-")
    ? new RegExp(escapeRegExp(identifier), "u")
    : new RegExp(`\\b${escapeRegExp(identifier)}\\b`, "u");

const FORBIDDEN_PATTERNS = FORBIDDEN_PROTOCOL_IDENTIFIERS.map((identifier) =>
  Object.freeze({ identifier, pattern: identifierPattern(identifier) }),
);

const toPosix = (value) => value.split(path.sep).join("/");

const collectSourceFiles = ({ root, relativeRoot, violations }) => {
  const absoluteRoot = path.join(root, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return [];

  const files = [];
  const visit = (absolutePath) => {
    const relativePath = toPosix(path.relative(root, absolutePath));
    const state = fs.lstatSync(absolutePath);
    if (state.isSymbolicLink()) {
      violations.push(`symbolic link inside protocol runtime sources: ${relativePath}`);
      return;
    }
    if (state.isDirectory()) {
      if (
        absolutePath !== absoluteRoot &&
        IGNORED_DIRECTORY_NAMES.has(path.basename(absolutePath))
      ) {
        return;
      }
      for (const entry of fs.readdirSync(absolutePath).sort()) {
        visit(path.join(absolutePath, entry));
      }
      return;
    }
    if (!state.isFile() || !SOURCE_EXTENSION.test(relativePath) || TEST_FILE.test(relativePath)) {
      return;
    }
    if (path.resolve(absolutePath) === path.resolve(root, "scripts/check-protocol-legacy.mjs")) {
      return;
    }
    files.push({ absolutePath, relativePath });
  };

  visit(absoluteRoot);
  return files;
};

export const scanProtocolLegacySources = ({
  root = REPOSITORY_ROOT,
  runtimeRoots = PROTOCOL_RUNTIME_ROOTS,
} = {}) => {
  const resolvedRoot = path.resolve(root);
  const violations = [];

  for (const removedPath of REMOVED_PROTOCOL_PATHS) {
    if (fs.existsSync(path.join(resolvedRoot, removedPath))) {
      violations.push(`removed protocol artifact was restored: ${removedPath}`);
    }
  }

  const seen = new Set();
  for (const relativeRoot of runtimeRoots) {
    for (const file of collectSourceFiles({
      root: resolvedRoot,
      relativeRoot,
      violations,
    })) {
      if (seen.has(file.absolutePath)) continue;
      seen.add(file.absolutePath);
      const source = fs.readFileSync(file.absolutePath, "utf8");
      for (const { identifier, pattern } of FORBIDDEN_PATTERNS) {
        if (pattern.test(source)) {
          violations.push(`legacy protocol identifier ${identifier} in ${file.relativePath}`);
        }
      }
    }
  }

  return Object.freeze([...violations].sort());
};

export const assertNoProtocolLegacySources = (options) => {
  const violations = scanProtocolLegacySources(options);
  if (violations.length > 0) {
    throw new Error(
      `Protocol legacy source audit failed:\n${violations.map((x) => `- ${x}`).join("\n")}`,
    );
  }
  return Object.freeze({
    status: "passed",
    checkedRoots: Object.freeze([...PROTOCOL_RUNTIME_ROOTS]),
  });
};

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === SCRIPT_PATH;
if (isMain) {
  try {
    assertNoProtocolLegacySources();
    console.log("Fresh-v1 runtime sources contain no forbidden legacy protocol identifiers.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

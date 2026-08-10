import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const MAX_COMMAND_INPUT_BYTES = 64 * 1024;
const HASH_32_PATTERN = /^0x[0-9a-fA-F]{64}$/u;

const pathIsWithin = (root, target) => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
};

const requirePlainObject = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return value;
};

const requireExactKeys = (value, expectedKeys, label) => {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} must contain exactly: ${expected.join(", ")}`);
  }
};

const resolveCommandInputPath = async ({ filePath, root, label }) => {
  if (typeof filePath !== "string" || filePath === "" || filePath.trim() !== filePath) {
    throw new Error(`${label} path must be an explicit non-empty trimmed path`);
  }
  if (typeof root !== "string" || root.trim() === "") {
    throw new Error("Mainnet command input root must be a non-empty path");
  }

  const resolvedRoot = path.resolve(root);
  const realRoot = await fs.realpath(resolvedRoot);
  if (realRoot !== resolvedRoot) {
    throw new Error("Mainnet command input root must not traverse a symbolic link");
  }
  const rootState = await fs.lstat(realRoot);
  if (!rootState.isDirectory() || rootState.isSymbolicLink()) {
    throw new Error("Mainnet command input root must be a regular directory");
  }

  const resolvedPath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(realRoot, filePath);
  if (!pathIsWithin(realRoot, resolvedPath) || resolvedPath === realRoot) {
    throw new Error(`${label} must be located inside the repository root`);
  }

  const components = path.relative(realRoot, resolvedPath).split(path.sep);
  let current = realRoot;
  let expectedFileState;
  for (const [index, component] of components.entries()) {
    current = path.join(current, component);
    let state;
    try {
      state = await fs.lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error(`${label} does not exist: ${resolvedPath}`);
      throw error;
    }
    if (state.isSymbolicLink()) {
      throw new Error(`${label} path must not traverse a symbolic link`);
    }
    if (index < components.length - 1 && !state.isDirectory()) {
      throw new Error(`${label} path contains a non-directory component`);
    }
    if (index === components.length - 1) expectedFileState = state;
  }

  const realPath = await fs.realpath(resolvedPath);
  if (realPath !== resolvedPath || !pathIsWithin(realRoot, realPath)) {
    throw new Error(`${label} path must not traverse a symbolic link`);
  }
  return { realPath, expectedFileState };
};

const readCommandInputJson = async ({ filePath, root, label }) => {
  const { realPath: resolvedPath, expectedFileState } = await resolveCommandInputPath({
    filePath,
    root,
    label,
  });
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await fs.open(resolvedPath, fsConstants.O_RDONLY | noFollow);
  let bytes;
  let openedState;
  try {
    openedState = await handle.stat();
    if (!openedState.isFile()) throw new Error(`${label} must be a regular file`);
    if (
      openedState.dev !== expectedFileState.dev ||
      openedState.ino !== expectedFileState.ino ||
      openedState.size !== expectedFileState.size ||
      openedState.mtimeMs !== expectedFileState.mtimeMs ||
      openedState.ctimeMs !== expectedFileState.ctimeMs
    ) {
      throw new Error(`${label} changed before it was read`);
    }
    if (openedState.size > MAX_COMMAND_INPUT_BYTES) {
      throw new Error(`${label} exceeds the 64 KiB size limit`);
    }
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }

  const finalState = await fs.lstat(resolvedPath);
  if (
    finalState.isSymbolicLink() ||
    !finalState.isFile() ||
    finalState.dev !== openedState.dev ||
    finalState.ino !== openedState.ino ||
    finalState.size !== openedState.size ||
    finalState.mtimeMs !== openedState.mtimeMs ||
    finalState.ctimeMs !== openedState.ctimeMs
  ) {
    throw new Error(`${label} changed while it was being read`);
  }

  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
};

export const readReleaseApprovalFile = async ({ filePath, root = process.cwd() } = {}) => {
  const label = "Mainnet release approval file";
  const parsed = requirePlainObject(await readCommandInputJson({ filePath, root, label }), label);
  requireExactKeys(parsed, ["planDigest", "signatures"], label);

  if (typeof parsed.planDigest !== "string" || !HASH_32_PATTERN.test(parsed.planDigest)) {
    throw new Error(`${label}.planDigest must be a 32-byte 0x-prefixed hash`);
  }
  if (
    !Array.isArray(parsed.signatures) ||
    parsed.signatures.some((item) => typeof item !== "string")
  ) {
    throw new Error(`${label}.signatures must be a JSON array of strings`);
  }

  const planDigest = parsed.planDigest.toLowerCase();
  const signatures = Object.freeze([...parsed.signatures]);
  return Object.freeze({ planDigest, signatures });
};

export const readRecoveryTransactionsFile = async ({ filePath, root = process.cwd() } = {}) => {
  const label = "Mainnet release recovery file";
  const parsed = requirePlainObject(await readCommandInputJson({ filePath, root, label }), label);

  const entries = Object.entries(parsed)
    .map(([transactionLabel, hash]) => {
      if (typeof hash !== "string" || !HASH_32_PATTERN.test(hash)) {
        throw new Error(`${label}.${transactionLabel} must be a 32-byte 0x-prefixed hash`);
      }
      return [transactionLabel, hash.toLowerCase()];
    })
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    throw new Error(`${label} must contain at least one label-to-hash entry`);
  }
  return Object.freeze(Object.fromEntries(entries));
};

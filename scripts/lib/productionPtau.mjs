import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

// Fresh setup for all eight circuits uses this pinned Phase 1. Pool domain separation raises claim above 2^16.
export const PRODUCTION_PTAU_POWER = 17;
export const PRODUCTION_PTAU_FILE_NAME = "ppot_0080_17.ptau";
export const PRODUCTION_PTAU_RELATIVE_PATH = `circuits/ptau/${PRODUCTION_PTAU_FILE_NAME}`;
// Ceremony provenance only. The production workflow never downloads from this URL.
export const PRODUCTION_PTAU_URL =
  "https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_17.ptau";
export const PRODUCTION_PTAU_BYTES = 151_088_274;
export const PRODUCTION_PTAU_SHA256 =
  "f807e065fde53f72f4bf4d57140fab85b26daa6cc95bdfec7cce93622b3a367c";
export const PRODUCTION_PTAU_BLAKE2B512 =
  "3010cec42bdd1583bb4477dfa1b11853a67e8611feaa39cd7b3311a353b3e1d8b" +
  "3f318509d75208078dc6887500b61f3f46bc72c61abbb624bec3bad5ef16012";

export const PRODUCTION_PTAU_EVIDENCE = Object.freeze({
  bytes: PRODUCTION_PTAU_BYTES,
  sha256: PRODUCTION_PTAU_SHA256,
  blake2b512: PRODUCTION_PTAU_BLAKE2B512,
});

export const inspectPtauFile = async (filePath) => {
  const state = await fs.lstat(filePath);
  if (!state.isFile() || state.isSymbolicLink()) {
    throw new Error(`Powers of Tau must be a regular non-symlink file: ${filePath}`);
  }
  if ((await fs.realpath(filePath)) !== path.resolve(filePath)) {
    throw new Error(`Powers of Tau path must not traverse a symlink: ${filePath}`);
  }
  const sha256 = createHash("sha256");
  const blake2b512 = createHash("blake2b512");
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    bytes += chunk.length;
    sha256.update(chunk);
    blake2b512.update(chunk);
  }
  return Object.freeze({
    path: path.resolve(filePath),
    bytes,
    sha256: sha256.digest("hex"),
    blake2b512: blake2b512.digest("hex"),
  });
};

const assertPinnedEvidence = (actual, expected) => {
  for (const field of ["bytes", "sha256", "blake2b512"]) {
    if (actual[field] !== expected[field]) {
      throw new Error(
        `Local Powers of Tau ${field} mismatch; expected ${expected[field]}, got ${actual[field]}`,
      );
    }
  }
  return actual;
};

export const productionPtauPath = (root = process.cwd()) =>
  path.join(path.resolve(root), PRODUCTION_PTAU_RELATIVE_PATH);

export const resolveProductionPtauPath = ({
  root = process.cwd(),
  env = process.env,
  platform = process.platform,
} = {}) => {
  if (env === null || typeof env !== "object" || Array.isArray(env)) {
    throw new TypeError("Powers of Tau environment must be an object");
  }
  const matches = Object.entries(env).filter(([name]) =>
    platform === "win32" ? name.toUpperCase() === "ZK_PTAU_PATH" : name === "ZK_PTAU_PATH",
  );
  if (matches.length > 1) {
    throw new Error("Windows environment contains duplicate ZK_PTAU_PATH entries");
  }
  const configured = String(matches[0]?.[1] ?? "").trim();
  return configured === "" ? productionPtauPath(root) : path.resolve(root, configured);
};

export const ensureProductionPtau = async ({
  root = process.cwd(),
  env = process.env,
  platform = process.platform,
  expected = PRODUCTION_PTAU_EVIDENCE,
} = {}) => {
  if (
    !expected ||
    !Number.isSafeInteger(expected.bytes) ||
    expected.bytes <= 0 ||
    !/^[0-9a-f]{64}$/u.test(expected.sha256) ||
    !/^[0-9a-f]{128}$/u.test(expected.blake2b512)
  ) {
    throw new Error("Pinned Powers of Tau evidence is invalid");
  }
  const resolvedRoot = path.resolve(root);
  if ((await fs.realpath(resolvedRoot)) !== resolvedRoot) {
    throw new Error("Production Powers of Tau root must not traverse a symlink");
  }
  const filePath = resolveProductionPtauPath({ root: resolvedRoot, env, platform });
  let evidence;
  try {
    evidence = await inspectPtauFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `Local production Powers of Tau is missing: ${filePath}. Place the reviewed file there or set ZK_PTAU_PATH.`,
        { cause: error },
      );
    }
    throw error;
  }
  assertPinnedEvidence(evidence, expected);
  return Object.freeze({
    status: "verified-local",
    ...evidence,
    source: PRODUCTION_PTAU_URL,
  });
};

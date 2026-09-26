import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const PRODUCTION_PTAU_FILE_NAME = "ppot_0080_16.ptau";
export const PRODUCTION_PTAU_RELATIVE_PATH = `circuits/ptau/${PRODUCTION_PTAU_FILE_NAME}`;
// Ceremony provenance only. The production workflow never downloads from this URL.
export const PRODUCTION_PTAU_URL =
  "https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_16.ptau";
export const PRODUCTION_PTAU_BYTES = 75_590_802;
export const PRODUCTION_PTAU_SHA256 =
  "ed3622a7c79b0b49aadd134ebbc5b77df8c8c59bccebdfd0d9bf2c1a51561cf9";
export const PRODUCTION_PTAU_BLAKE2B512 =
  "9532c6c04a21335577713724b6d46c266a93aa621b78882b8b64b26f3080a8f0" +
  "d974aded00c4d781adbdf493a45c51db455108f7aeedb49971569d57a56971c3";

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

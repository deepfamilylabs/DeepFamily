import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const PRODUCTION_PTAU_FILE_NAME = "powersOfTau28_hez_final_13.ptau";
export const PRODUCTION_PTAU_RELATIVE_PATH = `tmp/zk-production/${PRODUCTION_PTAU_FILE_NAME}`;
export const PRODUCTION_PTAU_URL =
  "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_13.ptau";
export const PRODUCTION_PTAU_BYTES = 9_520_280;
export const PRODUCTION_PTAU_SHA256 =
  "95751b5207f20aa822f01109902315c01c15250303feacea2b8aa7dc9fdfeefd";
export const PRODUCTION_PTAU_BLAKE2B512 =
  "58efc8bf2834d04768a3d7ffcd8e1e23d461561729beaac4e3e7a47829a1c906" +
  "6d5320241e124a1a8e8aa6c75be0ba66f65bc8239a0542ed38e11276f6fdb4d9";

export const PRODUCTION_PTAU_EVIDENCE = Object.freeze({
  bytes: PRODUCTION_PTAU_BYTES,
  sha256: PRODUCTION_PTAU_SHA256,
  blake2b512: PRODUCTION_PTAU_BLAKE2B512,
});

const requireSecureDirectory = async (directory) => {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const state = await fs.lstat(directory);
  if (!state.isDirectory() || state.isSymbolicLink()) {
    throw new Error(`Production Powers of Tau cache must be a non-symlink directory: ${directory}`);
  }
  if ((await fs.realpath(directory)) !== path.resolve(directory)) {
    throw new Error(
      `Production Powers of Tau cache path must not traverse a symlink: ${directory}`,
    );
  }
  await fs.chmod(directory, 0o700);
};

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

const assertPinnedEvidence = (actual, label, expected) => {
  for (const field of ["bytes", "sha256", "blake2b512"]) {
    if (actual[field] !== expected[field]) {
      throw new Error(
        `${label} ${field} mismatch; expected ${expected[field]}, got ${actual[field]}`,
      );
    }
  }
  return actual;
};

const destinationState = async (destination) => {
  try {
    return await fs.lstat(destination);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
};

const downloadPinnedPtau = async ({ destination, fetchImpl, source, expected }) => {
  const response = await fetchImpl(source, { redirect: "error" });
  if (!response?.ok) {
    throw new Error(`Powers of Tau download failed with HTTP ${response?.status ?? "unknown"}`);
  }
  const contentLength = response.headers?.get?.("content-length");
  if (contentLength !== null && contentLength !== undefined) {
    const parsedLength = Number(contentLength);
    if (parsedLength !== expected.bytes) {
      throw new Error(
        `Powers of Tau Content-Length mismatch; expected ${expected.bytes}, ` +
          `got ${contentLength}`,
      );
    }
  }
  if (!response.body) throw new Error("Powers of Tau download returned an empty body");

  const temporaryPath = path.join(
    path.dirname(destination),
    `.${PRODUCTION_PTAU_FILE_NAME}.${process.pid}.${randomBytes(8).toString("hex")}.partial`,
  );
  let handle;
  try {
    handle = await fs.open(temporaryPath, "wx", 0o600);
    let bytes = 0;
    const sha256 = createHash("sha256");
    const blake2b512 = createHash("blake2b512");
    for await (const value of response.body) {
      const chunk = Buffer.from(value);
      bytes += chunk.length;
      if (bytes > expected.bytes) {
        throw new Error(`Powers of Tau download exceeds the pinned ${expected.bytes}-byte size`);
      }
      sha256.update(chunk);
      blake2b512.update(chunk);
      await handle.writeFile(chunk);
    }
    await handle.sync();
    await handle.close();
    handle = null;
    assertPinnedEvidence(
      {
        bytes,
        sha256: sha256.digest("hex"),
        blake2b512: blake2b512.digest("hex"),
      },
      "Downloaded Powers of Tau",
      expected,
    );
    await fs.rename(temporaryPath, destination);
    await fs.chmod(destination, 0o600);
  } finally {
    await handle?.close();
    await fs.rm(temporaryPath, { force: true });
  }
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
  fetchImpl = globalThis.fetch,
  source = PRODUCTION_PTAU_URL,
  expected = PRODUCTION_PTAU_EVIDENCE,
} = {}) => {
  if (typeof fetchImpl !== "function") throw new Error("fetchImpl must be a function");
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
  const destination = productionPtauPath(resolvedRoot);
  const cacheDirectory = path.dirname(destination);
  await requireSecureDirectory(cacheDirectory);
  const lockPath = path.join(cacheDirectory, ".download.lock");
  let lock;
  try {
    lock = await fs.open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("Another production Powers of Tau download or validation is in progress");
    }
    throw error;
  }

  try {
    const state = await destinationState(destination);
    let status = "already-cached";
    if (state) {
      if (!state.isFile() || state.isSymbolicLink()) {
        throw new Error("Existing production Powers of Tau cache is not a regular file");
      }
      try {
        assertPinnedEvidence(await inspectPtauFile(destination), "Cached Powers of Tau", expected);
      } catch (error) {
        throw new Error(
          "Existing production Powers of Tau cache is unexpected; remove it only after review",
          { cause: error },
        );
      }
      await fs.chmod(destination, 0o600);
    } else {
      await downloadPinnedPtau({ destination, fetchImpl, source, expected });
      status = "downloaded";
    }
    const evidence = assertPinnedEvidence(
      await inspectPtauFile(destination),
      "Installed Powers of Tau",
      expected,
    );
    return Object.freeze({
      status,
      ...evidence,
      source,
    });
  } finally {
    try {
      await lock.close();
    } finally {
      await fs.rm(lockPath, { force: true });
    }
  }
};

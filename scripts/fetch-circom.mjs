#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CIRCOM_CANONICAL_POLICY,
  CIRCOM_LINUX_X64_SHA256,
  CIRCOM_LINUX_X64_URL,
  CIRCOM_VERSION,
  localCircomBinaryPath,
  resolveLocalCircomTarget,
} from "./lib/circomToolchain.mjs";

export { CIRCOM_CANONICAL_POLICY, CIRCOM_LINUX_X64_SHA256, CIRCOM_LINUX_X64_URL, CIRCOM_VERSION };

const SOURCE_PROVENANCE_SCHEMA_VERSION = 1;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const expectedVersionOutput = `circom compiler ${CIRCOM_VERSION}`;

const defaultDownload = async (url) => {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Circom download failed with HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
};

const defaultVersionRunner = (executable) =>
  String(
    execFileSync(executable, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  ).trim();

const defaultCommandRunner = ({ executable, args, cwd, capture = false }) =>
  execFileSync(executable, args, {
    cwd,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

const assertExpectedVersion = (versionOutput, label = "Circom compiler") => {
  const actual = String(versionOutput).trim();
  if (actual !== expectedVersionOutput) {
    throw new Error(
      `${label} version mismatch; expected "${expectedVersionOutput}", got "${actual}"`,
    );
  }
  return actual;
};

const assertCanonicalRootAndBin = async (projectRoot) => {
  const root = path.resolve(projectRoot);
  const canonicalRoot = await fs.realpath(root);
  if (canonicalRoot !== root) {
    throw new Error("Circom install root must not traverse a symbolic link");
  }

  const binDirectory = path.join(root, "bin");
  await fs.mkdir(binDirectory, { recursive: true });
  const state = await fs.lstat(binDirectory);
  if (!state.isDirectory() || state.isSymbolicLink()) {
    throw new Error("Circom bin path must be a regular directory, not a symbolic link");
  }
  if ((await fs.realpath(binDirectory)) !== binDirectory) {
    throw new Error("Circom bin path must not traverse a symbolic link");
  }
  return Object.freeze({ root, binDirectory });
};

const resolveDestination = ({ root, binDirectory, destinationRelativePath }) => {
  if (typeof destinationRelativePath !== "string" || destinationRelativePath.length === 0) {
    throw new TypeError("destinationRelativePath must be a non-empty string");
  }
  const destination = path.resolve(root, destinationRelativePath);
  if (path.dirname(destination) !== binDirectory) {
    throw new Error("Circom destination must be a direct child of the repository bin directory");
  }
  return destination;
};

const readRegularFile = async (filePath, label) => {
  let state;
  try {
    state = await fs.lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!state.isFile() || state.isSymbolicLink() || (await fs.realpath(filePath)) !== filePath) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  return fs.readFile(filePath);
};

const provenancePathFor = (destination) => `${destination}.provenance.json`;

const validateSourceProvenance = ({ raw, target, binarySha256 }) => {
  let provenance;
  try {
    provenance = JSON.parse(raw);
  } catch (error) {
    throw new Error("Circom source-build provenance must be valid JSON", { cause: error });
  }
  const expectedKeys = [
    "schemaVersion",
    "circomVersion",
    "target",
    "strategy",
    "sourceRepository",
    "sourceCommit",
    "rustcVersion",
    "cargoVersion",
    "binarySha256",
  ];
  if (
    provenance === null ||
    typeof provenance !== "object" ||
    Array.isArray(provenance) ||
    Object.keys(provenance).sort().join("\n") !== [...expectedKeys].sort().join("\n")
  ) {
    throw new Error(
      `Circom source-build provenance must contain exactly: ${expectedKeys.join(", ")}`,
    );
  }
  for (const [field, expected] of [
    ["schemaVersion", SOURCE_PROVENANCE_SCHEMA_VERSION],
    ["circomVersion", CIRCOM_VERSION],
    ["target", target.id],
    ["strategy", target.strategy],
    ["sourceRepository", target.repository],
    ["sourceCommit", target.commit],
    ["binarySha256", binarySha256],
  ]) {
    if (provenance[field] !== expected) {
      throw new Error(`Circom source-build provenance ${field} mismatch`);
    }
  }
  for (const field of ["rustcVersion", "cargoVersion"]) {
    if (typeof provenance[field] !== "string" || provenance[field].trim() === "") {
      throw new Error(`Circom source-build provenance ${field} must be a non-empty string`);
    }
  }
  return Object.freeze({ ...provenance });
};

const inspectInstalledTarget = async ({ destination, target, verifyVersion, versionRunner }) => {
  const bytes = await readRegularFile(destination, "Existing Circom compiler");
  if (bytes === null) return null;
  const binarySha256 = sha256(bytes);

  let provenance = null;
  if (target.strategy === "official-binary") {
    if (binarySha256 !== target.sha256) {
      throw new Error(
        `Existing ${path.basename(destination)} does not match the pinned SHA-256; ` +
          "remove it only after review",
      );
    }
  } else if (target.strategy === "pinned-source") {
    const provenanceBytes = await readRegularFile(
      provenancePathFor(destination),
      "Circom source-build provenance",
    );
    if (provenanceBytes === null) {
      throw new Error(
        `Existing ${path.basename(destination)} has no pinned-source provenance; ` +
          "remove it only after review",
      );
    }
    provenance = validateSourceProvenance({
      raw: provenanceBytes.toString("utf8"),
      target,
      binarySha256,
    });
  } else {
    throw new Error(`Unsupported Circom installation strategy: ${target.strategy}`);
  }

  await fs.chmod(destination, 0o755);
  if (verifyVersion) {
    assertExpectedVersion(versionRunner(destination), "Installed Circom compiler");
  }
  return Object.freeze({ binarySha256, provenance });
};

const installFileExclusive = async ({ destination, bytes, mode }) => {
  const temporaryPath = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}-${process.pid}-${randomBytes(8).toString("hex")}.tmp`,
  );
  let linkedDestination = false;
  try {
    await fs.writeFile(temporaryPath, bytes, { flag: "wx", mode });
    try {
      await fs.link(temporaryPath, destination);
      linkedDestination = true;
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error(
          `Refusing to overwrite ${path.basename(destination)} created during installation`,
          { cause: error },
        );
      }
      throw error;
    }
    await fs.chmod(destination, mode);
  } catch (error) {
    if (linkedDestination) {
      await fs.rm(destination, { force: true });
    }
    throw error;
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
};

export const buildPinnedCircomFromSource = async ({
  target,
  commandRunner = defaultCommandRunner,
  temporaryDirectoryFactory = () => fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-circom-source-")),
  temporaryDirectoryRemover = (directory) => fs.rm(directory, { recursive: true, force: true }),
} = {}) => {
  if (target?.strategy !== "pinned-source") {
    throw new Error("Source builder requires a pinned-source Circom target");
  }
  const temporaryRoot = await temporaryDirectoryFactory();
  const sourceDirectory = path.join(temporaryRoot, "source");
  try {
    await commandRunner({
      executable: "git",
      args: ["init", sourceDirectory],
      cwd: temporaryRoot,
    });
    await commandRunner({
      executable: "git",
      args: ["remote", "add", "origin", target.repository],
      cwd: sourceDirectory,
    });
    await commandRunner({
      executable: "git",
      args: ["fetch", "--depth", "1", "origin", target.commit],
      cwd: sourceDirectory,
    });
    await commandRunner({
      executable: "git",
      args: ["checkout", "--detach", "FETCH_HEAD"],
      cwd: sourceDirectory,
    });
    const sourceCommit = String(
      await commandRunner({
        executable: "git",
        args: ["rev-parse", "HEAD"],
        cwd: sourceDirectory,
        capture: true,
      }),
    ).trim();
    if (sourceCommit !== target.commit) {
      throw new Error(
        `Circom source commit mismatch; expected ${target.commit}, got ${sourceCommit}`,
      );
    }

    const cargoVersion = String(
      await commandRunner({
        executable: "cargo",
        args: ["--version"],
        cwd: sourceDirectory,
        capture: true,
      }),
    ).trim();
    const rustcVersion = String(
      await commandRunner({
        executable: "rustc",
        args: ["--version"],
        cwd: sourceDirectory,
        capture: true,
      }),
    ).trim();
    await commandRunner({
      executable: "cargo",
      args: ["build", "--release", "--locked"],
      cwd: sourceDirectory,
    });

    const builtBinary = path.join(
      sourceDirectory,
      "target",
      "release",
      target.platform === "win32" ? "circom.exe" : "circom",
    );
    assertExpectedVersion(
      await commandRunner({
        executable: builtBinary,
        args: ["--version"],
        cwd: sourceDirectory,
        capture: true,
      }),
      "Source-built Circom compiler",
    );
    return Object.freeze({
      bytes: await fs.readFile(builtBinary),
      cargoVersion,
      rustcVersion,
    });
  } finally {
    await temporaryDirectoryRemover(temporaryRoot);
  }
};

export const installPinnedCircom = async ({
  projectRoot = process.cwd(),
  target,
  destinationRelativePath,
  verifyVersion = true,
  download = defaultDownload,
  sourceBuilder = buildPinnedCircomFromSource,
  versionRunner = defaultVersionRunner,
} = {}) => {
  if (target === null || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("target must be a Circom target object");
  }
  const prepared = await assertCanonicalRootAndBin(projectRoot);
  const destination = resolveDestination({ ...prepared, destinationRelativePath });
  const existing = await inspectInstalledTarget({
    destination,
    target,
    verifyVersion,
    versionRunner,
  });
  if (existing !== null) {
    return Object.freeze({
      status: "already-installed",
      path: destination,
      target: target.id,
      sha256: existing.binarySha256,
    });
  }

  const provenancePath = provenancePathFor(destination);
  if (
    target.strategy === "pinned-source" &&
    (await readRegularFile(provenancePath, "Circom source-build provenance")) !== null
  ) {
    throw new Error("Circom source-build provenance exists without its compiler");
  }

  let bytes;
  let sourceMetadata = null;
  if (target.strategy === "official-binary") {
    bytes = await download(target.url);
    const digest = sha256(bytes);
    if (digest !== target.sha256) {
      throw new Error(
        `Downloaded Circom SHA-256 mismatch; expected ${target.sha256}, got ${digest}`,
      );
    }
  } else if (target.strategy === "pinned-source") {
    const built = await sourceBuilder({ target });
    if (!Buffer.isBuffer(built?.bytes)) {
      throw new Error("Circom source builder must return binary bytes");
    }
    bytes = built.bytes;
    sourceMetadata = {
      cargoVersion: String(built.cargoVersion ?? "").trim(),
      rustcVersion: String(built.rustcVersion ?? "").trim(),
    };
    if (sourceMetadata.cargoVersion === "" || sourceMetadata.rustcVersion === "") {
      throw new Error("Circom source builder must report Cargo and Rust compiler versions");
    }
  } else {
    throw new Error(`Unsupported Circom installation strategy: ${target.strategy}`);
  }

  await installFileExclusive({ destination, bytes, mode: 0o755 });
  try {
    if (verifyVersion) {
      assertExpectedVersion(versionRunner(destination), "Installed Circom compiler");
    }
    if (target.strategy === "pinned-source") {
      const provenance = {
        schemaVersion: SOURCE_PROVENANCE_SCHEMA_VERSION,
        circomVersion: CIRCOM_VERSION,
        target: target.id,
        strategy: target.strategy,
        sourceRepository: target.repository,
        sourceCommit: target.commit,
        rustcVersion: sourceMetadata.rustcVersion,
        cargoVersion: sourceMetadata.cargoVersion,
        binarySha256: sha256(bytes),
      };
      await installFileExclusive({
        destination: provenancePath,
        bytes: Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`),
        mode: 0o644,
      });
    }
  } catch (error) {
    await fs.rm(destination, { force: true });
    await fs.rm(provenancePath, { force: true });
    throw error;
  }

  return Object.freeze({
    status: "installed",
    path: destination,
    target: target.id,
    sha256: sha256(bytes),
  });
};

export const buildCircomInstallPlan = ({
  platform = process.platform,
  arch = process.arch,
} = {}) => {
  const localTarget = resolveLocalCircomTarget({ platform, arch });
  return Object.freeze([
    Object.freeze({
      role: "canonical-release",
      target: CIRCOM_CANONICAL_POLICY.target,
      destinationRelativePath: CIRCOM_CANONICAL_POLICY.binaryPath,
      verifyVersion: false,
    }),
    Object.freeze({
      role: "local",
      target: localTarget,
      destinationRelativePath: localCircomBinaryPath({ platform }),
      verifyVersion: true,
    }),
  ]);
};

export const installCircomToolchains = async ({
  projectRoot = process.cwd(),
  platform = process.platform,
  arch = process.arch,
  installer = installPinnedCircom,
  download = defaultDownload,
  sourceBuilder = buildPinnedCircomFromSource,
  versionRunner = defaultVersionRunner,
} = {}) => {
  const results = [];
  for (const item of buildCircomInstallPlan({ platform, arch })) {
    const result = await installer({
      projectRoot,
      target: item.target,
      destinationRelativePath: item.destinationRelativePath,
      verifyVersion: item.verifyVersion,
      download:
        item.role === "local" && item.target === CIRCOM_CANONICAL_POLICY.target
          ? async () => fs.readFile(results[0].path)
          : download,
      sourceBuilder,
      versionRunner,
    });
    results.push(Object.freeze({ role: item.role, ...result }));
  }
  return Object.freeze(results);
};

export const assertLocalCircomInstallation = async ({
  root = process.cwd(),
  platform = process.platform,
  arch = process.arch,
  versionRunner = defaultVersionRunner,
} = {}) => {
  const target = resolveLocalCircomTarget({ platform, arch });
  const prepared = await assertCanonicalRootAndBin(root);
  const destination = resolveDestination({
    ...prepared,
    destinationRelativePath: localCircomBinaryPath({ platform }),
  });
  const evidence = await inspectInstalledTarget({
    destination,
    target,
    verifyVersion: true,
    versionRunner,
  });
  if (evidence === null) {
    throw new Error(`Local Circom compiler is missing; run \`npm run zk:fetch\` first`);
  }
  return Object.freeze({
    path: destination,
    target: target.id,
    strategy: target.strategy,
    sha256: evidence.binarySha256,
    version: CIRCOM_VERSION,
  });
};

export const main = async (argv = process.argv.slice(2)) => {
  if (argv.length !== 0) {
    throw new Error("Usage: node scripts/fetch-circom.mjs");
  }
  const results = await installCircomToolchains();
  for (const result of results) {
    console.log(
      `Circom ${CIRCOM_VERSION} ${result.role} ${result.status}: ${result.path} ` +
        `(${result.target}, SHA-256 ${result.sha256})`,
    );
  }
  return results;
};

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((error) => {
    console.error(`[circom-fetch] ${error.message}`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
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
import { createPrivateTemporaryDirectory } from "./lib/privateTemporaryDirectory.mjs";

export { CIRCOM_CANONICAL_POLICY, CIRCOM_LINUX_X64_SHA256, CIRCOM_LINUX_X64_URL, CIRCOM_VERSION };

const SOURCE_PROVENANCE_SCHEMA_VERSION = 1;
const SOURCE_BUILD_DIRECTORY_PREFIX = "deepfamily-circom-source-";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const expectedVersionOutput = `circom compiler ${CIRCOM_VERSION}`;

const sourceBuildBaseDirectory = async () =>
  path.join(
    await fs.realpath(path.resolve(os.userInfo().homedir)),
    ".deepfamily",
    "circom-source-builds",
  );

const ancestorDirectories = (directory) => {
  const ancestors = [];
  let current = path.resolve(directory);
  while (true) {
    ancestors.push(current);
    const parent = path.dirname(current);
    if (parent === current) return ancestors;
    current = parent;
  }
};

const assertCanonicalDirectory = async (directory, label) => {
  const resolved = path.resolve(directory);
  const state = await fs.lstat(resolved);
  if (!state.isDirectory() || state.isSymbolicLink()) {
    throw new Error(`${label} must be a regular directory, not a symbolic link`);
  }
  if ((await fs.realpath(resolved)) !== resolved) {
    throw new Error(`${label} must not traverse a symbolic link`);
  }
  return Object.freeze({ path: resolved, state });
};

const assertProtectedPosixAncestors = async (directory, label) => {
  if (process.platform === "win32") return;

  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
  for (const [index, ancestor] of ancestorDirectories(directory).entries()) {
    const state = await fs.lstat(ancestor);
    if (!state.isDirectory() || state.isSymbolicLink()) {
      throw new Error(`${label} ancestor must be a regular directory: ${ancestor}`);
    }
    if ((state.mode & 0o022) !== 0) {
      throw new Error(`${label} ancestor must not be group- or other-writable: ${ancestor}`);
    }
    if (index === 0 && currentUid !== null && state.uid !== currentUid) {
      throw new Error(`${label} must be owned by the current user: ${ancestor}`);
    }
  }
};

const assertNoExternalCargoConfiguration = async (sourceDirectory) => {
  for (const ancestor of ancestorDirectories(path.dirname(sourceDirectory))) {
    for (const relativeConfigPath of [".cargo/config", ".cargo/config.toml"]) {
      const configPath = path.join(ancestor, relativeConfigPath);
      try {
        await fs.lstat(configPath);
      } catch (error) {
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR") continue;
        throw error;
      }
      throw new Error(
        `Circom source build refuses Cargo configuration outside its source directory: ${configPath}`,
      );
    }
  }
};

const defaultSourceBuildDirectoryFactory = async ({ baseDirectory }) => {
  const resolvedBase = path.resolve(baseDirectory);
  if (path.dirname(resolvedBase) === resolvedBase) {
    throw new Error("Circom source-build base directory must not be a filesystem root");
  }

  const missingDirectories = [];
  let existingAncestor = resolvedBase;
  while (true) {
    try {
      await fs.lstat(existingAncestor);
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      missingDirectories.unshift(existingAncestor);
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) throw error;
      existingAncestor = parent;
    }
  }
  await assertCanonicalDirectory(existingAncestor, "Circom source-build base ancestor");
  await assertProtectedPosixAncestors(existingAncestor, "Circom source-build base ancestor");
  for (const directory of missingDirectories) {
    try {
      await fs.mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    await assertCanonicalDirectory(directory, "Circom source-build base directory");
  }
  if (process.platform !== "win32") {
    await fs.chmod(resolvedBase, 0o700);
  }
  const preparedBase = await assertCanonicalDirectory(
    resolvedBase,
    "Circom source-build base directory",
  );
  if (
    process.platform !== "win32" &&
    ((preparedBase.state.mode & 0o777) !== 0o700 ||
      (typeof process.getuid === "function" && preparedBase.state.uid !== process.getuid()))
  ) {
    throw new Error("Circom source-build base directory must be private to the current user");
  }
  await assertProtectedPosixAncestors(preparedBase.path, "Circom source-build base directory");
  return createPrivateTemporaryDirectory({
    prefix: SOURCE_BUILD_DIRECTORY_PREFIX,
    baseDirectory: preparedBase.path,
  });
};

const defaultSourceBuildDirectoryValidator = async ({ sourceDirectory }) => {
  const buildRoot = path.dirname(path.resolve(sourceDirectory));
  await assertCanonicalDirectory(buildRoot, "Circom source-build directory");
  await assertNoExternalCargoConfiguration(sourceDirectory);
  await assertProtectedPosixAncestors(buildRoot, "Circom source-build directory");
};

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

const defaultCommandRunner = ({ executable, args, cwd, capture = false, env = process.env }) =>
  execFileSync(executable, args, {
    cwd,
    env,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

const trustedSourceBuildToolCandidates = ({ name, platform, homeDirectory }) => {
  const executable = platform === "win32" ? `${name}.exe` : name;
  if (platform === "win32") {
    const candidates =
      name === "git"
        ? [...new Set([path.parse(process.execPath).root, "C:\\"])]
            .filter((driveRoot) => driveRoot !== "")
            .map((driveRoot) => path.join(driveRoot, "Program Files", "Git", "cmd", executable))
        : [];
    if (name !== "git") {
      candidates.push(path.join(homeDirectory, ".cargo", "bin", executable));
    }
    return candidates;
  }

  if (name === "git") {
    return ["/usr/bin/git", "/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"];
  }
  return [
    path.join(homeDirectory, ".cargo", "bin", executable),
    path.join("/usr/local/cargo/bin", executable),
    path.join("/opt/homebrew/bin", executable),
    path.join("/usr/local/bin", executable),
    path.join("/usr/bin", executable),
  ];
};

const assertProtectedToolDirectory = async (directory, label) => {
  if (process.platform === "win32") return;
  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
  for (const ancestor of ancestorDirectories(directory)) {
    const state = await fs.lstat(ancestor);
    if (!state.isDirectory() || state.isSymbolicLink()) {
      throw new Error(`${label} must not traverse a symbolic-link directory: ${ancestor}`);
    }
    if ((state.mode & 0o022) !== 0) {
      throw new Error(`${label} directory must not be group- or other-writable: ${ancestor}`);
    }
    if (currentUid !== null && state.uid !== 0 && state.uid !== currentUid) {
      throw new Error(`${label} directory has an untrusted owner: ${ancestor}`);
    }
  }
};

const inspectProtectedExecutable = async ({ candidate, label }) => {
  if (!path.isAbsolute(candidate)) {
    throw new Error(`${label} path must be absolute`);
  }
  let canonical;
  let state;
  try {
    canonical = await fs.realpath(candidate);
    state = await fs.stat(canonical);
    if (!state.isFile() || (process.platform !== "win32" && (state.mode & 0o022) !== 0)) {
      throw new Error(`not a protected regular file: ${candidate}`);
    }
    await fs.access(candidate, fsConstants.X_OK);
    await assertProtectedToolDirectory(await fs.realpath(path.dirname(candidate)), label);
    await assertProtectedToolDirectory(path.dirname(canonical), `${label} target`);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EACCES") return null;
    throw error;
  }
  return Object.freeze({ canonical, state });
};

const sameExecutableIdentity = (left, right) =>
  process.platform !== "win32" &&
  left.ino !== 0 &&
  left.dev === right.dev &&
  left.ino === right.ino;

const inspectTrustedSourceBuildTool = async ({
  name,
  candidate,
  homeDirectory,
  resolvingRustupProxy = false,
}) => {
  const inspected = await inspectProtectedExecutable({
    candidate,
    label: `Trusted Circom source-build ${name}`,
  });
  if (inspected === null) return null;
  const { canonical, state } = inspected;
  const canonicalBasename = path
    .basename(canonical)
    .replace(/\.exe$/iu, "")
    .toLowerCase();
  let rustupExecutable = canonicalBasename === "rustup" ? canonical : null;
  if (["cargo", "rustc"].includes(name) && rustupExecutable === null) {
    const rustupCandidate = path.join(
      homeDirectory,
      ".cargo",
      "bin",
      process.platform === "win32" ? "rustup.exe" : "rustup",
    );
    const rustup = await inspectProtectedExecutable({
      candidate: rustupCandidate,
      label: "Trusted Circom source-build rustup",
    });
    if (rustup !== null && sameExecutableIdentity(state, rustup.state)) {
      rustupExecutable = rustup.canonical;
    }
  }
  if (["cargo", "rustc"].includes(name) && rustupExecutable !== null) {
    if (resolvingRustupProxy) {
      throw new Error(`rustup resolved ${name} back to a rustup proxy`);
    }
    const resolverEnvironment = Object.freeze({
      HOME: homeDirectory,
      PATH: await protectedSourceBuildPath([rustupExecutable]),
    });
    const resolvedProxy = String(
      execFileSync(rustupExecutable, ["which", name], {
        encoding: "utf8",
        env: resolverEnvironment,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ).trim();
    if (!path.isAbsolute(resolvedProxy)) {
      throw new Error(`rustup returned a non-absolute ${name} executable path`);
    }
    return inspectTrustedSourceBuildTool({
      name,
      candidate: resolvedProxy,
      homeDirectory,
      resolvingRustupProxy: true,
    });
  }
  const expectedBasename = name.toLowerCase();
  if (canonicalBasename !== expectedBasename) {
    throw new Error(
      `Trusted Circom source-build ${name} resolves to unexpected executable ${canonical}`,
    );
  }
  return canonical;
};

export const resolveTrustedSourceBuildTool = async ({
  name,
  platform = process.platform,
  homeDirectory = os.userInfo().homedir,
} = {}) => {
  if (!["git", "cargo", "rustc"].includes(name)) {
    throw new Error(`Unsupported Circom source-build tool: ${String(name)}`);
  }
  const canonicalHome = await fs.realpath(path.resolve(homeDirectory));
  const candidates = trustedSourceBuildToolCandidates({
    name,
    platform,
    homeDirectory: canonicalHome,
  });
  for (const candidate of candidates) {
    const resolved = await inspectTrustedSourceBuildTool({
      name,
      candidate,
      homeDirectory: canonicalHome,
    });
    if (resolved !== null) return resolved;
  }
  throw new Error(
    `Unable to find a trusted absolute ${name} executable for the Circom source build; ` +
      `install it in a protected system directory${name === "git" ? "" : " or ~/.cargo/bin"}`,
  );
};

const protectedSourceBuildPath = async (executables) => {
  const requestedDirectories = executables.map((executable) => path.dirname(executable));
  if (process.platform !== "win32") {
    requestedDirectories.push("/usr/bin", "/bin", "/usr/sbin", "/sbin");
  }
  const protectedDirectories = [];
  for (const directory of requestedDirectories) {
    let canonical;
    try {
      canonical = await fs.realpath(directory);
    } catch (error) {
      if (
        error?.code === "ENOENT" &&
        !executables.some((value) => path.dirname(value) === directory)
      ) {
        continue;
      }
      throw error;
    }
    await assertProtectedToolDirectory(canonical, "Circom source-build PATH");
    protectedDirectories.push(canonical);
  }
  return [...new Set(protectedDirectories)].join(path.delimiter);
};

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
  env = process.env,
  commandRunner = defaultCommandRunner,
  toolPathResolver = resolveTrustedSourceBuildTool,
  sourceBuildBaseDirectory: configuredSourceBuildBaseDirectory,
  temporaryDirectoryFactory = defaultSourceBuildDirectoryFactory,
  sourceBuildDirectoryValidator = defaultSourceBuildDirectoryValidator,
  temporaryDirectoryRemover = (directory) => fs.rm(directory, { recursive: true, force: true }),
} = {}) => {
  if (target?.strategy !== "pinned-source") {
    throw new Error("Source builder requires a pinned-source Circom target");
  }
  const resolvedSourceBuildBaseDirectory = path.resolve(
    configuredSourceBuildBaseDirectory ?? (await sourceBuildBaseDirectory()),
  );
  const temporaryRoot = path.resolve(
    await temporaryDirectoryFactory({ baseDirectory: resolvedSourceBuildBaseDirectory }),
  );
  const sourceDirectory = path.join(temporaryRoot, "source");
  try {
    const canonicalSourceBuildBaseDirectory = await fs.realpath(resolvedSourceBuildBaseDirectory);
    if (path.dirname(temporaryRoot) !== canonicalSourceBuildBaseDirectory) {
      throw new Error("Circom source-build directory must be a direct child of its protected base");
    }
    await sourceBuildDirectoryValidator({ sourceDirectory });
    const sourceEnvironment = Object.fromEntries(
      Object.entries(env).filter(
        ([name]) =>
          !/^PATH$/iu.test(name) &&
          !/^(?:HOME|USERPROFILE|TMPDIR|TMP|TEMP)$/iu.test(name) &&
          !/^(?:GIT_|CARGO_|NODE_|LD_|DYLD_|NPM_CONFIG_)/iu.test(name) &&
          !/^(?:RUSTUP(?:_|$)|RUSTC(?:_|$)|RUSTFLAGS$|RUSTDOC(?:FLAGS)?$|RUST_PATH$|RUST_TARGET_PATH$)/iu.test(
            name,
          ) &&
          !/^(?:CC|CXX|AR|RANLIB|CFLAGS|CXXFLAGS|CPPFLAGS|LDFLAGS|MAKEFLAGS)$/iu.test(name) &&
          !/^(?:PKG_CONFIG|BINDGEN_EXTRA_CLANG_ARGS)/iu.test(name),
      ),
    );
    const cargoHome = path.join(temporaryRoot, "cargo-home");
    const sourceHome = path.join(temporaryRoot, "source-home");
    const sourceTemporaryDirectory = path.join(temporaryRoot, "tmp");
    const xdgConfigHome = path.join(temporaryRoot, "xdg-config");
    const emptyHooks = path.join(temporaryRoot, "empty-git-hooks");
    const gitGlobalConfig = path.join(temporaryRoot, "git-global.config");
    const gitSystemConfig = path.join(temporaryRoot, "git-system.config");
    await Promise.all([
      fs.mkdir(cargoHome, { mode: 0o700 }),
      fs.mkdir(sourceHome, { mode: 0o700 }),
      fs.mkdir(sourceTemporaryDirectory, { mode: 0o700 }),
      fs.mkdir(xdgConfigHome, { mode: 0o700 }),
      fs.mkdir(emptyHooks, { mode: 0o700 }),
      fs.writeFile(gitGlobalConfig, "", { flag: "wx", mode: 0o600 }),
      fs.writeFile(gitSystemConfig, "", { flag: "wx", mode: 0o600 }),
    ]);
    Object.assign(sourceEnvironment, {
      CARGO_HOME: cargoHome,
      CARGO_INCREMENTAL: "0",
      HOME: sourceHome,
      GIT_CONFIG_GLOBAL: gitGlobalConfig,
      GIT_CONFIG_SYSTEM: gitSystemConfig,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: emptyHooks,
      TEMP: sourceTemporaryDirectory,
      TMP: sourceTemporaryDirectory,
      TMPDIR: sourceTemporaryDirectory,
      XDG_CONFIG_HOME: xdgConfigHome,
    });
    const resolveTool = async (name) => {
      const executable = await toolPathResolver({ name });
      if (typeof executable !== "string" || !path.isAbsolute(executable)) {
        throw new Error(`Circom source-build ${name} resolver must return an absolute path`);
      }
      return executable;
    };
    const gitExecutable = await resolveTool("git");
    const cargoExecutable = await resolveTool("cargo");
    const rustcExecutable = await resolveTool("rustc");
    sourceEnvironment.PATH = await protectedSourceBuildPath([
      gitExecutable,
      cargoExecutable,
      rustcExecutable,
    ]);
    sourceEnvironment.RUSTC = rustcExecutable;
    await commandRunner({
      executable: gitExecutable,
      args: ["init", sourceDirectory],
      cwd: temporaryRoot,
      env: sourceEnvironment,
    });
    await commandRunner({
      executable: gitExecutable,
      args: ["remote", "add", "origin", target.repository],
      cwd: sourceDirectory,
      env: sourceEnvironment,
    });
    await commandRunner({
      executable: gitExecutable,
      args: ["fetch", "--depth", "1", "origin", target.commit],
      cwd: sourceDirectory,
      env: sourceEnvironment,
    });
    await commandRunner({
      executable: gitExecutable,
      args: ["checkout", "--detach", "FETCH_HEAD"],
      cwd: sourceDirectory,
      env: sourceEnvironment,
    });
    const sourceCommit = String(
      await commandRunner({
        executable: gitExecutable,
        args: ["rev-parse", "HEAD"],
        cwd: sourceDirectory,
        capture: true,
        env: sourceEnvironment,
      }),
    ).trim();
    if (sourceCommit !== target.commit) {
      throw new Error(
        `Circom source commit mismatch; expected ${target.commit}, got ${sourceCommit}`,
      );
    }

    const cargoVersion = String(
      await commandRunner({
        executable: cargoExecutable,
        args: ["--version"],
        cwd: sourceDirectory,
        capture: true,
        env: sourceEnvironment,
      }),
    ).trim();
    const rustcVersion = String(
      await commandRunner({
        executable: rustcExecutable,
        args: ["--version"],
        cwd: sourceDirectory,
        capture: true,
        env: sourceEnvironment,
      }),
    ).trim();
    await commandRunner({
      executable: cargoExecutable,
      args: ["build", "--release", "--locked"],
      cwd: sourceDirectory,
      env: sourceEnvironment,
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
        env: sourceEnvironment,
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
  libc,
  report,
} = {}) => {
  const localTarget = resolveLocalCircomTarget({ platform, arch, libc, report });
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
  libc,
  report,
  installer = installPinnedCircom,
  download = defaultDownload,
  sourceBuilder = buildPinnedCircomFromSource,
  versionRunner = defaultVersionRunner,
} = {}) => {
  const results = [];
  for (const item of buildCircomInstallPlan({ platform, arch, libc, report })) {
    const result = await installer({
      projectRoot,
      target: item.target,
      destinationRelativePath: item.destinationRelativePath,
      verifyVersion: item.verifyVersion,
      download:
        item.role === "local" &&
        item.target.id === CIRCOM_CANONICAL_POLICY.target.id &&
        item.target.strategy === CIRCOM_CANONICAL_POLICY.target.strategy
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
  libc,
  report,
  versionRunner = defaultVersionRunner,
} = {}) => {
  const target = resolveLocalCircomTarget({ platform, arch, libc, report });
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
    libcEvidence: target.libcEvidence ?? null,
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

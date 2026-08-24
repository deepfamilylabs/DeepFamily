import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { hardenPrivateWindowsPath } from "./privateTemporaryDirectory.mjs";
import { validateTestnetReleaseEvidence } from "./testnetReleaseEvidence.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const pathIsWithin = (root, target) => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
};

const requireRealRepositoryRoot = async (repositoryRoot) => {
  if (typeof repositoryRoot !== "string" || repositoryRoot.trim() === "") {
    throw new Error("repositoryRoot must be a non-empty path");
  }
  const resolvedRoot = path.resolve(repositoryRoot);
  const rootState = await fs.lstat(resolvedRoot);
  if (rootState.isSymbolicLink() || !rootState.isDirectory()) {
    throw new Error("repositoryRoot must be a real directory, not a symbolic link");
  }
  if ((await fs.realpath(resolvedRoot)) !== resolvedRoot) {
    throw new Error("repositoryRoot must not traverse a symbolic link");
  }
  return resolvedRoot;
};

const requirePublicationDestination = ({ repositoryRoot, destinationRelativePath }) => {
  if (
    typeof destinationRelativePath !== "string" ||
    destinationRelativePath.length === 0 ||
    destinationRelativePath.trim() !== destinationRelativePath ||
    path.isAbsolute(destinationRelativePath)
  ) {
    throw new Error("release evidence destination must be a non-empty repository-relative path");
  }
  const destinationPath = path.resolve(repositoryRoot, destinationRelativePath);
  if (!pathIsWithin(repositoryRoot, destinationPath) || destinationPath === repositoryRoot) {
    throw new Error("release evidence destination must stay inside repositoryRoot");
  }
  if (path.extname(destinationPath).toLowerCase() !== ".json") {
    throw new Error("release evidence destination must be an explicit .json file");
  }
  return destinationPath;
};

const inspectDirectory = async (directoryPath) => {
  const state = await fs.lstat(directoryPath);
  if (state.isSymbolicLink() || !state.isDirectory()) {
    throw new Error(`release evidence directory must be a real directory: ${directoryPath}`);
  }
  if ((await fs.realpath(directoryPath)) !== directoryPath) {
    throw new Error(
      `release evidence directory must not traverse a symbolic link: ${directoryPath}`,
    );
  }
};

const ensureSafeDirectoryChain = async ({ repositoryRoot, directoryPath, create }) => {
  if (!pathIsWithin(repositoryRoot, directoryPath)) {
    throw new Error("release evidence directory must stay inside repositoryRoot");
  }
  await inspectDirectory(repositoryRoot);
  const relative = path.relative(repositoryRoot, directoryPath);
  let current = repositoryRoot;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      await inspectDirectory(current);
    } catch (error) {
      if (error?.code !== "ENOENT" || !create) throw error;
      try {
        await fs.mkdir(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError?.code !== "EEXIST") throw mkdirError;
      }
      await inspectDirectory(current);
    }
  }
};

const targetSnapshot = async (targetPath) => {
  try {
    const state = await fs.lstat(targetPath);
    if (state.isSymbolicLink() || !state.isFile()) {
      throw new Error("existing release evidence destination must be a regular non-symlink file");
    }
    if ((await fs.realpath(targetPath)) !== targetPath) {
      throw new Error("release evidence destination must not traverse a symbolic link");
    }
    return Object.freeze({
      dev: state.dev,
      ino: state.ino,
      size: state.size,
      mode: state.mode,
      mtimeMs: state.mtimeMs,
      ctimeMs: state.ctimeMs,
    });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
};

const snapshotsMatch = (left, right) =>
  left === null || right === null
    ? left === right
    : Object.keys(left).every((key) => left[key] === right[key]);

const readValidatedBytes = async (validatedEvidence) => {
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await fs.open(validatedEvidence.reportPath, fsConstants.O_RDONLY | noFollow);
  let state;
  let content;
  try {
    state = await handle.stat();
    if (!state.isFile()) throw new Error("validated release evidence must remain a regular file");
    content = await handle.readFile();
  } finally {
    await handle.close();
  }
  const stateAfter = await fs.lstat(validatedEvidence.reportPath);
  if (
    stateAfter.isSymbolicLink() ||
    !stateAfter.isFile() ||
    stateAfter.dev !== state.dev ||
    stateAfter.ino !== state.ino ||
    stateAfter.size !== state.size
  ) {
    throw new Error("validated release evidence changed while preparing publication");
  }
  const expectedSize = validatedEvidence.publicSummary.evidenceFile.sizeBytes;
  if (content.byteLength !== expectedSize || sha256(content) !== validatedEvidence.reportSha256) {
    throw new Error("validated release evidence bytes changed before publication");
  }
  return content;
};

/**
 * Publishes one already-successful release rehearsal to its immutable, chain-specific path.
 * Validation and staging complete before the atomic rename, so a failure leaves any prior
 * canonical evidence untouched.
 */
export const publishTestnetReleaseEvidence = async ({
  sourceReportPath,
  destinationRelativePath,
  repositoryRoot = process.cwd(),
  expectedTestnetChainId,
  expectedTestnetNetworkName,
  mainnetMinDelaySeconds,
  currentCommit,
  expectedAcceptanceInputDigest,
  protocolManifestInspector,
  protocolDeploymentArtifactInspector,
  windowsAclHardener = hardenPrivateWindowsPath,
} = {}) => {
  const realRepositoryRoot = await requireRealRepositoryRoot(repositoryRoot);
  const destinationPath = requirePublicationDestination({
    repositoryRoot: realRepositoryRoot,
    destinationRelativePath,
  });
  const validatedSource = await validateTestnetReleaseEvidence({
    reportPath: sourceReportPath,
    repositoryRoot: realRepositoryRoot,
    expectedTestnetChainId,
    expectedTestnetNetworkName,
    mainnetMinDelaySeconds,
    currentCommit,
    expectedAcceptanceInputDigest,
    protocolManifestInspector,
    protocolDeploymentArtifactInspector,
  });
  if (validatedSource.reportPath === destinationPath) {
    throw new Error("release evidence source and destination must be different files");
  }
  const sourceBytes = await readValidatedBytes(validatedSource);
  const destinationDirectory = path.dirname(destinationPath);
  await ensureSafeDirectoryChain({
    repositoryRoot: realRepositoryRoot,
    directoryPath: destinationDirectory,
    create: true,
  });
  const destinationBefore = await targetSnapshot(destinationPath);
  const temporaryPath = path.join(
    destinationDirectory,
    `.${path.basename(destinationPath)}.${process.pid}.${randomBytes(16).toString("hex")}.staged.json`,
  );
  let temporaryState;
  let committed = false;
  try {
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    const handle = await fs.open(
      temporaryPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
      0o600,
    );
    try {
      await handle.writeFile(sourceBytes);
      await handle.sync();
      temporaryState = await handle.stat();
      if (!temporaryState.isFile() || temporaryState.size !== sourceBytes.byteLength) {
        throw new Error("staged release evidence was not written completely");
      }
      if (process.platform !== "win32" && (temporaryState.mode & 0o077) !== 0) {
        throw new Error("staged release evidence permissions must not grant group or world access");
      }
    } finally {
      await handle.close();
    }
    if (process.platform === "win32") {
      if (typeof windowsAclHardener !== "function") {
        throw new Error("Windows release evidence ACL hardener must be a function");
      }
      await windowsAclHardener({ targetPath: temporaryPath, entryType: "file" });
      temporaryState = await fs.lstat(temporaryPath);
      if (!temporaryState.isFile() || temporaryState.isSymbolicLink()) {
        throw new Error("staged release evidence must remain a regular non-symlink file");
      }
    }

    const validatedStage = await validateTestnetReleaseEvidence({
      reportPath: temporaryPath,
      repositoryRoot: realRepositoryRoot,
      expectedTestnetChainId,
      expectedTestnetNetworkName,
      mainnetMinDelaySeconds,
      currentCommit,
      expectedAcceptanceInputDigest,
      protocolManifestInspector,
      protocolDeploymentArtifactInspector,
    });
    if (validatedStage.reportSha256 !== validatedSource.reportSha256) {
      throw new Error("staged release evidence does not match the validated source bytes");
    }

    await ensureSafeDirectoryChain({
      repositoryRoot: realRepositoryRoot,
      directoryPath: destinationDirectory,
      create: false,
    });
    const destinationAfter = await targetSnapshot(destinationPath);
    if (!snapshotsMatch(destinationBefore, destinationAfter)) {
      throw new Error("release evidence destination changed while publication was staged");
    }
    const temporaryAfter = await fs.lstat(temporaryPath);
    if (
      temporaryAfter.isSymbolicLink() ||
      !temporaryAfter.isFile() ||
      temporaryAfter.dev !== temporaryState.dev ||
      temporaryAfter.ino !== temporaryState.ino ||
      temporaryAfter.size !== temporaryState.size ||
      temporaryAfter.mode !== temporaryState.mode
    ) {
      throw new Error("staged release evidence changed before publication");
    }

    const result = Object.freeze({
      reportPath: destinationPath,
      repositoryRelativePath: path
        .relative(realRepositoryRoot, destinationPath)
        .split(path.sep)
        .join("/"),
      reportSha256: validatedSource.reportSha256,
    });
    await fs.rename(temporaryPath, destinationPath);
    committed = true;
    return result;
  } finally {
    if (!committed) {
      try {
        await fs.unlink(temporaryPath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
};

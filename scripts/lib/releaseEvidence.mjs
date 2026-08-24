import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { summarizeProductionBuildInfo } from "./acceptanceSafety.mjs";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const RELEASE_INPUT_DIRECTORY_NAMES = Object.freeze([
  "artifacts",
  "contracts",
  "circuits",
  "hardhat",
  "lib",
  "packages",
  "protocol-vectors",
  "scripts",
  "tasks",
]);

export const RELEASE_INPUT_FILE_NAMES = Object.freeze([
  "hardhat.config.mjs",
  "package.json",
  "package-lock.json",
  "protocol-release-manifest.json",
]);

export const gitWorkingTreeState = () => {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const porcelain = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    encoding: "utf8",
  }).trim();
  return {
    commit,
    clean: porcelain === "",
    changedPathCount: porcelain === "" ? 0 : porcelain.split("\n").length,
  };
};

export const hashDirectory = async (ethers, directory) => {
  const entries = [];
  const visit = async (current, relative = "") => {
    let children;
    try {
      children = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const relativePath = path.posix.join(relative, child.name);
      const absolutePath = path.join(current, child.name);
      if (child.isDirectory()) await visit(absolutePath, relativePath);
      else if (child.isFile()) {
        entries.push(`${relativePath}:${ethers.keccak256(await fs.readFile(absolutePath))}`);
      }
    }
  };
  await visit(directory);
  return {
    fileCount: entries.length,
    digest: ethers.keccak256(ethers.toUtf8Bytes(entries.join("\n"))),
  };
};

export const hashReleaseInputs = async (ethers, root = process.cwd()) => {
  const directories = {};
  const files = {};
  const entries = [];
  for (const name of RELEASE_INPUT_DIRECTORY_NAMES) {
    const evidence = await hashDirectory(ethers, path.join(root, name));
    directories[name] = evidence;
    entries.push(`directory:${name}:${evidence.fileCount}:${evidence.digest}`);
  }
  for (const name of RELEASE_INPUT_FILE_NAMES) {
    const digest = ethers.keccak256(await fs.readFile(path.join(root, name)));
    files[name] = digest;
    entries.push(`file:${name}:${digest}`);
  }
  return {
    digest: ethers.keccak256(ethers.toUtf8Bytes(entries.join("\n"))),
    directories,
    files,
  };
};

const canonicalizeJson = (value) => {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalizeJson(value[key])]),
    );
  }
  return value;
};

const canonicalJson = (value) => JSON.stringify(canonicalizeJson(value));

const jsonDigest = (ethers, value) => ethers.keccak256(ethers.toUtf8Bytes(canonicalJson(value)));

const assertRelativeSourcePath = (sourceName, relativePath) => {
  if (
    relativePath === "" ||
    relativePath.includes("\\") ||
    relativePath
      .split("/")
      .some((component) => component === "" || component === "." || component === "..")
  ) {
    throw new Error(`Unsafe Hardhat build-info source path: ${sourceName}`);
  }
  return relativePath;
};

const parseNpmBuildSourceName = (sourceName) => {
  const components = sourceName.slice("npm/".length).split("/");
  let encodedPackage;
  let packageName;
  let sourceComponents;
  if (components[0]?.startsWith("@")) {
    if (components.length < 3) {
      throw new Error(`Malformed scoped npm build-info source name: ${sourceName}`);
    }
    encodedPackage = components[1];
    const versionSeparator = encodedPackage.lastIndexOf("@");
    if (versionSeparator <= 0 || versionSeparator === encodedPackage.length - 1) {
      throw new Error(`npm build-info source omits its package version: ${sourceName}`);
    }
    packageName = `${components[0]}/${encodedPackage.slice(0, versionSeparator)}`;
    sourceComponents = components.slice(2);
  } else {
    encodedPackage = components[0];
    const versionSeparator = encodedPackage?.lastIndexOf("@") ?? -1;
    if (versionSeparator <= 0 || versionSeparator === encodedPackage.length - 1) {
      throw new Error(`npm build-info source omits its package version: ${sourceName}`);
    }
    packageName = encodedPackage.slice(0, versionSeparator);
    sourceComponents = components.slice(1);
  }
  assertRelativeSourcePath(sourceName, [...packageName.split("/"), ...sourceComponents].join("/"));
  if (sourceComponents.length === 0) {
    throw new Error(`npm build-info source omits its package-relative path: ${sourceName}`);
  }
  return { packageName, sourceComponents };
};

const resolveBuildSourcePath = (root, sourceName) => {
  if (sourceName.startsWith("project/")) {
    const relativePath = assertRelativeSourcePath(sourceName, sourceName.slice("project/".length));
    return path.join(root, ...relativePath.split("/"));
  }
  if (sourceName.startsWith("npm/")) {
    const { packageName, sourceComponents } = parseNpmBuildSourceName(sourceName);
    return path.join(root, "node_modules", ...packageName.split("/"), ...sourceComponents);
  }
  throw new Error(
    `Unsupported Hardhat build-info source origin for ${sourceName}; expected project/ or npm/`,
  );
};

const normalizeArtifactNames = (options) => {
  const configured = [
    options.releaseArtifactNames,
    options.artifactNames,
    options.contractNames,
  ].filter((value) => value !== undefined);
  if (configured.length > 1) {
    const normalized = configured.map((value) => canonicalJson(value));
    if (!normalized.every((value) => value === normalized[0])) {
      throw new Error(
        "releaseArtifactNames, artifactNames and contractNames aliases must not disagree",
      );
    }
  }
  const artifactNames = configured[0] ?? [];
  if (
    !Array.isArray(artifactNames) ||
    artifactNames.some((name) => typeof name !== "string" || name.trim() === "")
  ) {
    throw new Error("releaseArtifactNames must be an array of non-empty artifact names");
  }
  const normalized = artifactNames.map((name) => name.trim());
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("releaseArtifactNames must not contain duplicates");
  }
  if (normalized.length > 0 && typeof options.artifacts?.readArtifact !== "function") {
    throw new Error("artifacts.readArtifact is required when release artifacts are requested");
  }
  if (normalized.length === 0 && options.artifacts !== undefined) {
    throw new Error("releaseArtifactNames is required when artifacts is provided");
  }
  return normalized;
};

const normalizeBuildEvidenceArguments = (rootOrOptions, maybeOptions) => {
  if (
    rootOrOptions !== null &&
    typeof rootOrOptions === "object" &&
    !Array.isArray(rootOrOptions)
  ) {
    if (maybeOptions !== undefined) {
      throw new Error("Build evidence options must be provided only once");
    }
    return {
      root: rootOrOptions.root ?? process.cwd(),
      options: rootOrOptions,
    };
  }
  return {
    root: rootOrOptions ?? process.cwd(),
    options: maybeOptions ?? {},
  };
};

const compilerArtifactFields = (compilerContract) => ({
  abi: compilerContract.abi,
  bytecode: `0x${compilerContract.evm?.bytecode?.object ?? ""}`,
  deployedBytecode: `0x${compilerContract.evm?.deployedBytecode?.object ?? ""}`,
  linkReferences: compilerContract.evm?.bytecode?.linkReferences ?? {},
  deployedLinkReferences: compilerContract.evm?.deployedBytecode?.linkReferences ?? {},
  immutableReferences: compilerContract.evm?.deployedBytecode?.immutableReferences ?? {},
});

const hardhatArtifactFields = (artifact) => ({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  deployedBytecode: artifact.deployedBytecode,
  linkReferences: artifact.linkReferences ?? {},
  deployedLinkReferences: artifact.deployedLinkReferences ?? {},
  immutableReferences: artifact.immutableReferences ?? {},
});

const assertArtifactFieldMatches = (artifactName, field, actual, expected) => {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(
      `Release artifact ${artifactName} ${field} does not match its compiler build-info output`,
    );
  }
};

/**
 * Reads Hardhat 3 build-info evidence and verifies that it was produced from the exact source bytes
 * currently present in the workspace and installed npm packages. When release artifacts are
 * supplied, every artifact is additionally traced through buildInfoId/inputSourceName to its
 * compiler output and all deployable artifact fields are compared.
 *
 * Backward-compatible form:
 *   readProductionBuildInfoState(ethers, root, { artifacts, releaseArtifactNames })
 * Object form:
 *   readProductionBuildInfoState(ethers, { root, artifacts, releaseArtifactNames })
 * `artifactNames` and `contractNames` are accepted aliases for releaseArtifactNames.
 */
export const readProductionBuildInfoState = async (
  ethers,
  rootOrOptions = process.cwd(),
  maybeOptions,
) => {
  const { root, options } = normalizeBuildEvidenceArguments(rootOrOptions, maybeOptions);
  const releaseArtifactNames = normalizeArtifactNames(options);
  const directory = path.join(root, "artifacts", "build-info");
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = entries
    .filter(
      (entry) =>
        entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".output.json"),
    )
    .map((entry) => entry.name)
    .sort();
  const outputFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".output.json"))
    .map((entry) => entry.name)
    .sort();
  const expectedOutputFiles = files.map((file) => file.replace(/\.json$/u, ".output.json"));
  if (canonicalJson(outputFiles) !== canonicalJson(expectedOutputFiles)) {
    throw new Error(
      "Hardhat build-info input/output files are not an exact one-to-one pair; rebuild production artifacts",
    );
  }

  const records = [];
  const recordsById = new Map();
  const sourceEvidence = [];
  const outputEvidence = [];
  for (const file of files) {
    const content = await fs.readFile(path.join(directory, file));
    const buildInfo = JSON.parse(content.toString("utf8"));
    const outputFile = file.replace(/\.json$/u, ".output.json");
    const outputContent = await fs.readFile(path.join(directory, outputFile));
    const buildOutput = JSON.parse(outputContent.toString("utf8"));
    const expectedId = file.slice(0, -".json".length);
    if (
      typeof buildInfo.id !== "string" ||
      buildInfo.id !== expectedId ||
      buildOutput.id !== buildInfo.id ||
      !buildOutput.output ||
      typeof buildOutput.output !== "object"
    ) {
      throw new Error(
        `Hardhat build-info pair ${file}/${outputFile} has inconsistent IDs or output`,
      );
    }
    if (recordsById.has(buildInfo.id)) {
      throw new Error(`Duplicate Hardhat build-info ID: ${buildInfo.id}`);
    }
    const record = {
      file: path.posix.join("artifacts", "build-info", file),
      digest: ethers.keccak256(content),
      outputFile: path.posix.join("artifacts", "build-info", outputFile),
      outputDigest: ethers.keccak256(outputContent),
      buildInfo,
      buildOutput,
    };
    records.push(record);
    recordsById.set(buildInfo.id, record);
    outputEvidence.push(`${record.outputFile}:${record.outputDigest}`);

    const sources = buildInfo.input?.sources;
    if (!sources || typeof sources !== "object" || Object.keys(sources).length === 0) {
      throw new Error(`Hardhat build-info ${file} has no compiler input sources`);
    }
    for (const sourceName of Object.keys(sources).sort()) {
      const compilerContent = sources[sourceName]?.content;
      if (typeof compilerContent !== "string") {
        throw new Error(`Hardhat build-info source ${sourceName} does not contain inline content`);
      }
      const sourcePath = resolveBuildSourcePath(root, sourceName);
      let workspaceContent;
      try {
        workspaceContent = await fs.readFile(sourcePath);
      } catch (error) {
        if (error.code === "ENOENT") {
          throw new Error(
            `Hardhat build-info source ${sourceName} is missing from the current workspace`,
          );
        }
        throw error;
      }
      const compilerBytes = Buffer.from(compilerContent, "utf8");
      if (!workspaceContent.equals(compilerBytes)) {
        throw new Error(
          `Current source ${sourceName} does not exactly match the Hardhat build-info compiler input`,
        );
      }
      sourceEvidence.push(`${buildInfo.id}:${sourceName}:${ethers.keccak256(workspaceContent)}`);
    }
  }

  const artifactProvenance = [];
  for (const artifactName of releaseArtifactNames) {
    const artifact = await options.artifacts.readArtifact(artifactName);
    if (typeof artifact?.buildInfoId !== "string" || artifact.buildInfoId === "") {
      throw new Error(`Release artifact ${artifactName} has no Hardhat buildInfoId`);
    }
    const record = recordsById.get(artifact.buildInfoId);
    if (!record) {
      throw new Error(
        `Release artifact ${artifactName} references unavailable buildInfoId ${artifact.buildInfoId}`,
      );
    }
    if (typeof artifact.contractName !== "string" || typeof artifact.sourceName !== "string") {
      throw new Error(`Release artifact ${artifactName} has malformed contract/source names`);
    }
    const mappedInputSourceName = record.buildInfo.userSourceNameMap?.[artifact.sourceName];
    const inputSourceName =
      artifact.inputSourceName ?? mappedInputSourceName ?? artifact.sourceName;
    if (
      typeof inputSourceName !== "string" ||
      (mappedInputSourceName !== undefined && mappedInputSourceName !== inputSourceName)
    ) {
      throw new Error(
        `Release artifact ${artifactName} inputSourceName does not match its build-info source map`,
      );
    }
    if (!record.buildInfo.input?.sources?.[inputSourceName]) {
      throw new Error(
        `Release artifact ${artifactName} source ${inputSourceName} is absent from its compiler input`,
      );
    }
    const compilerContract =
      record.buildOutput.output.contracts?.[inputSourceName]?.[artifact.contractName];
    if (!compilerContract) {
      throw new Error(
        `Release artifact ${artifactName} contract output ${inputSourceName}:${artifact.contractName} is missing`,
      );
    }
    const actualFields = hardhatArtifactFields(artifact);
    const compilerFields = compilerArtifactFields(compilerContract);
    for (const field of Object.keys(compilerFields)) {
      assertArtifactFieldMatches(artifactName, field, actualFields[field], compilerFields[field]);
    }
    artifactProvenance.push(
      Object.freeze({
        artifactName,
        contractName: artifact.contractName,
        sourceName: artifact.sourceName,
        inputSourceName,
        buildInfoId: artifact.buildInfoId,
        buildInfoInputDigest: record.digest.toLowerCase(),
        buildInfoOutputDigest: record.outputDigest.toLowerCase(),
        abiDigest: jsonDigest(ethers, actualFields.abi).toLowerCase(),
        bytecodeDigest: ethers.keccak256(ethers.toUtf8Bytes(actualFields.bytecode)).toLowerCase(),
        deployedBytecodeDigest: ethers
          .keccak256(ethers.toUtf8Bytes(actualFields.deployedBytecode))
          .toLowerCase(),
        linkReferencesDigest: jsonDigest(ethers, actualFields.linkReferences).toLowerCase(),
        deployedLinkReferencesDigest: jsonDigest(
          ethers,
          actualFields.deployedLinkReferences,
        ).toLowerCase(),
        immutableReferencesDigest: jsonDigest(
          ethers,
          actualFields.immutableReferences,
        ).toLowerCase(),
      }),
    );
  }

  const summary = summarizeProductionBuildInfo(records);
  return Object.freeze({
    ...summary,
    buildInfoOutputFileCount: outputEvidence.length,
    buildInfoOutputDigest: ethers
      .keccak256(ethers.toUtf8Bytes(outputEvidence.join("\n")))
      .toLowerCase(),
    buildInfoOutputsMatched: true,
    sourceFileCount: sourceEvidence.length,
    sourceInputDigest: ethers
      .keccak256(ethers.toUtf8Bytes(sourceEvidence.join("\n")))
      .toLowerCase(),
    sourceContentsMatched: true,
    artifactProvenanceChecked: releaseArtifactNames.length > 0,
    artifactProvenanceMatched: releaseArtifactNames.length > 0 ? true : null,
    releaseArtifactCount: artifactProvenance.length,
    artifactProvenance: Object.freeze(artifactProvenance),
  });
};

export const verificationEntry = async (
  artifacts,
  name,
  address,
  constructorArgs = [],
  libraries = {},
) => {
  const artifact = await artifacts.readArtifact(name);
  return {
    label: name,
    address,
    contract: `${artifact.sourceName}:${artifact.contractName}`,
    constructorArgs,
    libraries,
  };
};

export const waitForFinalizedTransactions = async ({
  provider,
  transactions,
  timeoutMs,
  pollIntervalMs = 2_000,
}) => {
  const entries = Object.entries(transactions).filter(([, entry]) => entry.hash && entry.receipt);
  if (entries.length === 0) throw new Error("No confirmed release transactions are available");
  const lastCriticalBlock = Math.max(
    ...entries.map(([, entry]) => Number(entry.receipt.blockNumber)),
  );
  const deadline = Date.now() + timeoutMs;
  let finalizedBlock;
  while (Date.now() <= deadline) {
    finalizedBlock = await provider.getBlock("finalized");
    if (finalizedBlock && Number(finalizedBlock.number) >= lastCriticalBlock) break;
    const remaining = deadline - Date.now();
    if (remaining > 0) await sleep(Math.min(pollIntervalMs, remaining));
  }
  if (!finalizedBlock || Number(finalizedBlock.number) < lastCriticalBlock) {
    throw new Error(
      `Finalized head did not cover release block ${lastCriticalBlock} within ${timeoutMs}ms`,
    );
  }

  const revalidatedTransactions = [];
  for (const [label, expected] of entries) {
    const receipt = await provider.getTransactionReceipt(expected.hash);
    if (!receipt || Number(receipt.status) !== 1) {
      throw new Error(`${label} successful receipt disappeared before finality`);
    }
    if (
      Number(receipt.blockNumber) !== Number(expected.receipt.blockNumber) ||
      String(receipt.blockHash).toLowerCase() !== String(expected.receipt.blockHash).toLowerCase()
    ) {
      throw new Error(`${label} receipt changed before finality`);
    }
    const block = await provider.getBlock(receipt.blockNumber);
    if (!block || String(block.hash).toLowerCase() !== String(receipt.blockHash).toLowerCase()) {
      throw new Error(`${label} is not in the canonical block recorded by its receipt`);
    }
    if (Number(finalizedBlock.number) < Number(receipt.blockNumber)) {
      throw new Error(`${label} is above the finalized head`);
    }
    revalidatedTransactions.push({
      label,
      hash: receipt.hash,
      blockNumber: Number(receipt.blockNumber),
      blockHash: receipt.blockHash,
    });
  }
  return {
    status: "passed",
    lastCriticalBlock,
    finalizedBlockNumber: Number(finalizedBlock.number),
    finalizedBlockHash: finalizedBlock.hash,
    revalidatedTransactions,
  };
};

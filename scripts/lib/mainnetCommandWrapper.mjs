import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  acquireExclusiveCommandLock,
  productionBuildLockPath,
  releaseExclusiveCommandLocks,
} from "./exclusiveCommandLock.mjs";
import { readRecoveryTransactionsFile, readReleaseApprovalFile } from "./mainnetCommandInput.mjs";
import { normalizePortableCommand, sanitizeReleaseEnvironment } from "./portableCommand.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HARDHAT_CLI = path.join(ROOT, "node_modules", "hardhat", "dist", "src", "cli.js");
const PRODUCTION_BUILD_LOCK_PATH = productionBuildLockPath(ROOT);
const HASH_32_PATTERN = /^0x[0-9a-fA-F]{64}$/u;

const run = (args, environment, label) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HARDHAT_CLI, ...args], {
      cwd: ROOT,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            signal ? `${label} was terminated by ${signal}` : `${label} exited with code ${code}`,
          ),
        );
      }
    });
  });

const runReleasePreflight = (environment) =>
  new Promise((resolve, reject) => {
    const command = normalizePortableCommand({
      executable: "npm",
      args: ["run", "release:preflight"],
      platform: process.platform,
      env: environment,
    });
    const child = spawn(command.executable, command.args, {
      cwd: ROOT,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            signal
              ? `Production release preflight was terminated by ${signal}`
              : `Production release preflight exited with code ${code}`,
          ),
        );
      }
    });
  });

const parseOptionPairs = (arguments_, allowedNames, usage) => {
  if (arguments_.length % 2 !== 0) throw new Error(usage);
  const values = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!allowedNames.has(name) || typeof value !== "string" || value.trim() === "") {
      throw new Error(usage);
    }
    if (Object.hasOwn(values, name)) throw new Error(`${name} must be supplied exactly once`);
    values[name] = value.trim();
  }
  return values;
};

const safeUsage = (chainProfile) =>
  `Usage: ${chainProfile.mainnet.safePlanCommand}; ` +
  `${chainProfile.mainnet.safeExecuteCommand} -- --digest 0x... ` +
  `[--recovery-tx 0x...]; or ${chainProfile.mainnet.safeStatusCommand}`;

export const parseMainnetSafeCommandArguments = (chainProfile, arguments_) => {
  const usage = safeUsage(chainProfile);
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    return Object.freeze({ mode: "plan", digest: null, recoveryTransaction: null });
  }
  if (arguments_.length === 1 && arguments_[0] === "--status") {
    return Object.freeze({ mode: "status", digest: null, recoveryTransaction: null });
  }
  if (arguments_[0] !== "--execute") throw new Error(usage);
  const options = parseOptionPairs(
    arguments_.slice(1),
    new Set(["--digest", "--recovery-tx"]),
    usage,
  );
  if (!HASH_32_PATTERN.test(options["--digest"] ?? "")) {
    throw new Error("--digest must be the exact 32-byte digest printed by Safe plan mode");
  }
  const recoveryTransaction = options["--recovery-tx"] ?? null;
  if (recoveryTransaction !== null && !HASH_32_PATTERN.test(recoveryTransaction)) {
    throw new Error("--recovery-tx must be a 32-byte transaction hash");
  }
  return Object.freeze({
    mode: "execute",
    digest: options["--digest"].toLowerCase(),
    recoveryTransaction: recoveryTransaction?.toLowerCase() ?? null,
  });
};

const releaseUsage = (chainProfile) =>
  `Usage: ${chainProfile.mainnet.releasePlanCommand}; or ` +
  `${chainProfile.mainnet.releaseExecuteCommand} -- --approval-file <path> ` +
  `[--recovery-file <path>]`;

export const parseMainnetReleaseCommandArguments = (chainProfile, arguments_) => {
  const usage = releaseUsage(chainProfile);
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    return Object.freeze({ mode: "plan", approvalFile: null, recoveryFile: null });
  }
  if (arguments_[0] !== "--execute") throw new Error(usage);
  const options = parseOptionPairs(
    arguments_.slice(1),
    new Set(["--approval-file", "--recovery-file"]),
    usage,
  );
  if (!options["--approval-file"]) throw new Error(usage);
  return Object.freeze({
    mode: "execute",
    approvalFile: options["--approval-file"],
    recoveryFile: options["--recovery-file"] ?? null,
  });
};

const commandPaths = (chainProfile, kind, root = ROOT) => {
  const directory = path.join(
    path.resolve(root),
    "deployments",
    chainProfile.mainnet.deploymentDirectoryName,
  );
  return {
    directory,
    shared: path.join(directory, ".mainnet-command.lock"),
    command: path.join(directory, `.mainnet-${kind}-command.lock`),
  };
};

export const runMainnetSafeCommand = async ({
  chainProfile,
  arguments_ = process.argv.slice(2),
  entryScript,
  environment = process.env,
  hardhatRunner = run,
  root = ROOT,
}) => {
  const command = parseMainnetSafeCommandArguments(chainProfile, arguments_);
  const paths = commandPaths(chainProfile, "safe", root);
  const sharedLock = await acquireExclusiveCommandLock({
    lockPath: paths.shared,
    label: `${chainProfile.displayName} mainnet production command`,
  });
  let commandLock;
  try {
    commandLock = await acquireExclusiveCommandLock({
      lockPath: paths.command,
      label: `${chainProfile.displayName} mainnet Safe command`,
    });
    const childEnvironment = {
      ...sanitizeReleaseEnvironment(environment),
      [chainProfile.mainnet.safePlanDigestEnvironmentName]: command.digest ?? "",
      [chainProfile.mainnet.safeRecoveryTransactionEnvironmentName]:
        command.recoveryTransaction ?? "",
      [chainProfile.mainnet.safeWrapperTokenEnvironmentName]: commandLock.token,
      [chainProfile.mainnet.sharedWrapperTokenEnvironmentName]: sharedLock.token,
      [chainProfile.mainnet.safeWrapperModeEnvironmentName]: command.mode,
    };
    await hardhatRunner(
      [
        "--config",
        "hardhat.config.mjs",
        "--network",
        chainProfile.mainnet.networkName,
        "run",
        "--no-compile",
        entryScript,
      ],
      childEnvironment,
      `${chainProfile.displayName} mainnet Safe ${command.mode} phase`,
    );
  } finally {
    await releaseExclusiveCommandLocks([commandLock, sharedLock]);
  }
};

export const runMainnetReleaseCommand = async ({
  chainProfile,
  arguments_ = process.argv.slice(2),
  entryScript,
  environment = process.env,
  hardhatRunner = run,
  preflightRunner = runReleasePreflight,
  root = ROOT,
}) => {
  const command = parseMainnetReleaseCommandArguments(chainProfile, arguments_);
  const approval =
    command.mode === "execute"
      ? await readReleaseApprovalFile({ filePath: command.approvalFile, root })
      : null;
  const recoveryTransactions = command.recoveryFile
    ? await readRecoveryTransactionsFile({ filePath: command.recoveryFile, root })
    : {};
  const paths = commandPaths(chainProfile, "release", root);
  const sharedLock = await acquireExclusiveCommandLock({
    lockPath: paths.shared,
    label: `${chainProfile.displayName} mainnet production command`,
  });
  let commandLock;
  let buildLock;
  try {
    commandLock = await acquireExclusiveCommandLock({
      lockPath: paths.command,
      label: `${chainProfile.displayName} mainnet release command`,
    });
    buildLock = await acquireExclusiveCommandLock({
      lockPath:
        path.resolve(root) === ROOT ? PRODUCTION_BUILD_LOCK_PATH : productionBuildLockPath(root),
      label: "shared production build",
    });
    const preflightEnvironment = {
      ...sanitizeReleaseEnvironment(environment),
      [chainProfile.mainnet.planDigestEnvironmentName]: "",
      [chainProfile.mainnet.planApprovalSignaturesEnvironmentName]: "",
      [chainProfile.mainnet.recoveryTransactionsEnvironmentName]: "",
    };
    const childEnvironment = {
      ...preflightEnvironment,
      [chainProfile.mainnet.planDigestEnvironmentName]: approval?.planDigest ?? "",
      [chainProfile.mainnet.planApprovalSignaturesEnvironmentName]: approval
        ? JSON.stringify(approval.signatures)
        : "",
      [chainProfile.mainnet.recoveryTransactionsEnvironmentName]:
        Object.keys(recoveryTransactions).length === 0 ? "" : JSON.stringify(recoveryTransactions),
      [chainProfile.mainnet.releaseWrapperTokenEnvironmentName]: commandLock.token,
      [chainProfile.mainnet.releaseWrapperModeEnvironmentName]: command.mode,
      [chainProfile.mainnet.sharedWrapperTokenEnvironmentName]: sharedLock.token,
    };
    // This performs the clean production build plus contract/frontend/ZK/security checks. A
    // Mainnet plan is not generated unless the complete preflight succeeds in this same command.
    await preflightRunner(preflightEnvironment);
    await hardhatRunner(
      [
        "--config",
        "hardhat.config.mjs",
        "--build-profile",
        "production",
        "--network",
        chainProfile.mainnet.networkName,
        "run",
        "--no-compile",
        entryScript,
      ],
      childEnvironment,
      `${chainProfile.displayName} mainnet release ${command.mode} phase`,
    );
  } finally {
    await releaseExclusiveCommandLocks([buildLock, commandLock, sharedLock]);
  }
};

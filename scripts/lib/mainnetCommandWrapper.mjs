import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  acquireExclusiveCommandLock,
  productionBuildLockPath,
  releaseExclusiveCommandLocks,
} from "./exclusiveCommandLock.mjs";
import { normalizePortableCommand, sanitizeReleaseEnvironment } from "./portableCommand.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HARDHAT_CLI = path.join(ROOT, "node_modules", "hardhat", "dist", "src", "cli.js");
const PRODUCTION_BUILD_LOCK_PATH = productionBuildLockPath(ROOT);

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

const parseSafeMode = (chainProfile, arguments_) => {
  if (arguments_.length === 0) return "run";
  if (arguments_.length === 1 && arguments_[0] === "--status") return "status";
  throw new Error(
    `Usage: ${chainProfile.mainnet.safeCommand} or ${chainProfile.mainnet.safeStatusCommand}`,
  );
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
  const mode = parseSafeMode(chainProfile, arguments_);
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
      [chainProfile.mainnet.safeWrapperTokenEnvironmentName]: commandLock.token,
      [chainProfile.mainnet.sharedWrapperTokenEnvironmentName]: sharedLock.token,
      [chainProfile.mainnet.safeWrapperModeEnvironmentName]: mode,
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
      `${chainProfile.displayName} mainnet Safe phase`,
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
  if (arguments_.length !== 0) {
    throw new Error(`Usage: ${chainProfile.mainnet.releaseCommand}`);
  }
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
    const childEnvironment = {
      ...sanitizeReleaseEnvironment(environment),
      [chainProfile.mainnet.releaseWrapperTokenEnvironmentName]: commandLock.token,
      [chainProfile.mainnet.sharedWrapperTokenEnvironmentName]: sharedLock.token,
    };
    // This performs the clean production build plus contract/frontend/ZK/security checks. A
    // Mainnet plan is not generated unless the complete preflight succeeds in this same command.
    await preflightRunner(childEnvironment);
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
      `${chainProfile.displayName} mainnet release phase`,
    );
  } finally {
    await releaseExclusiveCommandLocks([buildLock, commandLock, sharedLock]);
  }
};

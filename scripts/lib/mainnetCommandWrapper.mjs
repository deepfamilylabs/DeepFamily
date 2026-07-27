import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  acquireExclusiveCommandLock,
  releaseExclusiveCommandLocks,
} from "./exclusiveCommandLock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HARDHAT_CLI = path.join(ROOT, "node_modules", "hardhat", "dist", "src", "cli.js");
const PRODUCTION_BUILD_LOCK_PATH = path.join(ROOT, "deployments", ".production-build.lock");

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
            signal
              ? `${label} was terminated by ${signal}`
              : `${label} exited with code ${code}`,
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

const commandPaths = (chainProfile, kind) => {
  const directory = path.join(
    ROOT,
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
}) => {
  const mode = parseSafeMode(chainProfile, arguments_);
  const paths = commandPaths(chainProfile, "safe");
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
    const environment = {
      ...process.env,
      [chainProfile.mainnet.safeWrapperTokenEnvironmentName]: commandLock.token,
      [chainProfile.mainnet.sharedWrapperTokenEnvironmentName]: sharedLock.token,
      [chainProfile.mainnet.safeWrapperModeEnvironmentName]: mode,
    };
    await run(
      [
        "--config",
        "hardhat.config.mjs",
        "--network",
        chainProfile.mainnet.networkName,
        "run",
        "--no-compile",
        entryScript,
      ],
      environment,
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
}) => {
  if (arguments_.length !== 0) {
    throw new Error(`Usage: ${chainProfile.mainnet.releaseCommand}`);
  }
  const paths = commandPaths(chainProfile, "release");
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
      lockPath: PRODUCTION_BUILD_LOCK_PATH,
      label: "shared production build",
    });
    const environment = {
      ...process.env,
      [chainProfile.mainnet.releaseWrapperTokenEnvironmentName]: commandLock.token,
      [chainProfile.mainnet.sharedWrapperTokenEnvironmentName]: sharedLock.token,
    };
    await run(["--config", "hardhat.config.mjs", "clean"], environment, "Hardhat clean");
    await run(
      ["--config", "hardhat.config.mjs", "--build-profile", "production", "compile"],
      environment,
      "Hardhat production compile",
    );
    await run(
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
      environment,
      `${chainProfile.displayName} mainnet release phase`,
    );
  } finally {
    await releaseExclusiveCommandLocks([buildLock, commandLock, sharedLock]);
  }
};

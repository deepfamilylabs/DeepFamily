import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  acquireExclusiveCommandLock,
  releaseExclusiveCommandLocks,
} from "./lib/exclusiveCommandLock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHARED_COMMAND_LOCK_PATH = path.join(ROOT, "deployments", "conflux", ".mainnet-command.lock");
const COMMAND_LOCK_PATH = path.join(ROOT, "deployments", "conflux", ".mainnet-safe-command.lock");
const HARDHAT_CLI = path.join(ROOT, "node_modules", "hardhat", "dist", "src", "cli.js");
const WRAPPER_TOKEN_ENV = "DEEPFAMILY_ESPACE_MAINNET_SAFE_WRAPPER_TOKEN";
const SHARED_WRAPPER_TOKEN_ENV = "DEEPFAMILY_ESPACE_MAINNET_COMMAND_WRAPPER_TOKEN";
const WRAPPER_MODE_ENV = "DEEPFAMILY_ESPACE_MAINNET_SAFE_WRAPPER_MODE";

const parseMode = (arguments_) => {
  if (arguments_.length === 0) return "run";
  if (arguments_.length === 1 && arguments_[0] === "--status") return "status";
  throw new Error("Usage: npm run espace:mainnet:safe or npm run espace:mainnet:safe:status");
};

const run = (args, environment) =>
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
              ? `Hardhat Safe phase was terminated by ${signal}`
              : `Hardhat Safe phase exited with code ${code}`,
          ),
        );
      }
    });
  });

const main = async () => {
  const mode = parseMode(process.argv.slice(2));
  const sharedLock = await acquireExclusiveCommandLock({
    lockPath: SHARED_COMMAND_LOCK_PATH,
    label: "eSpace mainnet production command",
  });
  let commandLock;
  try {
    commandLock = await acquireExclusiveCommandLock({
      lockPath: COMMAND_LOCK_PATH,
      label: "eSpace mainnet Safe command",
    });
    const environment = {
      ...process.env,
      [WRAPPER_TOKEN_ENV]: commandLock.token,
      [SHARED_WRAPPER_TOKEN_ENV]: sharedLock.token,
      [WRAPPER_MODE_ENV]: mode,
    };
    await run(
      [
        "--config",
        "hardhat.config.mjs",
        "--network",
        "conflux",
        "run",
        "--no-compile",
        "scripts/espace-mainnet-safe.mjs",
      ],
      environment,
    );
  } finally {
    await releaseExclusiveCommandLocks([commandLock, sharedLock]);
  }
};

main().catch((error) => {
  console.error(`[espace-mainnet-safe-command] ${error.message}`);
  process.exitCode = 1;
});

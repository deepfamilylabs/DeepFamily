import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMAND_LOCK_PATH = path.join(
  ROOT,
  "deployments",
  "conflux",
  ".mainnet-release-command.lock",
);
const HARDHAT_CLI = path.join(ROOT, "node_modules", "hardhat", "dist", "src", "cli.js");
const WRAPPER_TOKEN_ENV = "DEEPFAMILY_ESPACE_MAINNET_WRAPPER_TOKEN";

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
              ? `Hardhat release phase was terminated by ${signal}`
              : `Hardhat release phase exited with code ${code}`,
          ),
        );
      }
    });
  });

const acquireCommandLock = async () => {
  await fs.mkdir(path.dirname(COMMAND_LOCK_PATH), { recursive: true });
  const token = randomUUID();
  let handle;
  try {
    handle = await fs.open(COMMAND_LOCK_PATH, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(
        `Mainnet release command lock already exists at ${COMMAND_LOCK_PATH}. Confirm no ` +
          "plan or release process is running before treating it as stale.",
      );
    }
    throw error;
  }
  await handle.writeFile(`${JSON.stringify({ pid: process.pid, token }, null, 2)}\n`);
  return {
    token,
    release: async () => {
      await handle.close();
      const current = JSON.parse(await fs.readFile(COMMAND_LOCK_PATH, "utf8"));
      if (current.token !== token) {
        throw new Error("Mainnet release command lock ownership changed unexpectedly");
      }
      await fs.unlink(COMMAND_LOCK_PATH);
    },
  };
};

const main = async () => {
  const commandLock = await acquireCommandLock();
  try {
    const environment = { ...process.env, [WRAPPER_TOKEN_ENV]: commandLock.token };
    await run(["--config", "hardhat.config.mjs", "clean"], environment);
    await run(
      ["--config", "hardhat.config.mjs", "--build-profile", "production", "compile"],
      environment,
    );
    await run(
      [
        "--config",
        "hardhat.config.mjs",
        "--build-profile",
        "production",
        "--network",
        "conflux",
        "run",
        "--no-compile",
        "scripts/espace-mainnet-release.mjs",
      ],
      environment,
    );
  } finally {
    await commandLock.release();
  }
};

main().catch((error) => {
  console.error(`[espace-mainnet-release-command] ${error.message}`);
  process.exitCode = 1;
});

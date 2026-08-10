import "dotenv/config";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  acquireExclusiveCommandLock,
  productionBuildLockPath,
  releaseExclusiveCommandLocks,
} from "./exclusiveCommandLock.mjs";
import { normalizePortableCommand, sanitizeReleaseEnvironment } from "./portableCommand.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const runChild = ({ executable, args, environment, label }) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
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

export const acceptanceCommandLockPath = (chainProfile, root = ROOT) =>
  path.join(
    path.resolve(root),
    "tmp",
    chainProfile.acceptance.reportDirectoryName,
    chainProfile.acceptance.commandLockFileName,
  );

export const assertAcceptanceReleaseRehearsalWrapper = async ({
  chainProfile,
  environment = process.env,
  root = process.cwd(),
} = {}) => {
  const acceptance = chainProfile?.acceptance;
  if (!acceptance) throw new Error("A guarded acceptance chain profile is required");
  const expectedToken = String(environment[acceptance.wrapperTokenEnvironmentName] ?? "").trim();
  if (expectedToken === "") {
    throw new Error(
      `Use ${acceptance.command}; direct release-rehearsal script execution is forbidden`,
    );
  }

  const lockPath = acceptanceCommandLockPath(chainProfile, root);
  let lock;
  try {
    lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("Acceptance release-rehearsal command wrapper lock is missing");
    }
    throw new Error("Acceptance release-rehearsal command wrapper lock is invalid", {
      cause: error,
    });
  }
  if (!lock || typeof lock !== "object" || lock.token !== expectedToken) {
    throw new Error("Acceptance release-rehearsal command wrapper lock does not match");
  }
};

export const runAcceptanceCommand = async ({
  chainProfile,
  entryScript,
  arguments_ = process.argv.slice(2),
  environment = process.env,
  childRunner = runChild,
  root = ROOT,
}) => {
  if (typeof childRunner !== "function") throw new Error("childRunner must be a function");
  if (arguments_.length !== 0) {
    throw new Error(`Usage: ${chainProfile.acceptance.command}`);
  }
  const acceptance = chainProfile.acceptance;
  const mode = String(environment[acceptance.modeEnvironmentName] ?? "diagnostic").trim();
  if (!["diagnostic", "release-rehearsal"].includes(mode)) {
    throw new Error(`${acceptance.modeEnvironmentName} must be diagnostic or release-rehearsal`);
  }
  const sanitizedEnvironment = sanitizeReleaseEnvironment(environment);

  const runHardhat = async (childEnvironment) => {
    const hardhatArguments = [
      path.join(root, "node_modules", "hardhat", "dist", "src", "cli.js"),
      "--config",
      "hardhat.config.mjs",
      "--build-profile",
      "production",
      "--network",
      acceptance.networkName,
      "run",
    ];
    if (mode === "release-rehearsal") hardhatArguments.push("--no-compile");
    hardhatArguments.push(entryScript);
    await childRunner({
      executable: process.execPath,
      args: hardhatArguments,
      environment: childEnvironment,
      label: `${chainProfile.displayName} ${mode} acceptance`,
    });
  };

  if (mode === "diagnostic") {
    await runHardhat(sanitizedEnvironment);
    return;
  }

  let commandLock;
  let buildLock;
  try {
    commandLock = await acquireExclusiveCommandLock({
      lockPath: acceptanceCommandLockPath(chainProfile, root),
      label: `${chainProfile.displayName} acceptance release-rehearsal command`,
    });
    buildLock = await acquireExclusiveCommandLock({
      lockPath: productionBuildLockPath(root),
      label: "shared production build",
    });
    const childEnvironment = {
      ...sanitizedEnvironment,
      [acceptance.wrapperTokenEnvironmentName]: commandLock.token,
    };
    const preflightCommand = normalizePortableCommand({
      executable: "npm",
      args: ["run", "release:preflight"],
      platform: process.platform,
      env: childEnvironment,
    });
    await childRunner({
      ...preflightCommand,
      environment: childEnvironment,
      label: "Production release preflight",
    });
    await runHardhat(childEnvironment);
  } finally {
    await releaseExclusiveCommandLocks([buildLock, commandLock]);
  }
};

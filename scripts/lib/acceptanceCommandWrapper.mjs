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
import { sanitizeReleaseEnvironment } from "./portableCommand.mjs";
import { runReleaseChecks } from "../release-preflight.mjs";
import {
  bindReleaseCheckBoundary,
  withoutReleaseCheckBoundaryEnvironment,
} from "./releaseCheckBoundary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runReleaseBuildChecks = (environment) => runReleaseChecks({ root: ROOT, env: environment });

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
  preflightRunner = runReleaseBuildChecks,
  root = ROOT,
}) => {
  if (typeof childRunner !== "function") throw new Error("childRunner must be a function");
  if (typeof preflightRunner !== "function") throw new Error("preflightRunner must be a function");
  if (arguments_.length !== 0) {
    throw new Error(`Usage: ${chainProfile.acceptance.command}`);
  }
  const acceptance = chainProfile.acceptance;
  const mode = String(environment[acceptance.modeEnvironmentName] ?? "diagnostic").trim();
  if (!["diagnostic", "release-rehearsal"].includes(mode)) {
    throw new Error(`${acceptance.modeEnvironmentName} must be diagnostic or release-rehearsal`);
  }
  const sanitizedEnvironment = {
    ...withoutReleaseCheckBoundaryEnvironment(sanitizeReleaseEnvironment(environment)),
    DEEPFAMILY_COMMAND_CHAIN: chainProfile.id,
  };

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
    // The final acceptance process verifies the complete ceremony against these checked inputs.
    const checkResult = await preflightRunner(childEnvironment);
    await runHardhat(
      bindReleaseCheckBoundary({ environment: childEnvironment, result: checkResult }),
    );
  } finally {
    await releaseExclusiveCommandLocks([buildLock, commandLock]);
  }
};

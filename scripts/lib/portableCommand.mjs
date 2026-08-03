import fs from "node:fs";
import path from "node:path";

const WINDOWS_NPM_CLI_NAMES = new Set(["npm-cli.js", "npm-cli.cjs"]);
const RELEASE_ENVIRONMENT_INJECTION_PATTERN = /^(?:NODE|LD|DYLD|NPM_CONFIG|GIT|DOTENV_CONFIG)_/iu;

/**
 * Removes process-loader and tool-configuration hooks that can execute or redirect code in a
 * release child process. Matching is case-insensitive because Windows environment names are
 * case-insensitive and callers may provide plain fixture objects on every platform.
 */
export const sanitizeReleaseEnvironment = (env = process.env) => {
  if (env === null || typeof env !== "object" || Array.isArray(env)) {
    throw new TypeError("release environment must be an object");
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(env).filter(([name]) => !RELEASE_ENVIRONMENT_INJECTION_PATTERN.test(name)),
    ),
  );
};

export const assertReleaseRuntimeCompatibility = ({
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  operation = "Release operation",
} = {}) => {
  if (platform !== "win32") return;

  const nativeHostArchitecture = String(
    readWindowsEnvironmentValue(env, "PROCESSOR_ARCHITEW6432") ??
      readWindowsEnvironmentValue(env, "PROCESSOR_ARCHITECTURE") ??
      "",
  ).toLowerCase();
  if (arch === "arm64" || nativeHostArchitecture === "arm64") {
    throw new Error(
      `${operation} does not support Windows ARM64 hosts, including x64 Node.js emulation; ` +
        "the supported Windows runtime is x64 Node.js on an x64 host.",
    );
  }
};

const readWindowsEnvironmentValue = (env, expectedName) => {
  if (env === null || typeof env !== "object" || Array.isArray(env)) {
    throw new TypeError("command environment must be an object");
  }
  const matches = Object.entries(env).filter(
    ([name]) => name.toUpperCase() === expectedName.toUpperCase(),
  );
  if (matches.length > 1) {
    throw new Error(`Windows command environment contains duplicate ${expectedName} entries`);
  }
  return matches[0]?.[1];
};

export const normalizePortableCommand = ({
  executable,
  args,
  platform = process.platform,
  env = process.env,
} = {}) => {
  if (typeof executable !== "string" || executable.length === 0) {
    throw new TypeError("command executable must be a non-empty string");
  }
  if (!Array.isArray(args)) {
    throw new TypeError("command args must be an array");
  }
  if (platform !== "win32" || executable !== "npm") {
    return Object.freeze({ executable, args: Object.freeze([...args]) });
  }

  const configuredNpmCli = readWindowsEnvironmentValue(env, "npm_execpath");
  if (typeof configuredNpmCli !== "string" || configuredNpmCli.length === 0) {
    throw new Error(
      "Windows npm commands require npm_execpath; invoke this command through `npm run`",
    );
  }
  const npmCli = fs.realpathSync(configuredNpmCli);
  if (
    !fs.statSync(npmCli).isFile() ||
    !WINDOWS_NPM_CLI_NAMES.has(path.basename(npmCli).toLowerCase())
  ) {
    throw new Error("Windows npm_execpath must resolve to the npm CLI");
  }
  return Object.freeze({
    executable: process.execPath,
    args: Object.freeze([npmCli, ...args]),
  });
};

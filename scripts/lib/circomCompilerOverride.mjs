import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CIRCOM_VERSION, resolveLocalCircomTarget } from "./circomToolchain.mjs";

export const CIRCOM_OVERRIDE_ENV = Object.freeze({
  path: "DEEPFAMILY_ZK_COMPILER_PATH",
  sha256: "DEEPFAMILY_ZK_COMPILER_SHA256",
  target: "DEEPFAMILY_ZK_COMPILER_TARGET",
});

export const withoutCircomOverrideEnvironment = (env = process.env) =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(env).filter(
        ([name]) =>
          !Object.values(CIRCOM_OVERRIDE_ENV)
            .map((value) => value.toUpperCase())
            .includes(name.toUpperCase()),
      ),
    ),
  );

const defaultVersionRunner = (executable) =>
  String(
    execFileSync(executable, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  ).trim();

const isInside = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

export const buildCircomOverrideEnvironment = ({ env = process.env, compiler }) => {
  if (
    typeof compiler?.path !== "string" ||
    !path.isAbsolute(compiler.path) ||
    typeof compiler?.target !== "string" ||
    !/^[0-9a-f]{64}$/u.test(compiler?.sha256 ?? "")
  ) {
    throw new Error("Release Circom compiler override evidence is invalid");
  }
  return Object.freeze({
    ...withoutCircomOverrideEnvironment(env),
    [CIRCOM_OVERRIDE_ENV.path]: compiler.path,
    [CIRCOM_OVERRIDE_ENV.sha256]: compiler.sha256,
    [CIRCOM_OVERRIDE_ENV.target]: compiler.target,
  });
};

export const inspectCircomCompilerOverride = ({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  libc,
  report,
  versionRunner = defaultVersionRunner,
} = {}) => {
  const values = Object.values(CIRCOM_OVERRIDE_ENV).map((name) =>
    String(Object.hasOwn(env, name) ? env[name] : "").trim(),
  );
  if (values.every((value) => value === "")) return null;
  if (values.some((value) => value === "")) {
    throw new Error("Release Circom compiler override environment is incomplete");
  }
  const [configuredPath, expectedSha256, expectedTarget] = values;
  if (!path.isAbsolute(configuredPath) || !/^[0-9a-f]{64}$/u.test(expectedSha256)) {
    throw new Error("Release Circom compiler override environment is invalid");
  }
  const target = resolveLocalCircomTarget({ platform, arch, libc, report });
  if (expectedTarget !== target.id || target.strategy !== "pinned-source") {
    throw new Error("Release Circom compiler override does not match the native source target");
  }
  const resolvedPath = fs.realpathSync(configuredPath);
  const state = fs.lstatSync(configuredPath);
  if (!state.isFile() || state.isSymbolicLink() || resolvedPath !== path.resolve(configuredPath)) {
    throw new Error("Release Circom compiler override must be a regular non-symlink file");
  }
  const temporaryDirectory = fs.realpathSync(os.tmpdir());
  if (!isInside(temporaryDirectory, resolvedPath)) {
    throw new Error("Release Circom compiler override must be inside the OS temporary directory");
  }
  const actualSha256 = createHash("sha256").update(fs.readFileSync(resolvedPath)).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Release Circom compiler override SHA-256 mismatch; expected ${expectedSha256}, ` +
        `got ${actualSha256}`,
    );
  }
  const version = versionRunner(resolvedPath);
  if (version !== `circom compiler ${CIRCOM_VERSION}`) {
    throw new Error(`Release Circom compiler override version mismatch: ${version}`);
  }
  return Object.freeze({
    path: resolvedPath,
    target: target.id,
    strategy: target.strategy,
    sha256: actualSha256,
    version: CIRCOM_VERSION,
    libcEvidence: target.libcEvidence ?? null,
  });
};

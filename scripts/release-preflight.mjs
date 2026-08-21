#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertLocalCircomInstallation,
  buildPinnedCircomFromSource,
  resolveTrustedSourceBuildTool,
} from "./fetch-circom.mjs";
import {
  buildCircomOverrideEnvironment,
  withoutCircomOverrideEnvironment,
} from "./lib/circomCompilerOverride.mjs";
import {
  CIRCOM_VERSION,
  localCircomBinaryPath,
  resolveLocalCircomTarget,
} from "./lib/circomToolchain.mjs";
import {
  assertReleaseRuntimeCompatibility,
  normalizePortableCommand,
  sanitizeReleaseEnvironment,
} from "./lib/portableCommand.mjs";
import { createPrivateTemporaryDirectory } from "./lib/privateTemporaryDirectory.mjs";
import { resolveProductionPtauPath } from "./lib/productionPtau.mjs";
import { inspectProtocolReleaseManifest } from "./lib/protocolReleaseManifest.mjs";
import { ZK_PRODUCTION_PHASE1, inspectZkReleaseArtifacts } from "./lib/zkArtifactTrust.mjs";
import {
  buildProductionCompilerEvidence,
  preparePrivateProductionCompiler,
} from "./lib/zkProductionSetup.mjs";
import { verifyProductionCeremony } from "./zk-ceremony-verify.mjs";

export const RELEASE_PREFLIGHT_COMMANDS = Object.freeze([
  Object.freeze(["npm", ["run", "clean"]]),
  // Contracts must build before the frontend synchronizes ABI artifacts.
  Object.freeze(["npm", ["run", "contracts:check"]]),
  Object.freeze(["npm", ["run", "frontend:check"]]),
  Object.freeze(["npm", ["run", "frontend:locales:check"]]),
  Object.freeze(["npm", ["run", "zk:artifacts:check"]]),
  Object.freeze(["npm", ["run", "zk:check"]]),
  Object.freeze(["npm", ["run", "security:xss-scan"]]),
  // The release toolchain itself (Hardhat, Safe SDK, ethers and snarkjs) is in devDependencies.
  Object.freeze(["npm", ["run", "security:audit:all"]]),
]);

export const defaultRunner = ({
  executable,
  args,
  cwd,
  capture = false,
  platform = process.platform,
  env = process.env,
}) => {
  const command = normalizePortableCommand({ executable, args, platform, env });
  return execFileSync(command.executable, command.args, {
    cwd,
    env,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
};

const assertCleanGitState = ({ root, runner, stage, env, gitExecutable }) => {
  const commit = String(
    runner({
      executable: gitExecutable,
      args: ["rev-parse", "HEAD"],
      cwd: root,
      capture: true,
      env,
    }),
  ).trim();
  const status = String(
    runner({
      executable: gitExecutable,
      args: ["status", "--porcelain=v1", "--untracked-files=all"],
      cwd: root,
      capture: true,
      env,
    }),
  ).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`Release preflight ${stage} Git commit is unavailable`);
  }
  if (status !== "") {
    throw new Error(`Release preflight requires a clean Git working tree (${stage})`);
  }
  return commit;
};

export const runReleasePreflight = async ({
  root = process.cwd(),
  platform = process.platform,
  arch = process.arch,
  libc,
  report,
  env = process.env,
  runner = defaultRunner,
  commands = RELEASE_PREFLIGHT_COMMANDS,
  compilerInspector = assertLocalCircomInstallation,
  compilerSourceBuilder = buildPinnedCircomFromSource,
  gitToolResolver = resolveTrustedSourceBuildTool,
  privateDirectoryFactory = createPrivateTemporaryDirectory,
  ptauPath,
  mpcMetadataReader,
  expectedProductionPhase1 = ZK_PRODUCTION_PHASE1,
  protocolManifestInspector = inspectProtocolReleaseManifest,
} = {}) => {
  if (typeof runner !== "function") throw new Error("runner must be a function");
  if (!Array.isArray(commands)) throw new Error("commands must be an array");
  if (typeof compilerInspector !== "function") {
    throw new Error("compilerInspector must be a function");
  }
  if (typeof compilerSourceBuilder !== "function") {
    throw new Error("compilerSourceBuilder must be a function");
  }
  if (typeof gitToolResolver !== "function") {
    throw new Error("gitToolResolver must be a function");
  }
  if (typeof privateDirectoryFactory !== "function") {
    throw new Error("privateDirectoryFactory must be a function");
  }
  if (typeof protocolManifestInspector !== "function") {
    throw new Error("protocolManifestInspector must be a function");
  }
  assertReleaseRuntimeCompatibility({ platform, arch, env, operation: "Release preflight" });

  const localTarget = resolveLocalCircomTarget({ platform, arch, libc, report });
  const baseEnvironment = withoutCircomOverrideEnvironment(sanitizeReleaseEnvironment(env));
  const gitExecutable = await gitToolResolver({ name: "git" });
  if (typeof gitExecutable !== "string" || !path.isAbsolute(gitExecutable)) {
    throw new Error("Release preflight Git resolver must return an absolute path");
  }
  const releaseCommit = assertCleanGitState({
    root,
    runner,
    stage: "before checks",
    env: baseEnvironment,
    gitExecutable,
  });
  const initialProtocolEvidence = protocolManifestInspector({
    root,
    requireProduction: true,
  });
  if (!/^[0-9a-f]{64}$/.test(initialProtocolEvidence?.manifestSha256 ?? "")) {
    throw new Error("Release preflight protocol manifest SHA-256 is invalid");
  }
  // Refuse an unreviewed artifact set before inspecting or building any local compiler.
  const initialZkEvidence = inspectZkReleaseArtifacts({
    root,
    requireProduction: true,
    requireBuiltR1cs: false,
    expectedProductionPhase1,
  });
  if (initialZkEvidence.schemaVersion !== 3) {
    throw new Error(
      "Release preflight requires ZK manifest schemaVersion 3 with a reviewed snarkjs runtime graph",
    );
  }
  let compilerStageRoot;
  try {
    let localCompiler;
    if (localTarget.strategy === "pinned-source") {
      compilerStageRoot = await privateDirectoryFactory({
        prefix: "deepfamily-zk-preflight-compiler-",
        platform,
      });
      localCompiler = await preparePrivateProductionCompiler({
        target: localTarget,
        stageRoot: compilerStageRoot,
        sourceBuilder: compilerSourceBuilder,
        sourceEnvironment: baseEnvironment,
      });
    } else {
      localCompiler = await compilerInspector({ root, platform, arch, libc, report });
      const expectedCompilerPath = path.join(
        path.resolve(root),
        localCircomBinaryPath({ platform }),
      );
      if (localCompiler?.path !== expectedCompilerPath) {
        throw new Error(
          "Release preflight local Circom inspection returned unexpected target evidence",
        );
      }
    }
    if (
      localCompiler?.target !== localTarget.id ||
      localCompiler?.strategy !== localTarget.strategy
    ) {
      throw new Error(
        "Release preflight local Circom inspection returned unexpected target evidence",
      );
    }
    const expectedLibcEvidence = localTarget.libcEvidence ?? null;
    const actualLibcEvidence = localCompiler.libcEvidence ?? null;
    if (
      (expectedLibcEvidence === null) !== (actualLibcEvidence === null) ||
      (expectedLibcEvidence !== null &&
        ["family", "version", "source"].some(
          (field) => actualLibcEvidence?.[field] !== expectedLibcEvidence[field],
        ))
    ) {
      throw new Error(
        "Release preflight local Circom inspection returned unexpected libc evidence",
      );
    }
    if (localCompiler.version !== CIRCOM_VERSION) {
      throw new Error("Release preflight local Circom inspection returned an unexpected version");
    }
    if (!/^[0-9a-f]{64}$/.test(localCompiler.sha256)) {
      throw new Error(
        "Release preflight local Circom inspection returned an invalid SHA-256 digest",
      );
    }
    if (localTarget.strategy === "official-binary" && localCompiler.sha256 !== localTarget.sha256) {
      throw new Error(
        "Release preflight local Circom inspection does not match the pinned target SHA-256",
      );
    }
    buildProductionCompilerEvidence({ compiler: localCompiler, platform, arch });
    const commandEnvironment =
      localTarget.strategy === "pinned-source"
        ? buildCircomOverrideEnvironment({ env: baseEnvironment, compiler: localCompiler })
        : baseEnvironment;

    for (const [executable, args] of commands) {
      const usesCircom =
        executable === "npm" && args[0] === "run" && args[1] === "zk:artifacts:check";
      runner({
        executable,
        args,
        cwd: root,
        capture: false,
        env: usesCircom ? commandEnvironment : baseEnvironment,
      });
    }
    const ceremonyVerification = await verifyProductionCeremony({
      root,
      ptauPath: ptauPath ?? resolveProductionPtauPath({ root, env: baseEnvironment, platform }),
      env: baseEnvironment,
      runner,
      mpcMetadataReader,
      expectedProductionPhase1,
    });

    const finishedCommit = assertCleanGitState({
      root,
      runner,
      stage: "after checks",
      env: baseEnvironment,
      gitExecutable,
    });
    if (finishedCommit !== releaseCommit) {
      throw new Error("Release commit changed while preflight was running");
    }
    const finalZkEvidence = inspectZkReleaseArtifacts({
      root,
      requireProduction: true,
      requireBuiltR1cs: true,
      expectedProductionPhase1,
    });
    if (finalZkEvidence.manifestSha256 !== initialZkEvidence.manifestSha256) {
      throw new Error("ZK artifact manifest changed while release preflight was running");
    }
    const finalProtocolEvidence = protocolManifestInspector({
      root,
      requireProduction: true,
    });
    if (finalProtocolEvidence.manifestSha256 !== initialProtocolEvidence.manifestSha256) {
      throw new Error("Protocol release manifest changed while release preflight was running");
    }

    return Object.freeze({
      status: "passed",
      releaseCommit,
      zkCeremonyId: finalZkEvidence.ceremonyId,
      zkTrustModel: finalZkEvidence.trustModel,
      zkContributorCount: finalZkEvidence.contributorCount,
      zkMinimumContributors: finalZkEvidence.minimumContributors,
      zkManifestSha256: finalZkEvidence.manifestSha256,
      zkTranscriptSha256: ceremonyVerification.transcriptSha256,
      protocolManifestSha256: finalProtocolEvidence.manifestSha256,
      ptauSha256: ceremonyVerification.ptau.sha256,
      checks: commands.map(([executable, args]) => `${executable} ${args.join(" ")}`),
    });
  } finally {
    if (compilerStageRoot !== undefined) {
      await fs.rm(compilerStageRoot, { recursive: true, force: true });
    }
  }
};

export const main = async () => {
  const result = await runReleasePreflight();
  console.log("Production release preflight passed:");
  console.log(`  release commit: ${result.releaseCommit}`);
  console.log(`  ZK ceremony:    ${result.zkCeremonyId}`);
  console.log(
    `  ZK trust:       ${result.zkTrustModel}, ` +
      `${result.zkContributorCount}/${result.zkMinimumContributors} contributor(s)`,
  );
  console.log(`  ZK manifest:    ${result.zkManifestSha256}`);
  console.log(`  Protocol:       ${result.protocolManifestSha256}`);
};

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((error) => {
    console.error(`[release-preflight] ${error.message}`);
    process.exitCode = 1;
  });
}

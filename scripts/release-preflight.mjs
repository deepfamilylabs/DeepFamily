#!/usr/bin/env node

import "dotenv/config";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveProductionPtauPath } from "./lib/productionPtau.mjs";
import { ZK_PRODUCTION_PHASE1, inspectZkReleaseArtifacts } from "./lib/zkArtifactTrust.mjs";
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

const defaultRunner = ({ executable, args, cwd, capture = false }) =>
  execFileSync(executable, args, {
    cwd,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

const assertCleanGitState = ({ root, runner, stage }) => {
  const commit = String(
    runner({
      executable: "git",
      args: ["rev-parse", "HEAD"],
      cwd: root,
      capture: true,
    }),
  ).trim();
  const status = String(
    runner({
      executable: "git",
      args: ["status", "--porcelain=v1", "--untracked-files=all"],
      cwd: root,
      capture: true,
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
  runner = defaultRunner,
  commands = RELEASE_PREFLIGHT_COMMANDS,
  ptauPath,
  mpcMetadataReader,
  expectedProductionPhase1 = ZK_PRODUCTION_PHASE1,
} = {}) => {
  if (typeof runner !== "function") throw new Error("runner must be a function");
  if (!Array.isArray(commands)) throw new Error("commands must be an array");

  const releaseCommit = assertCleanGitState({ root, runner, stage: "before checks" });
  // Fail before expensive checks when development-only proving keys are still checked in.
  const initialZkEvidence = inspectZkReleaseArtifacts({
    root,
    requireProduction: true,
    requireBuiltR1cs: false,
    expectedProductionPhase1,
  });

  for (const [executable, args] of commands) {
    runner({ executable, args, cwd: root, capture: false });
  }
  const ceremonyVerification = await verifyProductionCeremony({
    root,
    ptauPath: ptauPath ?? resolveProductionPtauPath({ root }),
    runner,
    mpcMetadataReader,
    expectedProductionPhase1,
  });

  const finishedCommit = assertCleanGitState({ root, runner, stage: "after checks" });
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

  return Object.freeze({
    status: "passed",
    releaseCommit,
    zkCeremonyId: finalZkEvidence.ceremonyId,
    zkTrustModel: finalZkEvidence.trustModel,
    zkContributorCount: finalZkEvidence.contributorCount,
    zkMinimumContributors: finalZkEvidence.minimumContributors,
    zkManifestSha256: finalZkEvidence.manifestSha256,
    zkTranscriptSha256: ceremonyVerification.transcriptSha256,
    ptauSha256: ceremonyVerification.ptau.sha256,
    checks: commands.map(([executable, args]) => `${executable} ${args.join(" ")}`),
  });
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
};

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((error) => {
    console.error(`[release-preflight] ${error.message}`);
    process.exitCode = 1;
  });
}

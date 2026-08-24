#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { ethers } from "ethers";

import { getChainProfile } from "./lib/chainProfiles.mjs";
import {
  buildPlannedProtocolDeploymentEvidence,
  deriveMainnetPlannedAddresses,
} from "./lib/protocolDeploymentProjection.mjs";
import { inspectProtocolReleaseManifest } from "./lib/protocolReleaseManifest.mjs";

const USAGE =
  "node scripts/protocol-deployment-projection.mjs " +
  "--chain <espace|ethereum> --deployer <address> --nonce <next-pending-nonce>";

export const parseProtocolDeploymentProjectionArguments = (argv) => {
  if (!Array.isArray(argv) || argv.length !== 6) {
    throw new Error(`Expected exactly three named arguments. Usage: ${USAGE}`);
  }
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!["--chain", "--deployer", "--nonce"].includes(name)) {
      throw new Error(`Unsupported argument ${String(name)}. Usage: ${USAGE}`);
    }
    if (values.has(name) || typeof value !== "string" || value.length === 0) {
      throw new Error(`Argument ${name} must be supplied exactly once. Usage: ${USAGE}`);
    }
    values.set(name, value);
  }
  for (const required of ["--chain", "--deployer", "--nonce"]) {
    if (!values.has(required)) {
      throw new Error(`Missing ${required}. Usage: ${USAGE}`);
    }
  }
  if (!/^(?:0|[1-9][0-9]*)$/u.test(values.get("--nonce"))) {
    throw new Error("--nonce must be a canonical non-negative decimal integer");
  }
  const startingNonce = Number(values.get("--nonce"));
  if (!Number.isSafeInteger(startingNonce)) {
    throw new Error("--nonce exceeds the JavaScript safe-integer range");
  }
  return Object.freeze({
    chainProfile: getChainProfile(values.get("--chain")),
    deployer: ethers.getAddress(values.get("--deployer")),
    startingNonce,
  });
};

export const buildProtocolDeploymentProjectionPlan = ({
  chainProfile,
  deployer,
  startingNonce,
  root = process.cwd(),
  manifestInspector = inspectProtocolReleaseManifest,
  deploymentArtifactInspector,
} = {}) => {
  if (!chainProfile?.mainnet) throw new Error("A guarded production chain profile is required");
  const manifestEvidence = manifestInspector({ root, requireProduction: false });
  const plannedAddresses = deriveMainnetPlannedAddresses({ ethers, deployer, startingNonce });
  const planned = buildPlannedProtocolDeploymentEvidence({
    root,
    chainId: chainProfile.mainnet.chainId,
    plannedAddresses,
    manifest: manifestEvidence.manifest,
    ...(deploymentArtifactInspector ? { deploymentArtifactInspector } : {}),
  });
  return Object.freeze({
    schemaVersion: 1,
    mode: "read-only-planned-deployment-projection",
    chainProfileId: chainProfile.id,
    network: Object.freeze({
      name: chainProfile.mainnet.networkName,
      chainId: Number(chainProfile.mainnet.chainId),
    }),
    deployer: ethers.getAddress(deployer),
    startingNonce,
    inputManifest: Object.freeze({
      path: path.relative(path.resolve(root), manifestEvidence.manifestPath),
      sha256: manifestEvidence.manifestSha256,
      protocol: manifestEvidence.manifest.protocol,
      protocolGeneration: manifestEvidence.manifest.protocolGeneration,
    }),
    plannedAddresses,
    deployments: planned.deployments,
    stableProjection: planned.projection,
    stableProjectionSha256: planned.sha256,
  });
};

export const main = async (argv = process.argv.slice(2)) => {
  const options = parseProtocolDeploymentProjectionArguments(argv);
  const plan = buildProtocolDeploymentProjectionPlan(options);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
};

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[protocol-deployment-projection] ${error?.message ?? String(error)}`);
    process.exitCode = 1;
  });
}

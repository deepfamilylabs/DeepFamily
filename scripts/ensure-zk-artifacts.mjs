#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkShieldedDevelopmentArtifacts } from "./check-zk-artifacts.mjs";
import { fetchZkAssets } from "./fetch-zk-assets.mjs";
import { inspectShieldedProductionArtifacts } from "./lib/shieldedProductionSetup.mjs";
import { SHIELDED_CIRCUITS } from "./lib/zkCircuitSelection.mjs";
import { ZK_RELEASE_ARTIFACTS, inspectZkReleaseArtifacts } from "./lib/zkArtifactTrust.mjs";
import { runZkBuild } from "./zk-build.mjs";
import { inspectLinkedReceiveArtifacts } from "./lib/linkedReceiveArtifacts.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export function checkCurrentZkArtifacts({ root = ROOT } = {}) {
  const core = inspectZkReleaseArtifacts({ root, requireBuiltR1cs: true });
  const production = fs.existsSync(path.join(root, "circuits/shielded-production-manifest.json"));
  const shielded = production
    ? inspectShieldedProductionArtifacts({ root })
    : checkShieldedDevelopmentArtifacts({ root });
  if ((core.trustedSetupStatus === "production") !== production) {
    throw new Error(
      "All Circom circuits must use the same development or production artifact status",
    );
  }
  const receive = inspectLinkedReceiveArtifacts({ root, requireProduction: production });
  const circuitCount =
    Object.keys(ZK_RELEASE_ARTIFACTS).length + Object.keys(SHIELDED_CIRCUITS).length;
  return {
    status: production ? "production" : "development",
    circuitCount,
    core,
    shielded,
    receive,
  };
}

async function reuseCurrentArtifacts({ root, check, log }) {
  const artifacts = await check({ root });
  log(`[zk] All ${artifacts.circuitCount} current public artifact sets are ready`);
  return { regenerated: false, artifacts };
}

/** Compile, check and fetch pinned keys before local deployment; setup is always explicit. */
export async function ensureZkArtifacts({
  root = ROOT,
  build = runZkBuild,
  check = checkCurrentZkArtifacts,
  fetchAssets = fetchZkAssets,
  log = console.log,
} = {}) {
  root = path.resolve(root);
  await build({ root, circuit: "all" });
  let failure;
  try {
    return await reuseCurrentArtifacts({ root, check, log });
  } catch (error) {
    failure = error;
  }
  // A fresh checkout holds only the manifests; the pinned proving files come from R2.
  try {
    await fetchAssets({ root, log });
    return await reuseCurrentArtifacts({ root, check, log });
  } catch (error) {
    failure = error;
  }
  throw new Error(
    `Current ZK artifacts are unavailable or stale (${failure.message}). ` +
      "Restore the manifest-pinned files with npm run zk:assets:fetch, or explicitly generate " +
      "a complete artifact set with npm run zk:setup. Publish generated files from their " +
      "setup checkout with npm run zk:assets:publish before fetching them elsewhere. " +
      "Local deployment never regenerates proving keys.",
    { cause: failure },
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await ensureZkArtifacts();
}

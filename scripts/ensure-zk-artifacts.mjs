#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkShieldedDevelopmentArtifacts } from "./check-zk-artifacts.mjs";
import { fetchZkAssets } from "./fetch-zk-assets.mjs";
import { inspectShieldedProductionArtifacts } from "./lib/shieldedProductionSetup.mjs";
import { inspectZkReleaseArtifacts } from "./lib/zkArtifactTrust.mjs";
import { runZkBuild } from "./zk-build.mjs";
import { runZkDevelopmentSetup } from "./zk-development-setup.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export function checkCurrentZkArtifacts({ root = ROOT } = {}) {
  const core = inspectZkReleaseArtifacts({ root, requireBuiltR1cs: true });
  const production = fs.existsSync(path.join(root, "circuits/shielded-production-manifest.json"));
  const shielded = production
    ? inspectShieldedProductionArtifacts({ root })
    : checkShieldedDevelopmentArtifacts({ root });
  if ((core.trustedSetupStatus === "production") !== production) {
    throw new Error(
      "All eight circuits must use the same development or production artifact status",
    );
  }
  return { status: production ? "production" : "development", circuitCount: 8, core, shielded };
}

async function reuseCurrentArtifacts({ root, check, log }) {
  const artifacts = await check({ root });
  log(`[zk] All ${artifacts.circuitCount} current public artifact sets are ready`);
  return { regenerated: false, artifacts };
}

/** Compile all circuits and reuse the current public keys before the integrated local deployment. */
export async function ensureZkArtifacts({
  root = ROOT,
  build = runZkBuild,
  check = checkCurrentZkArtifacts,
  fetchAssets = fetchZkAssets,
  setup = runZkDevelopmentSetup,
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
  const coreManifest = path.join(root, "circuits/zk-artifacts-manifest.json");
  if (
    fs.existsSync(path.join(root, "circuits/shielded-production-manifest.json")) ||
    (fs.existsSync(coreManifest) &&
      JSON.parse(fs.readFileSync(coreManifest, "utf8")).trustedSetup?.status !== "development")
  ) {
    throw new Error("Refusing to replace current production ZK artifacts with development keys", {
      cause: failure,
    });
  }
  log(
    `[zk] Development artifacts missing or stale (${failure.message}); setting up all eight circuits`,
  );
  await setup({ root });
  const artifacts = await check({ root });
  return { regenerated: true, artifacts };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await ensureZkArtifacts();
}

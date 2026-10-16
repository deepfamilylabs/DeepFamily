#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkShieldedDevelopmentArtifacts } from "./check-zk-artifacts.mjs";
import { fetchZkAssets } from "./fetch-zk-assets.mjs";
import { inspectShieldedProductionArtifacts } from "./lib/shieldedProductionSetup.mjs";
import { SHIELDED_CIRCUITS } from "./lib/zkCircuitSelection.mjs";
import {
  ZK_RELEASE_ARTIFACTS,
  inspectZkReleaseArtifacts,
  sha256File,
} from "./lib/zkArtifactTrust.mjs";
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

/**
 * Whether all eight freshly compiled circuits have the R1CS and WASM digests their development
 * manifests pin. The pinned keys then still fit, and only their files are missing here.
 */
export function compiledCircuitsMatchManifests({ root = ROOT } = {}) {
  const pinned = (manifest) => {
    const file = path.join(root, manifest);
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")).circuits ?? {}) : {};
  };
  const core = pinned("circuits/zk-artifacts-manifest.json");
  const shielded = pinned("circuits/shielded-development-manifest.json");
  const circuits = [
    ...Object.keys(ZK_RELEASE_ARTIFACTS).map((name) => ["zk-artifacts/circuits", name, core[name]]),
    ...Object.entries(SHIELDED_CIRCUITS).map(([action, name]) => [
      "zk-artifacts/shielded",
      name,
      shielded[action]?.source === name ? shielded[action] : undefined,
    ]),
  ];
  return circuits.every(([directory, name, expected]) => {
    const r1cs = path.join(root, directory, `${name}.r1cs`);
    const wasm = path.join(root, directory, `${name}_js`, `${name}.wasm`);
    return (
      expected !== undefined &&
      fs.existsSync(r1cs) &&
      fs.existsSync(wasm) &&
      sha256File(r1cs) === expected.r1csSha256 &&
      sha256File(wasm) === expected.wasmSha256
    );
  });
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
  circuitsUnchanged = compiledCircuitsMatchManifests,
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
    throw new Error(
      `Refusing to replace current production ZK artifacts with development keys (${failure.message})`,
      { cause: failure },
    );
  }
  // Setup draws fresh randomness, so new keys would rewrite every committed verifier and vkey, and
  // each other checkout would then regenerate its own in turn. Only a circuit change may do that.
  if (circuitsUnchanged({ root })) {
    throw new Error(
      `Refusing to replace the committed development keys of unchanged circuits (${failure.message}); ` +
        "publish them from the checkout that generated them with npm run zk:assets:publish, " +
        "or replace them on purpose with npm run zk:development:setup",
      { cause: failure },
    );
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

#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkCurrentArtifacts } from "./check-zk-artifacts.mjs";
import { fetchZkAssets } from "./fetch-zk-assets.mjs";
import { runZkBuild } from "./zk-build.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const checkCurrentZkArtifacts = checkCurrentArtifacts;

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
      "local keys with npm run zk:setup. Publish pinned files from their " +
      "setup checkout with npm run zk:assets:publish before fetching them elsewhere. " +
      "Local deployment never regenerates proving keys.",
    { cause: failure },
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await ensureZkArtifacts();
}

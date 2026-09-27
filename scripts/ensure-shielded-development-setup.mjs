#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadCandidateArtifacts } from "./shielded-testnet-rehearsal.mjs";
import { setupShieldedDevelopmentKeys } from "./zk-shielded-development-setup.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const MANIFEST = path.join(ROOT, "zk-artifacts", "shielded", "development-manifest.json");
const options = {
  root: ROOT,
  candidateManifest: "zk-artifacts/shielded/development-manifest.json",
  verifierDirectory: "zk-artifacts/shielded/verifiers",
};

function checkCurrentArtifacts() {
  if (fs.existsSync(MANIFEST)) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    } catch {
      // A partial local build is regenerated below.
    }
    if (manifest && manifest.schema !== "deepfamily/shielded-development-keys@1") {
      throw new Error("Refusing to replace a non-development shielded proof manifest");
    }
  }
  const candidate = loadCandidateArtifacts(options);
  if (candidate.candidateClass !== "development-only") {
    throw new Error("Shielded local proof artifacts are not development-only");
  }
  return candidate;
}

/** Rebuild only when missing or stale; proof keys are never copied to frontend/public. */
export async function ensureShieldedDevelopmentSetup({
  check = checkCurrentArtifacts,
  setup = setupShieldedDevelopmentKeys,
  log = console.log,
} = {}) {
  try {
    const current = await check();
    log("[shielded-development] Existing development proof artifacts are current");
    return { rebuilt: false, candidate: current };
  } catch (error) {
    if (/Refusing to replace a non-development|not development-only/.test(error.message)) {
      throw error;
    }
    log(`[shielded-development] Artifacts missing or stale (${error.message}); generating once`);
  }
  await setup([]);
  const candidate = await check();
  log("[shielded-development] Development proof artifacts ready");
  return { rebuilt: true, candidate };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await ensureShieldedDevelopmentSetup();
}

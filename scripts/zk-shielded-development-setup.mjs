#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureProductionPtau } from "./lib/productionPtau.mjs";
import { syncShieldedDevelopmentAssets } from "./lib/shieldedDevelopmentAssets.mjs";
import { SHIELDED_CIRCUITS, hasShieldedSolidityVerifier } from "./lib/zkCircuitSelection.mjs";
import { runZkBuild } from "./zk-build.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/**
 * Development setup and public synchronization, shared by the top-level eight-circuit command.
 */
export async function setupShieldedDevelopmentKeys({ root = ROOT } = {}) {
  root = path.resolve(root);
  const artifactDirectory = path.join(root, "zk-artifacts", "shielded");
  const snarkjs = path.join(root, "node_modules", "snarkjs", "build", "cli.cjs");
  const run = (args) =>
    execFileSync(process.execPath, [snarkjs, ...args], { cwd: root, stdio: "inherit" });
  if (fs.existsSync(path.join(root, "circuits", "shielded-production-manifest.json"))) {
    throw new Error("Refusing to overwrite shielded production artifacts with development keys");
  }
  const existingManifest = path.join(artifactDirectory, "development-manifest.json");
  if (fs.existsSync(existingManifest)) {
    let current;
    try {
      current = JSON.parse(fs.readFileSync(existingManifest, "utf8"));
    } catch {
      // A partially written development manifest can be regenerated.
    }
    if (
      current &&
      (current.schema !== "deepfamily/shielded-development-keys@1" ||
        current.developmentOnly !== true ||
        current.productionReady !== false)
    ) {
      throw new Error("Refusing to replace a non-development shielded proof manifest");
    }
  }
  const { path: ptau } = await ensureProductionPtau({ root });
  await runZkBuild({ root, circuit: "shielded" });
  const verifierDirectory = path.join(artifactDirectory, "verifiers");
  fs.mkdirSync(verifierDirectory, { recursive: true });
  const manifest = {
    schema: "deepfamily/shielded-development-keys@1",
    developmentOnly: true,
    productionReady: false,
    ptauSha256: sha256(ptau),
    circuits: {},
  };
  for (const [action, sourceName] of Object.entries(SHIELDED_CIRCUITS)) {
    const r1cs = path.join(artifactDirectory, `${sourceName}.r1cs`);
    const wasm = path.join(artifactDirectory, `${sourceName}_js`, `${sourceName}.wasm`);
    const initial = path.join(artifactDirectory, `${sourceName}_0000.zkey`);
    const final = path.join(artifactDirectory, `${sourceName}_dev_final.zkey`);
    const vkey = path.join(artifactDirectory, `${sourceName}.vkey.json`);
    const verifier = hasShieldedSolidityVerifier(action)
      ? path.join(verifierDirectory, `${sourceName}.sol`)
      : null;
    run(["groth16", "setup", r1cs, ptau, initial]);
    run([
      "zkey",
      "contribute",
      initial,
      final,
      "--name=development-only",
      "-e=development-only-entropy-label",
    ]);
    run(["zkey", "export", "verificationkey", final, vkey]);
    if (verifier) run(["zkey", "export", "solidityverifier", final, verifier]);
    manifest.circuits[action] = {
      source: sourceName,
      sourceSha256: sha256(path.join(root, "circuits", `${sourceName}.circom`)),
      r1csSha256: sha256(r1cs),
      wasmSha256: sha256(wasm),
      zkeySha256: sha256(final),
      verificationKeySha256: sha256(vkey),
      ...(verifier && { verifierSha256: sha256(verifier) }),
    };
  }
  fs.writeFileSync(
    path.join(artifactDirectory, "development-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return syncShieldedDevelopmentAssets({ root, manifest });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2)
    throw new Error("Usage: node scripts/zk-shielded-development-setup.mjs");
  await setupShieldedDevelopmentKeys();
}

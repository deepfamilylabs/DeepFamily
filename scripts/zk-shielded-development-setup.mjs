#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildShieldedCircuits, SHIELDED_CIRCUITS } from "./zk-shielded-build.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifactDirectory = path.join(root, "zk-artifacts", "shielded");
const snarkjs = path.join(root, "node_modules", "snarkjs", "build", "cli.cjs");
const ptau = path.join(root, "circuits", "ptau", "ppot_0080_16.ptau");
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function run(args) {
  execFileSync(process.execPath, [snarkjs, ...args], { cwd: root, stdio: "inherit" });
}

/**
 * Local proof tooling only. The generated zkeys/verifiers live under ignored
 * zk-artifacts and have no independent phase-2 ceremony or audit evidence.
 */
export async function setupShieldedDevelopmentKeys(argv = []) {
  const built = await buildShieldedCircuits(argv);
  if (!fs.existsSync(ptau)) throw new Error("Pinned Phase 1 Powers of Tau file is missing");
  const verifierDirectory = path.join(artifactDirectory, "verifiers");
  fs.mkdirSync(verifierDirectory, { recursive: true });
  const manifest = {
    schema: "deepfamily/shielded-development-keys@1",
    developmentOnly: true,
    productionReady: false,
    ptauSha256: sha256(ptau),
    circuits: {},
  };
  for (const { action, sourceName } of built) {
    const r1cs = path.join(artifactDirectory, `${sourceName}.r1cs`);
    const wasm = path.join(artifactDirectory, `${sourceName}_js`, `${sourceName}.wasm`);
    const initial = path.join(artifactDirectory, `${sourceName}_0000.zkey`);
    const final = path.join(artifactDirectory, `${sourceName}_dev_final.zkey`);
    const vkey = path.join(artifactDirectory, `${sourceName}.vkey.json`);
    const verifier = path.join(verifierDirectory, `${sourceName}.sol`);
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
    run(["zkey", "export", "solidityverifier", final, verifier]);
    manifest.circuits[action] = {
      source: sourceName,
      sourceSha256: sha256(path.join(root, "circuits", `${sourceName}.circom`)),
      r1csSha256: sha256(r1cs),
      wasmSha256: sha256(wasm),
      zkeySha256: sha256(final),
      verificationKeySha256: sha256(vkey),
      verifierSha256: sha256(verifier),
    };
  }
  fs.writeFileSync(
    path.join(artifactDirectory, "development-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (
    process.argv.length === 4 &&
    (process.argv[2] !== "--circuit" || !Object.hasOwn(SHIELDED_CIRCUITS, process.argv[3]))
  ) {
    throw new Error("Unknown shielded circuit");
  }
  await setupShieldedDevelopmentKeys(process.argv.slice(2));
}

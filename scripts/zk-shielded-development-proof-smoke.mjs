#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildShieldedClaimFixture } from "../circuits/test/generate_shielded_claim_input.mjs";
import { buildShieldedFundingFixtures } from "../circuits/test/generate_shielded_funding_input.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifacts = path.join(root, "zk-artifacts", "shielded");
const cli = path.join(root, "node_modules", "snarkjs", "build", "cli.cjs");
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const fixtures = {
  allocate: () => buildShieldedFundingFixtures().allocate,
  claim: () => buildShieldedClaimFixture({ claimCount: 12, remainingPeriods: 12 }).witness,
};
const sources = { allocate: "shielded_allocate", claim: "shielded_claim" };

function runSnarkjs(args) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 20 * 60 * 1000,
  });
}

/** Repeatable, development-key-only real Groth16 proof smoke; never release evidence. */
export function smokeDevelopmentProofs(actions = ["allocate", "claim"]) {
  const manifestPath = path.join(artifacts, "development-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("Run npm run zk:shielded:development:setup before the proof smoke");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.developmentOnly, true, "This smoke uses development keys only");
  assert.equal(manifest.productionReady, false, "Production keys are not allowed in this smoke");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-shielded-proof-"));
  try {
    for (const action of actions) {
      const source = sources[action];
      if (!source) throw new Error(`Unknown smoke action: ${action}`);
      const item = manifest.circuits?.[action];
      if (item?.source !== source) {
        throw new Error(`Development manifest has no current ${action} verifier`);
      }
      const wasm = path.join(artifacts, `${source}_js`, `${source}.wasm`);
      const zkey = path.join(artifacts, `${source}_dev_final.zkey`);
      const vkey = path.join(artifacts, `${source}.vkey.json`);
      const r1cs = path.join(artifacts, `${source}.r1cs`);
      const sourceFile = path.join(root, "circuits", `${source}.circom`);
      for (const [file, digest] of [
        [sourceFile, item.sourceSha256],
        [wasm, item.wasmSha256],
        [zkey, item.zkeySha256],
        [vkey, item.verificationKeySha256],
        [r1cs, item.r1csSha256],
      ]) {
        if (!fs.existsSync(file) || sha256(file) !== digest) {
          throw new Error(`${action} development artifacts changed after setup`);
        }
      }
      const input = fixtures[action]();
      const inputPath = path.join(temporary, `${action}.input.json`);
      const proofPath = path.join(temporary, `${action}.proof.json`);
      const publicPath = path.join(temporary, `${action}.public.json`);
      fs.writeFileSync(inputPath, JSON.stringify(input));
      const started = Date.now();
      runSnarkjs(["groth16", "fullprove", inputPath, wasm, zkey, proofPath, publicPath]);
      const actual = JSON.parse(fs.readFileSync(publicPath, "utf8")).map(BigInt);
      assert.deepEqual(actual, input.publicSignals.map(BigInt), `${action} public signals changed`);
      const verified = runSnarkjs(["groth16", "verify", vkey, publicPath, proofPath]);
      assert.match(verified, /OK!/u, `${action} real proof did not verify`);
      console.log(`development-only ${action} real proof verified in ${Date.now() - started} ms`);
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const actions = process.argv.slice(2);
  smokeDevelopmentProofs(actions.length > 0 ? actions : undefined);
}
